// POST /api/recipes/import  body: { token } → 共有リンクのレシピを、自分の保存済みにコピーする(写真も一緒に)
// 取り込んだレシピは新しいidの自分のレシピになり、共有元とは切り離される。AIも外部APIも呼ばない。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { TOKEN_RE, newRecipeId, stripAnnotations, withMediaTables, annotateRecipe } from "../../_lib/share.js";

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }
  const token = body && typeof body.token === "string" ? body.token : "";
  if (!TOKEN_RE.test(token)) return json({ error: "共有リンクが見つかりません" }, { status: 404 });
  return withMediaTables(async () => {
    const row = await env.DB.prepare("SELECT snapshot, photo_mime, photo_data FROM recipe_shares WHERE token = ?").bind(token).first();
    if (!row) return json({ error: "共有リンクが見つかりません(共有が止められた可能性があります)" }, { status: 404 });
    const id = newRecipeId();
    const recipe = { ...stripAnnotations(JSON.parse(row.snapshot)), id };
    await env.DB.prepare("INSERT INTO recipes (id, user_id, data) VALUES (?, ?, ?)").bind(id, user.id, JSON.stringify(recipe)).run();
    const photos = {};
    if (row.photo_mime && row.photo_data) {
      const now = Date.now();
      await env.DB.prepare("INSERT INTO recipe_photos (user_id, recipe_id, mime, data, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(user.id, id, row.photo_mime, row.photo_data, now).run();
      photos[id] = now;
    }
    return json({ recipe: annotateRecipe(recipe, photos, {}) });
  });
}
