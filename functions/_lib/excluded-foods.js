// ユーザーごとの「使わない食材」(設定タブで登録し、レシピ作成のたびに自動で除外される)。
//   ・parseExcludedFoods … 画面から受け取った一覧の検証・整形
//   ・loadExcludedFoods / saveExcludedFoods … D1(user_settings テーブル)への読み書き
//   ・findExcludedHits   … AIが作ったレシピに、除外した食材が入っていないかの確認(AIは呼ばない)
//
// 注意: 自由に書ける文字列がAIへのプロンプトに入るため、件数と1件の長さを短く制限しています
// (長い文章を書き込んでAIの中継として悪用されるのを防ぐ。ほかの入力欄の上限と同じ考え方)。

export const MAX_EXCLUDED = 30;          // 登録できる件数
export const MAX_EXCLUDED_NAME_LEN = 20; // 1件の最大文字数

function cleanName(value) {
  // 改行などの制御文字は空白にし、連続する空白は1つにまとめる
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

// 照合用に表記ゆれをならす: 全角半角(NFKC)・大文字小文字・カタカナ→ひらがな・空白の除去
// (「エビ」「えび」「海老」のうち、前の2つは同じ食材として扱える。漢字とかなの変換まではしない)
export function matchKey(text) {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

// 成功: { value: ["パクチー", ...] } / 失敗: { error }
// 空の名前は無視し、同じ食材(表記ゆれ含む)の重複は最初の1件だけ残す。
export function parseExcludedFoods(input) {
  if (!Array.isArray(input)) return { error: "使わない食材の形式が不正です" };
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== "string") return { error: "使わない食材の形式が不正です" };
    const name = cleanName(raw);
    if (!name) continue;
    if (name.length > MAX_EXCLUDED_NAME_LEN) {
      return { error: `「${name.slice(0, 8)}…」は長すぎます(1件${MAX_EXCLUDED_NAME_LEN}文字まで)` };
    }
    const key = matchKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (out.length > MAX_EXCLUDED) return { error: `登録できるのは${MAX_EXCLUDED}件までです` };
  return { value: out };
}

// テーブルがまだ無い(migration-005 を実行する前)ときだけ、「登録なし」として扱う。
// こうしておくと、デプロイとマイグレーションの順番を間違えても、レシピ作成そのものは止まらない。
// (保存の方は失敗するので、登録できないことは画面で分かる)
const isMissingTable = (e) => /no such table/i.test(String((e && e.message) || e));

export async function loadExcludedFoods(env, userId) {
  let row;
  try {
    row = await env.DB.prepare("SELECT excluded_foods FROM user_settings WHERE user_id = ?").bind(userId).first();
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
  if (!row || !row.excluded_foods) return [];
  try {
    const parsed = parseExcludedFoods(JSON.parse(row.excluded_foods));
    return parsed.value || [];
  } catch (e) {
    return [];
  }
}

// list は parseExcludedFoods で整えたもの。返り値: 保存した一覧
export async function saveExcludedFoods(env, userId, list, now = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, excluded_foods, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET excluded_foods = excluded.excluded_foods, updated_at = excluded.updated_at`
  ).bind(userId, JSON.stringify(list), now).run();
  return list;
}

// AIが作ったレシピ(dishes)の中に、除外した食材が含まれていないかを調べる。
// 料理名・食材名・成分表の食品名(food)に、除外した食材の名前が(表記ゆれをならしたうえで)含まれていれば「含まれている」とする。
// 「豚肉」のような大きな分類は「豚ロース」とは一致しない(AIへの指示で避けさせている)。ここは取りこぼしを減らすための最後の確認。
// 返り値: 含まれていた除外食材の名前(登録した表記のまま・重複なし)
export function findExcludedHits(dishes, excluded) {
  if (!Array.isArray(excluded) || !excluded.length) return [];
  const keys = excluded.map((name) => ({ name, key: matchKey(name) })).filter((x) => x.key);
  const hits = new Set();
  for (const dish of dishes || []) {
    const texts = [dish && dish.name];
    if (dish && Array.isArray(dish.ingredientDetails) && dish.ingredientDetails.length) {
      for (const d of dish.ingredientDetails) texts.push(d && d.name, d && d.food);
    } else if (dish && Array.isArray(dish.ingredients)) {
      texts.push(...dish.ingredients);
    }
    for (const t of texts) {
      if (typeof t !== "string" || !t) continue;
      const k = matchKey(t);
      for (const x of keys) if (k.includes(x.key)) hits.add(x.name);
    }
  }
  return [...hits];
}
