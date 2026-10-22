// GET /api/user/pantry → 家にある食材(買い物リストから外す)/ PUT → 保存。AIは呼ばない。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { parsePantry } from "../../_lib/shopping.js";

const isMissing = (e) => /no such table/i.test(String((e && e.message) || e));
const UNAVAILABLE = { error: "この機能はまだ準備中です", unavailable: true };

export async function loadPantry(env, userId) {
  const row = await env.DB.prepare("SELECT items FROM user_pantry WHERE user_id = ?").bind(userId).first();
  if (!row) return [];
  try { const v = JSON.parse(row.items); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch (e) { return []; }
}

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  try { return json({ items: await loadPantry(env, user.id) }); } catch (e) { if (isMissing(e)) return json(UNAVAILABLE, { status: 503 }); throw e; }
}

export async function onRequestPut({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body; try { body = await request.json(); } catch (e) { return json({ error: "リクエストが不正です" }, { status: 400 }); }
  const p = parsePantry(body && body.items);
  if (p.error) return json({ error: p.error }, { status: 400 });
  try {
    await env.DB.prepare(
      `INSERT INTO user_pantry (user_id, items, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`
    ).bind(user.id, JSON.stringify(p.value), Date.now()).run();
    return json({ items: p.value });
  } catch (e) { if (isMissing(e)) return json(UNAVAILABLE, { status: 503 }); throw e; }
}
