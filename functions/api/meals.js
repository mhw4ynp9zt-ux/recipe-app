// GET  /api/meals?day=YYYY-MM-DD → その日の食事の記録
// POST /api/meals               → 1件記録(保存済みレシピ / 食材のグラム / かんたん入力)
// AIは呼ばない。
import { getSessionUser, json, checkOrigin } from "../_lib/session.js";
import { parseMealRequest, resolveMeal, addMeal, listMeals, isValidDay, isMissingTable, todayJst, sumNutrition } from "../_lib/meals.js";

const UNAVAILABLE = { error: "食事の記録に必要なデータベースの更新(マイグレーション)がまだ適用されていません", unavailable: true };

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  const day = new URL(request.url).searchParams.get("day") || todayJst();
  if (!isValidDay(day)) return json({ error: "日付が不正です" }, { status: 400 });
  try {
    const meals = await listMeals(env, user.id, day, day);
    return json({ day, meals, ...sumNutrition(meals) });
  } catch (e) {
    if (isMissingTable(e)) return json(UNAVAILABLE, { status: 503 });
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body; try { body = await request.json(); } catch (e) { return json({ error: "リクエストが不正です" }, { status: 400 }); }
  const p = parseMealRequest(body);
  if (p.error) return json({ error: p.error }, { status: 400 });
  try {
    const r = await resolveMeal(env, user.id, p.value);
    if (r.error) return json({ error: r.error }, { status: r.status });
    const a = await addMeal(env, user.id, p.value, r);
    if (a.error) return json({ error: a.error }, { status: a.status });
    return json({ ok: true, id: a.id, name: r.name, nutrition: r.nutrition, approx: r.approx });
  } catch (e) {
    if (isMissingTable(e)) return json(UNAVAILABLE, { status: 503 });
    throw e;
  }
}
