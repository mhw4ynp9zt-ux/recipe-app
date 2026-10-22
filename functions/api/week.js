// GET /api/week?week=YYYY-MM-DD(月曜。省略すると今週) → 週プラン(各日の料理・1週間の栄養・買い物リスト・今月の残り回数)。AIは呼ばない。
import { getSessionUser, json } from "../_lib/session.js";
import { isValidDay, todayJst, weekStartOf } from "../_lib/meals.js";
import { loadPlan, weekSummary, isMissingTable, stageText } from "../_lib/week-plan.js";
import { buildShopping } from "../_lib/shopping.js";
import { loadPantry } from "./user/pantry.js";
import { usedMonthly, MONTHLY_CAPS } from "../_lib/kondate-usage.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("week");
  if (q && !isValidDay(q)) return json({ error: "日付が不正です" }, { status: 400 });
  const weekStart = weekStartOf(q || todayJst());
  try {
    const plan = await loadPlan(env, user.id, "week", weekStart);
    const used = await usedMonthly(env, user.id, "week");
    const quota = { used, cap: MONTHLY_CAPS.week, remaining: Math.max(0, MONTHLY_CAPS.week - used) };
    if (!plan) return json({ weekStart, plan: null, quota }, { headers: { "Cache-Control": "no-store" } });
    let pantry = []; try { pantry = await loadPantry(env, user.id); } catch (e) { /* 未導入なら空 */ }
    return json({
      weekStart, quota,
      plan: { id: plan.id, status: plan.status, stage: plan.stage, stageText: stageText(plan.stage), progress: plan.progress, error: plan.error, days: plan.days, pending: plan.request.fill || [] },
      summary: weekSummary(plan.days),
      shopping: buildShopping(plan.days, pantry, plan.shopping.checked || []),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
