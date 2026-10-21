// 料理の写真(1レシピに1枚)。AIも外部APIも呼ばない(外部通信をしない)。
// GET    /api/recipes/:id/photo → 自分のレシピの写真(画像そのもの。ログイン中の本人だけ)
// PUT    /api/recipes/:id/photo → 写真を付ける・差し替える(body: { image: "data:image/jpeg;base64,…" })
// DELETE /api/recipes/:id/photo → 写真を外す
import { getSessionUser, checkOrigin, json } from "../../../_lib/session.js";
import { parseImageDataUrl, base64ToBytes, imageHeaders, PHOTO_MAX_REQUEST_CHARS } from "../../../_lib/photo.js";
import { withMediaTables } from "../../../_lib/share.js";

async function ownsRecipe(env, userId, id) {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM recipes WHERE user_id = ? AND id = ?").bind(userId, id).first();
  return !!row;
}

export async function onRequestGet({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  return withMediaTables(async () => {
    const row = await env.DB.prepare("SELECT mime, data FROM recipe_photos WHERE user_id = ? AND recipe_id = ?")
      .bind(user.id, params.id).first();
    if (!row) return json({ error: "写真がありません" }, { status: 404 });
    return new Response(base64ToBytes(row.data), { headers: imageHeaders(row.mime, "private, max-age=86400") });
  });
}

export async function onRequestPut({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > PHOTO_MAX_REQUEST_CHARS + 100) return json({ error: "画像が大きすぎます" }, { status: 413 });
  let body;
  try {
    const text = await request.text();
    if (text.length > PHOTO_MAX_REQUEST_CHARS + 100) return json({ error: "画像が大きすぎます" }, { status: 413 });
    body = JSON.parse(text);
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }
  const img = parseImageDataUrl(body && body.image);
  if (!img.ok) return json({ error: img.error }, { status: 400 });
  return withMediaTables(async () => {
    if (!(await ownsRecipe(env, user.id, params.id))) return json({ error: "レシピが見つかりません" }, { status: 404 });
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO recipe_photos (user_id, recipe_id, mime, data, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, recipe_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`
    ).bind(user.id, params.id, img.mime, img.b64, now).run();
    return json({ ok: true, photoUrl: `/api/recipes/${encodeURIComponent(params.id)}/photo?v=${now}` });
  });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  return withMediaTables(async () => {
    await env.DB.prepare("DELETE FROM recipe_photos WHERE user_id = ? AND recipe_id = ?").bind(user.id, params.id).run();
    return json({ ok: true });
  });
}
