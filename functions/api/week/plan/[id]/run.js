// POST /api/week/plan/:id/run → 決まっていない日の夕食を、AIに頼んで埋める。★AI(有料)を1回呼びます★
// 回数の決まり: ユーザーごとに月12回まで(kondate-usage.js)+ アプリ全体の1日の上限。AIが失敗したら両方とも戻ります。
// 再試行はしません。仕組みは functions/_lib/week-plan.js の冒頭を参照してください。
import { getSessionUser, checkOrigin, json } from "../../../../_lib/session.js";
import { makeAiDeps } from "../../../../_lib/kondate-ai.js";
import { runPlanHandler } from "../../../../_lib/kondate-handlers.js";

export async function onRequestPost({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  try {
    const r = await runPlanHandler(env, user, String(params.id || ""), makeAiDeps(env));
    return json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (/no such table/i.test(String(e && e.message))) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
