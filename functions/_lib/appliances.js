// ユーザーごとの「使っている調理家電」(設定タブで登録し、レシピ作成のたびに自動でAIの条件に加わる)。
//   例: レコルトの自動調理ポット(できる操作: 煮る・粉砕・自動で混ぜる / できない操作: 炒める・焼く など)
//   ・parseAppliances … 画面から受け取った一覧の検証・整形
//   ・loadAppliances / saveAppliances … D1(user_settings テーブルの appliances 列)への読み書き
//
// 1台の形: { name, can: [操作id...], policy, note, spec? }
//   ・spec は取扱説明書から取り込んだ仕様(任意。空なら項目ごと無い): { capacity, modes: [{name, desc}], ranges, cautions: [文字列] }
//   ・can にチェックされていない操作は、プロンプトで「できない操作」として伝える(functions/_lib/recipe-prompt.js)
//   ・policy は、その家電を使うかどうかの方針(下の APPLIANCE_POLICIES)
//
// 注意: 自由に書ける文字列(名前・補足)がAIへのプロンプトに入るため、台数と長さを制限しています
// (長い文章を書き込んでAIの中継として悪用されるのを防ぐ。「使わない食材」・マイキッチンと同じ考え方)。
// 守られたかどうかはコードでは判定できないため、守られなかったときの自動の作り直しはしません
// (判定を足すとAIの呼び出しが増え、費用に直結するため。MAX_ATTEMPTS / MAX_AI_CALLS は変わりません)。
// 注意: APPLIANCE_OPS / APPLIANCE_POLICIES / APPLIANCE_SPEC_LIMITS は js/config.js と同じ内容に保ってください(test/appliances_test.mjs が一致を確認します)。

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
// spec の上限(文字数は容量・範囲・各項目、件数はモード・注意点)。js/config.js の同名の定数と同じ内容に保つ
// 注意: 保存済みデータは厳格に検証して読むので、上限を小さくするときは先に移行が必要
export const APPLIANCE_SPEC_LIMITS = { capacity: 20, modes: 6, modeName: 16, modeDesc: 30, ranges: 60, cautions: 3, caution: 60 };

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

// spec の検証・整形。成功: { value: Spec | null }(空は null) / 失敗: { error }
//   Spec = { capacity, modes: [{ name, desc }], ranges, cautions: [文字列] }(4項目とも必ずある)
// 既定(strict)は上限超過・型違いを error にする(画面からの入力用)。
// lenient: true は、長すぎる文字列の切り詰め・件数超過の切り捨て・不正な要素の除外を黙って行う(AIの返答・保存済みデータ用)。
export function parseSpec(input, opts = {}) {
  const lenient = !!opts.lenient;
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) return lenient ? { value: null } : { error: "調理家電の仕様の形式が不正です" };
  const L = APPLIANCE_SPEC_LIMITS;

  // 文字列1つ。strict で型違い・超過なら error 文、lenient なら "" / 切り詰め
  const text = (v, max, label) => {
    if (v === undefined || v === null) return { value: "" };
    if (typeof v !== "string") return lenient ? { value: "" } : { error: `${label}の形式が不正です` };
    const t = cleanLine(v);
    if (t.length <= max) return { value: t };
    return lenient ? { value: t.slice(0, max) } : { error: `${label}は長すぎます(${max}文字まで)` };
  };

  const capacity = text(input.capacity, L.capacity, "仕様の容量");
  if (capacity.error) return capacity;
  const ranges = text(input.ranges, L.ranges, "仕様の範囲・温度");
  if (ranges.error) return ranges;

  const modes = [];
  if (input.modes !== undefined && input.modes !== null) {
    if (!Array.isArray(input.modes)) {
      if (!lenient) return { error: "仕様のモードの形式が不正です" };
    } else {
      for (const m of input.modes) {
        if (!m || typeof m !== "object" || Array.isArray(m)) {
          if (lenient) continue;
          return { error: "仕様のモードの形式が不正です" };
        }
        const name = text(m.name, L.modeName, "仕様のモード名");
        if (name.error) return name;
        const desc = text(m.desc, L.modeDesc, "仕様のモードの説明");
        if (desc.error) return desc;
        if (!name.value) {
          if (lenient) continue;
          return { error: "仕様のモード名を入力してください" };
        }
        modes.push({ name: name.value, desc: desc.value });
      }
      if (modes.length > L.modes) {
        if (!lenient) return { error: `仕様のモードは${L.modes}件までです` };
        modes.length = L.modes;
      }
    }
  }

  const cautions = [];
  if (input.cautions !== undefined && input.cautions !== null) {
    if (!Array.isArray(input.cautions)) {
      if (!lenient) return { error: "仕様の注意点の形式が不正です" };
    } else {
      for (const c of input.cautions) {
        const t = text(c, L.caution, "仕様の注意点");
        if (t.error || (typeof c !== "string" && c !== undefined && c !== null)) {
          if (lenient) continue;
          return { error: t.error || "仕様の注意点の形式が不正です" };
        }
        if (t.value) cautions.push(t.value);
      }
      if (cautions.length > L.cautions) {
        if (!lenient) return { error: `仕様の注意点は${L.cautions}件までです` };
        cautions.length = L.cautions;
      }
    }
  }

  if (!capacity.value && !ranges.value && !modes.length && !cautions.length) return { value: null };
  return { value: { capacity: capacity.value, modes, ranges: ranges.value, cautions } };
}

// 成功: { value: [{ name, can, policy, note, spec? }, ...] } / 失敗: { error }
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

    const spec = parseSpec(raw.spec);
    if (spec.error) return spec;

    const key = dedupeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec.value ? { name, can, policy, note, spec: spec.value } : { name, can, policy, note });
  }
  if (out.length > MAX_APPLIANCES) return { error: `登録できるのは${MAX_APPLIANCES}台までです` };
  return { value: out };
}

// 列(またはテーブル)がまだ無い(migration-005 / 007 を実行する前)ときだけ、「登録なし」として扱う。
// こうしておくと、デプロイとマイグレーションの順番を間違えても、レシピ作成そのものは止まらない。
// (保存の方は失敗するので、登録できないことは画面で分かる)
const isMissingSchema = (e) => /no such (table|column)|no column named/i.test(String((e && e.message) || e));

// 注意: 保存済みデータは厳格に検証して読むので、上限(APPLIANCE_SPEC_LIMITS など)を小さくするときは先に移行が必要
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
