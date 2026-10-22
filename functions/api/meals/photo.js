// POST /api/meals/photo  body: { image: "data:image/jpeg;base64,…" }
// 写真から料理と量を推定して返す(記録はしない。写真は保存しない)。★AI(有料)を1回呼びます★
// 月ごとの回数の上限(ユーザー別)と、アプリ全体の1日の上限があり、失敗したら回数は戻ります。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { makeAiDeps } from "../../_lib/kondate-ai.js";
import { photoEstimateHandler } from "../../_lib/kondate-handlers.js";

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body; try { body = await request.json(); } catch (e) { return json({ error: "リクエストが不正です" }, { status: 400 }); }
  try {
    const r = await photoEstimateHandler(env, user, body, makeAiDeps(env));
    return json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
