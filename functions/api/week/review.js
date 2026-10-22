// GET /api/week/review?week=YYYY-MM-DD(月曜) → 週の振り返り(良かった点・ヒント1つ・直近4週の平均)。AIは呼ばない。
import { getSessionUser, json } from "../../_lib/session.js";
import { listMeals, isValidDay, isMissingTable, todayJst, weekStartOf, addDays } from "../../_lib/meals.js";
import { loadEffectiveTargets } from "../../_lib/targets.js";
import { buildReview } from "../../_lib/balance.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("week");
  if (q && !isValidDay(q)) return json({ error: "日付が不正です" }, { status: 400 });
  const weekStart = weekStartOf(q || todayJst());
  try {
    const weekEnd = addDays(weekStart, 6);
    const week = await listMeals(env, user.id, weekStart, weekEnd);
    const four = await listMeals(env, user.id, addDays(weekStart, -21), weekEnd);
    const { stored, built } = await loadEffectiveTargets(env, user.id);
    return json(buildReview(weekStart, week, four, built ? built.effective : {}, { showNumbers: stored.showNumbers }), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
