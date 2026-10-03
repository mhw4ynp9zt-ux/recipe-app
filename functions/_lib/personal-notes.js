// ユーザーごとの「個人的な要望」(調理環境・好みなど。設定タブで登録し、レシピ作成のたびに自動でAIの条件に加わる)。
//   例: 「コンロが1つなので、ガスコンロを使うレシピは1提案につき1つまで」
//       「〇〇社のスープポットを使っているので、スープ系はそのスープポットで作れるレシピにして」
//   ・parsePersonalNotes … 画面から受け取った一覧の検証・整形
//   ・loadPersonalNotes / savePersonalNotes … D1(user_settings テーブルの personal_notes 列)への読み書き
//
// 注意: 自由に書ける文字列がAIへのプロンプトに入るため、行数と1行の長さを制限しています
// (長い文章を書き込んでAIの中継として悪用されるのを防ぐ。「使わない食材」・食材/雰囲気の入力欄と同じ考え方)。
// 要望を守れたかどうかはコードでは判定できないため、守られなかったときの自動の作り直しはしません
// (判定を足すとAIの呼び出しが増え、費用に直結するため。MAX_ATTEMPTS / MAX_AI_CALLS は変わりません)。

export const MAX_NOTE_LINES = 10;     // 登録できる行数(1行=1つの要望)
export const MAX_NOTE_LINE_LEN = 150; // 1行の最大文字数

function cleanLine(value) {
  // 改行などの制御文字は空白にし、連続する空白は1つにまとめる
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// 重複の判定用に、全角半角(NFKC)・大文字小文字・空白をならす
function dedupeKey(text) {
  return String(text).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// 成功: { value: ["要望1", ...] } / 失敗: { error }
// 空の行は無視し、同じ内容(表記ゆれ含む)の重複は最初の1行だけ残す。全部消して保存(空配列)もできる。
export function parsePersonalNotes(input) {
  if (!Array.isArray(input)) return { error: "個人的な要望の形式が不正です" };
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== "string") return { error: "個人的な要望の形式が不正です" };
    const line = cleanLine(raw);
    if (!line) continue;
    if (line.length > MAX_NOTE_LINE_LEN) {
      return { error: `「${line.slice(0, 8)}…」は長すぎます(1行${MAX_NOTE_LINE_LEN}文字まで)` };
    }
    const key = dedupeKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  if (out.length > MAX_NOTE_LINES) return { error: `登録できるのは${MAX_NOTE_LINES}行までです` };
  return { value: out };
}

// 列(またはテーブル)がまだ無い(migration-005 / 006 を実行する前)ときだけ、「要望なし」として扱う。
// こうしておくと、デプロイとマイグレーションの順番を間違えても、レシピ作成そのものは止まらない。
// (保存の方は失敗するので、登録できないことは画面で分かる)
const isMissingSchema = (e) => /no such (table|column)|no column named/i.test(String((e && e.message) || e));

export async function loadPersonalNotes(env, userId) {
  let row;
  try {
    row = await env.DB.prepare("SELECT personal_notes FROM user_settings WHERE user_id = ?").bind(userId).first();
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
  if (!row || !row.personal_notes) return [];
  try {
    const parsed = parsePersonalNotes(JSON.parse(row.personal_notes));
    return parsed.value || [];
  } catch (e) {
    return [];
  }
}

// list は parsePersonalNotes で整えたもの。返り値: 保存した一覧
// 「使わない食材」(excluded_foods 列)には触れない(行が無ければ excluded_foods は既定値 '[]' で作られる)。
export async function savePersonalNotes(env, userId, list, now = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, personal_notes, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET personal_notes = excluded.personal_notes, updated_at = excluded.updated_at`
  ).bind(userId, JSON.stringify(list), now).run();
  return list;
}
