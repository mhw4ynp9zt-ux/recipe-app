// GET  /api/recipes       → ログイン中ユーザーの保存済みレシピ一覧
// POST /api/recipes       → レシピを1件保存(body: レシピオブジェクトそのもの。idは必須)

import { getSessionUser, json } from "../_lib/session.js";
import { annotateRecipe, stripAnnotations } from "../_lib/share.js";

// 写真と共有リンクの有無(画像の中身は読まない)。テーブルが未作成(マイグレーション未適用)でも、一覧は今までどおり返す
async function loadMediaMaps(env, userId) {
  const photos = {};
  const shares = {};
  try {
    const p = await env.DB.prepare("SELECT recipe_id, updated_at FROM recipe_photos WHERE user_id = ?").bind(userId).all();
    p.results.forEach((r) => { photos[r.recipe_id] = r.updated_at; });
    const s = await env.DB.prepare("SELECT recipe_id, token FROM recipe_shares WHERE user_id = ?").bind(userId).all();
    s.results.forEach((r) => { shares[r.recipe_id] = r.token; });
  } catch (e) { /* 写真・共有の機能が未導入なら、付け足しなしで返す */ }
  return { photos, shares };
}

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });

  const { results } = await env.DB.prepare(
    "SELECT data FROM recipes WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(user.id).all();

  const { photos, shares } = await loadMediaMaps(env, user.id);
  const recipes = results.map((row) => annotateRecipe(JSON.parse(row.data), photos, shares));
  return json({ recipes });
}

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });

  let recipe;
  try {
    recipe = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (!recipe || !recipe.id) {
    return json({ error: "レシピのidが必要です" }, { status: 400 });
  }

  // 画面表示用の付け足し(写真のURL・共有トークン)は、レシピ本体には保存しない
  await env.DB.prepare(
    `INSERT INTO recipes (id, user_id, data) VALUES (?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data`
  ).bind(recipe.id, user.id, JSON.stringify(stripAnnotations(recipe))).run();

  return json({ ok: true });
}
