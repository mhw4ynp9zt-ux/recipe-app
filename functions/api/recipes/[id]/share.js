// レシピの共有リンク(1レシピに1リンク)。AIも外部APIも呼ばない(外部通信をしない)。
// POST   /api/recipes/:id/share → 共有リンクを作る。すでにあれば、同じリンクのまま中身を今のレシピに更新する
// DELETE /api/recipes/:id/share → 共有をやめる(リンクは見られなくなる)
// 共有されるのは buildSnapshot が抜き出した項目(料理名・材料・作り方・栄養・写真)だけで、個人の情報は含まれない。
import { getSessionUser, checkOrigin, json } from "../../../_lib/session.js";
import { buildSnapshot, newToken, withMediaTables, publicOrigin, MAX_SHARES_PER_USER } from "../../../_lib/share.js";

export async function onRequestPost({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  return withMediaTables(async () => {
    const row = await env.DB.prepare("SELECT data FROM recipes WHERE user_id = ? AND id = ?").bind(user.id, params.id).first();
    if (!row) return json({ error: "レシピが見つかりません" }, { status: 404 });
    let snapshot;
    try {
      snapshot = buildSnapshot(JSON.parse(row.data));
    } catch (e) {
      return json({ error: "このレシピは共有できません" }, { status: 400 });
    }
    const photo = await env.DB.prepare("SELECT mime, data FROM recipe_photos WHERE user_id = ? AND recipe_id = ?")
      .bind(user.id, params.id).first();
    const now = Date.now();
    const existing = await env.DB.prepare("SELECT token FROM recipe_shares WHERE user_id = ? AND recipe_id = ?")
      .bind(user.id, params.id).first();
    let token;
    if (existing) {
      token = existing.token;
      await env.DB.prepare(
        "UPDATE recipe_shares SET snapshot = ?, photo_mime = ?, photo_data = ?, updated_at = ? WHERE token = ?"
      ).bind(JSON.stringify(snapshot), photo ? photo.mime : null, photo ? photo.data : null, now, token).run();
    } else {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipe_shares WHERE user_id = ?").bind(user.id).first();
      if (count && count.n >= MAX_SHARES_PER_USER) {
        return json({ error: `共有できるレシピは${MAX_SHARES_PER_USER}件までです。使っていない共有を止めてください` }, { status: 400 });
      }
      token = newToken();
      await env.DB.prepare(
        `INSERT INTO recipe_shares (token, user_id, recipe_id, snapshot, photo_mime, photo_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(token, user.id, params.id, JSON.stringify(snapshot), photo ? photo.mime : null, photo ? photo.data : null, now, now).run();
    }
    return json({ token, url: `${publicOrigin(request, env)}/?share=${token}` });
  });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  return withMediaTables(async () => {
    await env.DB.prepare("DELETE FROM recipe_shares WHERE user_id = ? AND recipe_id = ?").bind(user.id, params.id).run();
    return json({ ok: true });
  });
}
