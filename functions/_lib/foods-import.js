// 成分表データ(data/foods.json)をD1に取り込む処理。管理者専用APIから呼ばれます。
// ブラウザ(import-foods.html)が100件ずつに分けて送り、ここで検証して foods テーブルに入れます。
// INSERT OR REPLACE なので、何度実行しても同じ結果になります(途中で止まっても最初からやり直せます)。

import { FOODS_COLUMNS, DDL, GROUPS, NUTRIENT_DEFS } from "./foods-schema.js";

const MAX_ROWS_PER_REQUEST = 100; // 1リクエストの食品数。D1は1クエリの変数が100個までなので、1行ずつ59個で入れる

function isNumOrNull(v) {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}
function isStrOrNull(v, max) {
  return v === null || (typeof v === "string" && v.length <= max);
}

// 行の形を確認する。正しければ null、問題があれば理由の文字列を返す
function validateRow(row) {
  if (!Array.isArray(row) || row.length !== FOODS_COLUMNS.length) return "列の数が違います";
  if (typeof row[0] !== "string" || !/^[0-9]{5}$/.test(row[0])) return "食品番号が不正です";
  if (typeof row[1] !== "string" || !/^[0-9]{2}$/.test(row[1])) return "食品群が不正です";
  if (!isStrOrNull(row[2], 20)) return "索引番号が不正です";
  if (typeof row[3] !== "string" || !row[3] || row[3].length > 300) return "食品名が不正です";
  for (let i = 4; i < row.length - 1; i++) {
    if (!isNumOrNull(row[i])) return FOODS_COLUMNS[i] + " の値が不正です";
  }
  if (!isStrOrNull(row[row.length - 1], 2000)) return "備考が不正です";
  return null;
}

async function ensureFoodTables(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
}

async function countFoods(env) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM foods").first();
    return row ? row.n : 0;
  } catch (e) {
    return 0; // テーブルがまだ無い
  }
}

// body: { init?: true, rows: [[...], ...] }  成功: { ok: true, imported, total } / 失敗: { error }
async function importFoodsChunk(env, body) {
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length > MAX_ROWS_PER_REQUEST) return { error: "一度に送れるのは" + MAX_ROWS_PER_REQUEST + "件までです" };
  for (let i = 0; i < rows.length; i++) {
    const problem = validateRow(rows[i]);
    if (problem) return { error: (i + 1) + "件目: " + problem };
  }

  await ensureFoodTables(env);

  const stmts = [];
  if (body.init === true) {
    GROUPS.forEach(([code, name]) => {
      stmts.push(env.DB.prepare("INSERT OR REPLACE INTO food_groups (group_code, group_name) VALUES (?, ?)").bind(code, name));
    });
    NUTRIENT_DEFS.forEach(([code, column, label, unit, sortNo]) => {
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO nutrient_defs (code, "column", label, unit, sort_no) VALUES (?, ?, ?, ?, ?)')
        .bind(code, column, label, unit, sortNo));
    });
  }
  const insertSql = "INSERT OR REPLACE INTO foods (" + FOODS_COLUMNS.join(", ") + ") VALUES (" + FOODS_COLUMNS.map(() => "?").join(", ") + ")";
  rows.forEach((row) => stmts.push(env.DB.prepare(insertSql).bind(...row)));
  if (stmts.length) await env.DB.batch(stmts);

  return { ok: true, imported: rows.length, total: await countFoods(env) };
}

export { importFoodsChunk, countFoods, MAX_ROWS_PER_REQUEST };
