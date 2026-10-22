// GET /api/today?day=YYYY-MM-DD → その日の食事の記録・写真の今月の残り回数。AIは呼ばない。
// (「今日のバランス」「次の食事のおすすめ」は、週プランと週の振り返りがあるため、画面から外した。栄養の合計と目標との比較は、週の振り返り(/api/week/review)にある)
import { getSessionUser, json } from "../_lib/session.js";
import { listMeals, isValidDay, isMissingTable, todayJst } from "../_lib/meals.js";
import { loadEffectiveTargets } from "../_lib/targets.js";
import { usedMonthly, MONTHLY_CAPS } from "../_lib/kondate-usage.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  const day = new URL(request.url).searchParams.get("day") || todayJst();
  if (!isValidDay(day)) return json({ error: "日付が不正です" }, { status: 400 });
  try {
    const meals = await listMeals(env, user.id, day, day);
    const { stored } = await loadEffectiveTargets(env, user.id); // 「数字を隠す」設定だけ使う
    const photoUsed = await usedMonthly(env, user.id, "photo");
    const quota = { photo: { used: photoUsed, cap: MONTHLY_CAPS.photo, remaining: Math.max(0, MONTHLY_CAPS.photo - photoUsed) } };
    return json({ day, meals, showNumbers: stored.showNumbers !== false, quota }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
