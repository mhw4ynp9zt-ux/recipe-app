// POST /api/week/plan  body: { weekStart?, outingDays?: [日付], offDays?: [日付], replace?: boolean }
// → プランの「枠」だけ作る。★AIは呼びません(=この呼び出しだけでは費用は発生しません)★
// 実際の作成は POST /api/week/plan/:id/run(AIを1回呼ぶ。月の回数の上限あり)。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { parsePlanRequest, createPlan, isMissingTable } from "../../_lib/week-plan.js";

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body; try { body = await request.json(); } catch (e) { return json({ error: "リクエストが不正です" }, { status: 400 }); }
  const p = parsePlanRequest(body);
  if (p.error) return json({ error: p.error }, { status: 400 });
  try {
    const r = await createPlan(env, user.id, p.value);
    if (r.error) return json({ error: r.error, id: r.id }, { status: r.status });
    return json({ ok: true, id: r.id });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
