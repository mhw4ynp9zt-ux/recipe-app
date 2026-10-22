// PATCH  /api/week/plan/:id  body: { action: "outing"|"off"|"cook"|"swap", date, recipeId? } → 日ごとの変更(AIは呼ばない)
//        または { action: "edit", date, slot?, draft: { name, ingredients: [{name, grams, food?}], steps } } → その食事のレシピを直す(栄養は成分表からコードで再計算。保存済みレシピは変えない)
//        または { action: "eaten", date, slot?, eaten: true|false } → 「食べた」の記録/取り消し
//        または { action: "check", key, checked } → 買い物リストのチェック
//        または { action: "favor", metric: "fiber"|"protein"|"veg"|null } → 作り直しのときに多めにしたい栄養(ふりかえりのヒント)
// DELETE /api/week/plan/:id  → プランを消す
import { getSessionUser, checkOrigin, json } from "../../../_lib/session.js";
import { loadPlan, changeDay, setEaten, isMissingTable } from "../../../_lib/week-plan.js";

export async function onRequestPatch({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body; try { body = await request.json(); } catch (e) { return json({ error: "リクエストが不正です" }, { status: 400 }); }
  if (!body || typeof body !== "object") return json({ error: "リクエストが不正です" }, { status: 400 });
  try {
    const plan = await loadPlan(env, user.id, "id", String(params.id || ""));
    if (!plan) return json({ error: "プランが見つかりません" }, { status: 404 });
    if (body.action === "check") {
      if (typeof body.key !== "string" || !body.key || body.key.length > 80 || typeof body.checked !== "boolean") return json({ error: "リクエストが不正です" }, { status: 400 });
      const set = new Set(plan.shopping.checked || []);
      if (body.checked) set.add(body.key); else set.delete(body.key);
      await env.DB.prepare("UPDATE week_plans SET shopping = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify({ checked: [...set].slice(0, 300) }), plan.id, user.id).run();
      return json({ ok: true });
    }
    if (body.action === "favor") {
      if (body.metric !== null && !["fiber", "protein", "veg"].includes(body.metric)) return json({ error: "リクエストが不正です" }, { status: 400 });
      const request2 = { ...plan.request, favor: body.metric };
      await env.DB.prepare("UPDATE week_plans SET request = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(request2), plan.id, user.id).run();
      return json({ ok: true });
    }
    if (plan.status === "running" && plan.lease_until > Date.now()) return json({ error: "いま作成中です。少し待ってからお試しください" }, { status: 409 });
    if (body.action === "eaten") {
      const e = await setEaten(env, user.id, plan, body);
      if (e.error) return json({ error: e.error }, { status: e.status });
      return json({ ok: true, eaten: e.eaten });
    }
    const r = await changeDay(env, user.id, plan, body);
    if (r.error) return json({ error: r.error, ...(r.fields ? { fields: r.fields } : {}) }, { status: r.status });
    return json({ ok: true, days: r.days, pending: r.request.fill });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "この機能はまだ準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  const r = await env.DB.prepare("DELETE FROM week_plans WHERE id = ? AND user_id = ?").bind(String(params.id || ""), user.id).run();
  return r.meta.changes > 0 ? json({ ok: true }) : json({ error: "プランが見つかりません" }, { status: 404 });
}
