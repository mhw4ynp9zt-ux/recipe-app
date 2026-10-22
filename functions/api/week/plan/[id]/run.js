// POST /api/week/plan/:id/run  body: { slot?: "breakfast"|"lunch"|"dinner" } → 決まっていない日の、1つの食事(朝食・昼食・夕食)を、AIに頼んで埋める。★AI(有料)を1回呼びます★
// slot を省くと、決まっていない食事がある最初の食事。3食ぶん頼むときは、画面が食事ごとに1回ずつ(確認のあとに)呼びます。サーバーが続けて呼ぶことはありません。
// 回数の決まり: ユーザーごとに月12回まで(kondate-usage.js)+ アプリ全体の1日の上限。AIが失敗したら両方とも戻ります。
// 再試行はしません。仕組みは functions/_lib/week-plan.js の冒頭を参照してください。
import { getSessionUser, checkOrigin, json } from "../../../../_lib/session.js";
import { makeAiDeps } from "../../../../_lib/kondate-ai.js";
import { runPlanHandler } from "../../../../_lib/kondate-handlers.js";

export async function onRequestPost({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let slot;
  try { const b = await request.json(); if (b && typeof b === "object" && b.slot !== undefined) slot = b.slot; } catch (e) { /* 本文なし(従来の呼び方) */ }
  try {
    const r = await runPlanHandler(env, user, String(params.id || ""), makeAiDeps(env), { slot });
    return json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
