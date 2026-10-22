// GET /api/today?day=YYYY-MM-DD → 今日の食事の記録・バランス(ゲージ)・次の食事のおすすめ。AIは呼ばない。
import { getSessionUser, json } from "../_lib/session.js";
import { listMeals, sumNutrition, isValidDay, isMissingTable, todayJst } from "../_lib/meals.js";
import { loadEffectiveTargets } from "../_lib/targets.js";
import { buildBalance, suggestNext } from "../_lib/balance.js";
import { usedMonthly, MONTHLY_CAPS } from "../_lib/kondate-usage.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  const day = new URL(request.url).searchParams.get("day") || todayJst();
  if (!isValidDay(day)) return json({ error: "日付が不正です" }, { status: 400 });
  try {
    const meals = await listMeals(env, user.id, day, day);
    const { totals, approx } = sumNutrition(meals);
    const { stored, built } = await loadEffectiveTargets(env, user.id);
    const effective = built ? built.effective : {};
    const balance = buildBalance(totals, effective, { hasMeals: meals.length > 0, approx, showNumbers: stored.showNumbers });
    let next = null;
    if (meals.length && balance.gauges.length) {
      const { results } = await env.DB.prepare("SELECT data FROM recipes WHERE user_id = ?").bind(user.id).all();
      const recipes = results.map((r) => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
      next = suggestNext(balance.gauges, recipes);
    }
    const photoUsed = await usedMonthly(env, user.id, "photo");
    const quota = { photo: { used: photoUsed, cap: MONTHLY_CAPS.photo, remaining: Math.max(0, MONTHLY_CAPS.photo - photoUsed) } };
    return json({ day, meals, balance, next, quota, hasTargets: !!built && Object.keys(effective).length > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
