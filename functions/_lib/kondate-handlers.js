// 週プランの実行・写真の栄養計算の「本体の流れ」。AIの部品は deps で受け取る(本番は入口のAPIが本物を渡し、テストは偽物を渡す)。
import { runPlan, loadPlan } from "./week-plan.js";
import { attachNutrition } from "./nutrition.js";
import { parseImageDataUrl } from "./photo.js";
import * as M from "./kondate-messages.js";

const GLOBAL_BUSY = "ただいま混み合っています。しばらくしてからお試しください";

export async function runPlanHandler(env, user, planId, deps) {
  const r = await runPlan(env, user.id, planId, deps);
  if (r.ok) {
    const plan = await loadPlan(env, user.id, "id", planId);
    return { status: 200, body: { ok: true, filled: r.filled, skipped: r.skipped, status: plan.status, stage: plan.stage, progress: plan.progress } };
  }
  const msg = r.error === "limit-user" ? M.PLAN_LIMIT : r.error === "limit-global" ? GLOBAL_BUSY : r.status === 404 || r.status === 409 ? r.error : M.PLAN_FAIL;
  return { status: r.status === 429 ? 429 : r.status === 404 ? 404 : r.status === 409 ? 409 : 502, body: { error: msg, limit: r.error === "limit-user" || r.error === "limit-global" } };
}

const PHOTO_PROMPT = 'この写真に写っている料理を読み取り、JSONのみで出力してください(前置き・説明・コードブロック記号は不要)。\n' +
  '・写っている料理ごとに、使われていそうな食材と、見た目から推定した正味の量(g)を書く\n' +
  '・量は見た目の大きさ(皿・茶碗・箸との比較)から控えめに推定する。わからない食材は書かない\n' +
  '・食事ではない写真・料理が写っていない写真のときは {"dishes": []} と出力する\n' +
  '・栄養量は出力しない(こちらで成分表から計算する)\n' +
  '・food は日本食品標準成分表(八訂)の食品名に合わせる(例: "こめ [水稲めし] 精白米 うるち米", "ぶた ロース 脂身つき 生")\n' +
  '形式: {"dishes":[{"name":"料理名","ingredients":[{"name":"食材名","amount":"分量の表記","grams":数値,"food":"成分表の食品名"}]}]}';

// 写真から料理と量を推定し、成分表で栄養を計算して返す(保存はしない。ユーザーが確認・修正してから /api/meals に記録する)。
// 写真は保存しない(メモリ上でAIに送るだけ。ログにも残さない)。
export async function photoEstimateHandler(env, user, body, deps) {
  const img = parseImageDataUrl(body && body.image);
  if (!img.ok) return { status: 400, body: { error: img.error } };       // 画像として不正なら、回数を使わずに終える
  const mo = await deps.reserveMonthly(env, user.id, "photo");
  if (!mo.ok) return { status: 429, body: { error: M.PHOTO_LIMIT, limit: true } };
  const gl = await deps.reserveGlobal(env);
  if (!gl.ok) { await deps.refundMonthly(env, user.id, "photo", mo.month); return { status: 429, body: { error: GLOBAL_BUSY, limit: true } }; }
  const refundAll = async () => { await deps.refundGlobal(env, gl.day); await deps.refundMonthly(env, user.id, "photo", mo.month); };
  try {
    const ai = await deps.callVision(PHOTO_PROMPT, body.image); // ← AIを呼ぶのはここ1回だけ
    if (!ai || ai.content === undefined) { await refundAll(); return { status: 502, body: { error: M.PHOTO_FAIL } }; }
    const dishes = parseLoose(ai.content);
    if (!dishes || !dishes.length) { await refundAll(); return { status: 422, body: { error: M.PHOTO_FAIL } }; }
    await attachNutrition(env, dishes, []);
    return { status: 200, body: { approx: true, note: M.PHOTO_APPROX, dishes: dishes.map((d) => ({
      name: d.name, nutrition: d.nutrition, nutritionCheck: d.nutritionCheck,
      ingredients: d.ingredientDetails.map((i) => ({ name: i.name, grams: i.grams, matched: !!i.match })),
    })) } };
  } catch (e) {
    console.error("photoEstimate failed");
    await refundAll();
    return { status: 500, body: { error: M.PHOTO_FAIL } };
  }
}

// 写真の返答には手順が無いので、parseDishes(手順必須)を通らない。材料だけの形を自分で整える。
function parseLoose(content) {
  let parsed;
  try { parsed = JSON.parse(String(content).replace(/```json|```/g, "").trim()); } catch (e) { return null; }
  const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.dishes) ? parsed.dishes : null;
  if (!items) return null;
  const out = [];
  for (const it of items.slice(0, 6)) {
    if (!it || typeof it.name !== "string" || !Array.isArray(it.ingredients)) continue;
    const ing = it.ingredients.slice(0, 20).map((x) => {
      const g = Number(x && x.grams);
      if (!x || typeof x.name !== "string" || !x.name.trim() || !Number.isFinite(g) || g <= 0 || g > 3000) return null;
      return { name: x.name.trim().slice(0, 40), amount: typeof x.amount === "string" ? x.amount.slice(0, 40) : g + "g", grams: g, food: typeof x.food === "string" ? x.food.slice(0, 100) : "" };
    }).filter(Boolean);
    if (ing.length) out.push({ name: it.name.trim().slice(0, 60), ingredientDetails: ing });
  }
  return out;
}
