// GET  /api/recipes       → ログイン中ユーザーの保存済みレシピ一覧
// POST /api/recipes       → レシピを1件保存(body: レシピオブジェクトそのもの。idは必須)

import { getSessionUser, json } from "../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });

  const { results } = await env.DB.prepare(
    "SELECT data FROM recipes WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(user.id).all();

  const recipes = results.map((row) => JSON.parse(row.data));
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

  await env.DB.prepare(
    `INSERT INTO recipes (id, user_id, data) VALUES (?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data`
  ).bind(recipe.id, user.id, JSON.stringify(recipe)).run();

  return json({ ok: true });
}
