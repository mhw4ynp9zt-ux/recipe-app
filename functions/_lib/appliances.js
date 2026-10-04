// ユーザーごとの「使っている調理家電」(設定タブで登録し、レシピ作成のたびに自動でAIの条件に加わる)。
//   例: レコルトの自動調理ポット(できる操作: 煮る・粉砕・自動で混ぜる / できない操作: 炒める・焼く など)
//   ・parseAppliances … 画面から受け取った一覧の検証・整形
//   ・loadAppliances / saveAppliances … D1(user_settings テーブルの appliances 列)への読み書き
//
// 1台の形: { name, can: [操作id...], policy, note }
//   ・can にチェックされていない操作は、プロンプトで「できない操作」として伝える(functions/_lib/recipe-prompt.js)
//   ・policy は、その家電を使うかどうかの方針(下の APPLIANCE_POLICIES)
//
// 注意: 自由に書ける文字列(名前・補足)がAIへのプロンプトに入るため、台数と長さを制限しています
// (長い文章を書き込んでAIの中継として悪用されるのを防ぐ。「使わない食材」・マイキッチンと同じ考え方)。
// 守られたかどうかはコードでは判定できないため、守られなかったときの自動の作り直しはしません
// (判定を足すとAIの呼び出しが増え、費用に直結するため。MAX_ATTEMPTS / MAX_AI_CALLS は変わりません)。
// 注意: APPLIANCE_OPS / APPLIANCE_POLICIES は js/config.js と同じ内容に保ってください(test/appliances_test.mjs が一致を確認します)。

export const APPLIANCE_OPS = [
  { id: "stir_fry", label: "炒める" },
  { id: "sear", label: "焼く" },
  { id: "simmer", label: "煮る・茹でる" },
  { id: "steam", label: "蒸す" },
  { id: "deep_fry", label: "揚げる" },
  { id: "blend", label: "粉砕・攪拌" },
  { id: "auto_stir", label: "自動で混ぜる" },
  { id: "hold", label: "保温・低温調理" },
];
export const APPLIANCE_POLICIES = [
  { id: "optional", label: "使えるときだけ使う" },
  { id: "prefer", label: "できるだけ使う" },
  { id: "always", label: "この家電で作れる料理は必ずこれで作る" },
];
export const MAX_APPLIANCES = 5;          // 登録できる台数
export const MAX_APPLIANCE_NAME_LEN = 20; // 名前の最大文字数
export const MAX_APPLIANCE_NOTE_LEN = 100; // 補足の最大文字数

const OP_IDS = APPLIANCE_OPS.map((o) => o.id);
const POLICY_IDS = APPLIANCE_POLICIES.map((p) => p.id);
const SHAPE_ERROR = "調理家電の形式が不正です";

function cleanLine(value) {
  // 改行などの制御文字は空白にし、連続する空白は1つにまとめる
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// 重複の判定用に、全角半角(NFKC)・大文字小文字・空白をならす
function dedupeKey(text) {
  return String(text).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// 成功: { value: [{ name, can, policy, note }, ...] } / 失敗: { error }
// can は APPLIANCE_OPS の順に並べ直し、重複は除く。policy 省略は "optional"。同じ名前(表記ゆれ含む)は最初の1台だけ残す。
// 全部消して保存(空配列)もできる。
export function parseAppliances(input) {
  if (!Array.isArray(input)) return { error: SHAPE_ERROR };
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: SHAPE_ERROR };

    if (raw.name !== undefined && typeof raw.name !== "string") return { error: SHAPE_ERROR };
    const name = cleanLine(raw.name === undefined ? "" : raw.name);
    if (!name) return { error: "調理家電の名前を入力してください" };
    if (name.length > MAX_APPLIANCE_NAME_LEN) {
      return { error: `名前「${name.slice(0, 8)}…」は長すぎます(${MAX_APPLIANCE_NAME_LEN}文字まで)` };
    }

    if (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string") return { error: SHAPE_ERROR };
    const note = raw.note ? cleanLine(raw.note) : "";
    if (note.length > MAX_APPLIANCE_NOTE_LEN) {
      return { error: `補足「${note.slice(0, 8)}…」は長すぎます(${MAX_APPLIANCE_NOTE_LEN}文字まで)` };
    }

    let can = [];
    if (raw.can !== undefined) {
      if (!Array.isArray(raw.can) || raw.can.some((id) => typeof id !== "string" || !OP_IDS.includes(id))) {
        return { error: "調理家電の「できる操作」の形式が不正です" };
      }
      can = OP_IDS.filter((id) => raw.can.includes(id));
    }

    let policy = "optional";
    if (raw.policy !== undefined) {
      if (typeof raw.policy !== "string" || !POLICY_IDS.includes(raw.policy)) {
        return { error: "調理家電の「使い方の方針」の形式が不正です" };
      }
      policy = raw.policy;
    }

    const key = dedupeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, can, policy, note });
  }
  if (out.length > MAX_APPLIANCES) return { error: `登録できるのは${MAX_APPLIANCES}台までです` };
  return { value: out };
}

// 列(またはテーブル)がまだ無い(migration-005 / 007 を実行する前)ときだけ、「登録なし」として扱う。
// こうしておくと、デプロイとマイグレーションの順番を間違えても、レシピ作成そのものは止まらない。
// (保存の方は失敗するので、登録できないことは画面で分かる)
const isMissingSchema = (e) => /no such (table|column)|no column named/i.test(String((e && e.message) || e));

export async function loadAppliances(env, userId) {
  let row;
  try {
    row = await env.DB.prepare("SELECT appliances FROM user_settings WHERE user_id = ?").bind(userId).first();
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
  if (!row || !row.appliances) return [];
  try {
    const parsed = parseAppliances(JSON.parse(row.appliances));
    return parsed.value || [];
  } catch (e) {
    return [];
  }
}

// list は parseAppliances で整えたもの。返り値: 保存した一覧
// 「使わない食材」(excluded_foods 列)・マイキッチン(personal_notes 列)には触れない。
export async function saveAppliances(env, userId, list, now = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, appliances, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET appliances = excluded.appliances, updated_at = excluded.updated_at`
  ).bind(userId, JSON.stringify(list), now).run();
  return list;
}
