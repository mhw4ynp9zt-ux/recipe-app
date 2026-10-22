// 週プラン(1週間ぶんの朝食・昼食・夕食)。このファイルはAIを直接は呼ばない。AIの呼び出し・設定・利用回数は、呼び出し側が deps として渡す
// (本番は functions/api/week/plan/[id]/run.js がAI接続用の部品を渡す。テストは偽物を渡す)。
//   ・AIの呼び出しは1回の実行につき最大1回(再試行なし)。1回の実行で頼むのは「1つの食事(朝食・昼食・夕食のどれか)」だけ。
//     3食ぶん頼むときは、画面が食事ごとに1回ずつ(最大3回)実行する。失敗したら、その回の確保した回数を全部戻す。
//   ・栄養の計算(成分表)と1週間の合計は、すべてコードで行う。AIには栄養の数字を出させない。
//   ・外食の日・作らない日は、AIに頼まない。外食のあとに作り直すときも、決まっていない日だけをAIに頼む。

import { addDays, weekStartOf, isValidDay, todayJst } from "./meals.js";
import { attachNutrition } from "./nutrition.js";
import { PLAN_STAGES } from "./kondate-messages.js";

export const MAX_FILL_PER_RUN = 7;
export const SLOT_ORDER = ["breakfast", "lunch", "dinner"];
export const SLOT_LABEL = { breakfast: "朝食", lunch: "昼食", dinner: "夕食" };
// 1食あたりの目安(1日の何割か)。基準表の値ではない、アプリ独自の目安(残りは間食など)。
export const SLOT_SHARE = { breakfast: 0.25, lunch: 0.30, dinner: 0.35 };
export const slotKey = (date, slot) => date + ":" + slot;
const splitKey = (k) => [String(k).slice(0, 10), String(k).slice(11)];
const byDateSlot = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
export const LEASE_MS = 3 * 60 * 1000;
export const KINDS = ["cook", "outing", "off"];
const isMissingTable = (e) => /no such table/i.test(String((e && e.message) || e));
export { isMissingTable };

// 成功: { value: { weekStart, slots, kinds: {"日付:食事": kind}, replace } } / 失敗: { error }
//   slots を省くと夕食だけ(従来どおり)。outingDays/offDays は「その日の、選んだ食事すべて」、outingMeals/offMeals は「日付:食事」の指定。
export function parsePlanRequest(body, now = Date.now()) {
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };
  const today = todayJst(now);
  const weekStart = body.weekStart === undefined ? weekStartOf(today) : body.weekStart;
  if (!isValidDay(weekStart) || weekStartOf(weekStart) !== weekStart) return { error: "週の指定が不正です(月曜日の日付を指定してください)" };
  if (addDays(weekStart, 6) < today) return { error: "過ぎた週のプランは作れません" };
  if (weekStart > addDays(weekStartOf(today), 7)) return { error: "作れるのは今週と来週です" };
  let slots = ["dinner"];
  if (body.slots !== undefined) {
    if (!Array.isArray(body.slots) || !body.slots.length || body.slots.some((s) => !SLOT_ORDER.includes(s))) return { error: "食事の指定が不正です" };
    slots = SLOT_ORDER.filter((s) => body.slots.includes(s));
  }
  const kinds = {};
  for (let i = 0; i < 7; i++) for (const s of slots) kinds[slotKey(addDays(weekStart, i), s)] = "cook";
  for (const [list, kind] of [[body.outingDays, "outing"], [body.offDays, "off"]]) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { error: "日付の指定が不正です" };
    for (const d of list) {
      const hit = slots.filter((s) => Object.hasOwn(kinds, slotKey(String(d), s)));
      if (!hit.length) return { error: "その週に含まれない日付があります" };
      hit.forEach((s) => { kinds[slotKey(String(d), s)] = kind; });
    }
  }
  for (const [list, kind] of [[body.outingMeals, "outing"], [body.offMeals, "off"]]) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) return { error: "食事の指定が不正です" };
    for (const k of list) {
      if (typeof k !== "string" || !Object.hasOwn(kinds, k)) return { error: "その週に含まれない食事があります" };
      kinds[k] = kind;
    }
  }
  // 過ぎた日は作らない
  for (const k of Object.keys(kinds)) if (splitKey(k)[0] < today && kinds[k] === "cook") kinds[k] = "off";
  if (!Object.values(kinds).includes("cook")) return { error: "作る日が1日もありません" };
  return { value: { weekStart, slots, kinds, replace: body.replace === true } };
}

export const emptyDays = (kinds) => Object.keys(kinds).map((k) => { const [date, slot] = splitKey(k); return { date, slot, kind: kinds[k], recipe: null }; }).sort(byDateSlot);

export async function loadPlan(env, userId, where, arg) {
  const col = where === "id" ? "id" : "week_start";
  const row = await env.DB.prepare(`SELECT * FROM week_plans WHERE user_id = ? AND ${col} = ?`).bind(userId, arg).first();
  return row ? hydrate(row) : null;
}
function hydrate(row) {
  const j = (s, d) => { try { return JSON.parse(s) ?? d; } catch (e) { return d; } };
  // 以前(夕食だけ)のプランは、slot が無い・fill が日付だけ。どちらも「夕食」として読む(保存し直すときに新しい形になる)
  const days = j(row.days, []).map((d) => ({ ...d, slot: SLOT_ORDER.includes(d.slot) ? d.slot : "dinner" }));
  const request = j(row.request, {});
  request.fill = (Array.isArray(request.fill) ? request.fill : []).map((x) => (typeof x === "string" && x.length === 10 ? slotKey(x, "dinner") : x));
  return { ...row, days, request, shopping: j(row.shopping, { checked: [] }) };
}

export async function savePlanDays(env, id, userId, days, request, now = Date.now()) {
  await env.DB.prepare("UPDATE week_plans SET days = ?, request = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(JSON.stringify(days), JSON.stringify(request), now, id, userId).run();
}

// 新しいプラン(または作り直し)を用意する。AIはまだ呼ばない。
export async function createPlan(env, userId, req, now = Date.now()) {
  const existing = await loadPlan(env, userId, "week", req.weekStart);
  if (existing) {
    if (existing.status === "running" && existing.lease_until > now) return { error: "いま作成中です。少し待ってからお試しください", status: 409 };
    if (!req.replace) return { error: "この週のプランはすでにあります", status: 409, id: existing.id };
    await env.DB.prepare("DELETE FROM week_plans WHERE id = ? AND user_id = ?").bind(existing.id, userId).run();
  }
  const id = "wp-" + crypto.randomUUID();
  const days = emptyDays(req.kinds);
  const request = { fill: days.filter((d) => d.kind === "cook").map((d) => slotKey(d.date, d.slot)), slots: req.slots || ["dinner"] };
  await env.DB.prepare(
    `INSERT INTO week_plans (id, user_id, week_start, status, stage, progress, days, request, shopping, ai_calls, lease_until, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)`
  ).bind(id, userId, req.weekStart, "idle", "queued", 0, JSON.stringify(days), JSON.stringify(request), JSON.stringify({ checked: [] }), now, now).run();
  return { id };
}

// 日ごとの変更(外食にする・作らない日にする・また作る日にする・保存済みレシピに差し替える)。AIは呼ばない。
export async function changeDay(env, userId, plan, change, now = Date.now()) {
  const days = plan.days.map((d) => ({ ...d }));
  const slot = change.slot === undefined || change.slot === null ? "dinner" : change.slot;
  if (!SLOT_ORDER.includes(slot)) return { error: "食事の指定が不正です", status: 400 };
  const day = days.find((d) => d.date === change.date && d.slot === slot);
  if (!day) return { error: "その日はこの週に含まれません", status: 400 };
  const key = slotKey(day.date, day.slot);
  const request = { ...plan.request, fill: [...(plan.request.fill || [])] };
  const unfill = () => { request.fill = request.fill.filter((x) => x !== key); };
  if (change.action === "outing" || change.action === "off") {
    day.kind = change.action; day.recipe = null; unfill();
  } else if (change.action === "cook") {
    day.kind = "cook"; day.recipe = null;
    if (!request.fill.includes(key)) request.fill.push(key);
  } else if (change.action === "swap") {
    const row = await env.DB.prepare("SELECT data FROM recipes WHERE user_id = ? AND id = ?").bind(userId, String(change.recipeId || "")).first();
    if (!row) return { error: "レシピが見つかりません", status: 404 };
    let r; try { r = JSON.parse(row.data); } catch (e) { return { error: "レシピが読み取れません", status: 422 }; }
    if (!r.nutrition || typeof r.nutrition !== "object") return { error: "このレシピには栄養の値がありません", status: 422 };
    day.kind = "cook"; day.recipe = snapshotRecipe(r, "saved", change.recipeId); unfill();
  } else return { error: "操作が不正です", status: 400 };
  await savePlanDays(env, plan.id, userId, days, request, now);
  return { days, request };
}

export function snapshotRecipe(r, source, recipeId = null) {
  return {
    source, recipeId, name: String(r.name || "").slice(0, 100), type: r.type || null, minutes: r.minutes ?? null,
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.slice(0, 40) : [],
    ingredientDetails: Array.isArray(r.ingredientDetails) ? r.ingredientDetails.slice(0, 40).map((d) => ({ name: d.name, amount: d.amount, grams: d.grams, food: d.food, ...(d.match ? { match: d.match } : {}) })) : [],
    steps: Array.isArray(r.steps) ? r.steps.slice(0, 20) : [],
    nutrition: r.nutrition || {}, nutritionCheck: r.nutritionCheck || { unmatched: [], missing: [] },
  };
}

// 1週間の栄養(コードで合計)。作る食事だけ。外食・作らない食事は入れない。
// average は「作る日1日あたり」(その日に決まっている食事の合計を、日ごとに出して平均する)。夕食だけのプランなら、従来の夕食の平均と同じ。
export function weekSummary(days) {
  const cooked = days.filter((d) => d.kind === "cook" && d.recipe);
  const byDate = new Map();
  for (const d of cooked) {
    const t = byDate.get(d.date) || {};
    for (const [k, v] of Object.entries(d.recipe.nutrition || {})) t[k] = (t[k] || 0) + v;
    byDate.set(d.date, t);
  }
  const totals = {};
  for (const t of byDate.values()) for (const [k, v] of Object.entries(t)) totals[k] = (totals[k] || 0) + v;
  const average = {};
  for (const k of Object.keys(totals)) average[k] = Math.round((totals[k] / byDate.size) * 10) / 10;
  const pending = days.filter((d) => d.kind === "cook" && !d.recipe).length;
  return {
    cookedDays: byDate.size, cookedMeals: cooked.length, pendingDays: pending, pendingMeals: pending,
    outingDays: new Set(days.filter((d) => d.kind === "outing").map((d) => d.date)).size, outingMeals: days.filter((d) => d.kind === "outing").length, average,
  };
}

// ==== AIに頼む文面(栄養の数字は出させない。目標はこちらの計算に使う) ====
// 食事ごとの、AIへの指示。夕食は従来の文面のまま。朝食・昼食は、手早く作れる・材料と手順を短く(出力量=料金を抑える)
const SLOT_GUIDE = {
  breakfast: { dish: "主食(ご飯・パン・オートミールなど)とたんぱく質がとれる、朝に食べやすい料理", note: "・朝は忙しいので、10〜15分ほどで作れる手早い料理にする(作り置きや前日の残りに頼らず、作り方を書く)\n・材料は8品以内、手順は5つ以内にする\n" },
  lunch: { dish: "主食とたんぱく質・野菜がとれる、丼・麺・ワンプレートなど1品で完結する料理", note: "・手早く作れて、1品で完結する家庭料理にする(作り置きしてもおいしい料理でもよい)\n・材料は10品以内、手順は6つ以内にする\n" },
  dinner: { dish: "主菜と野菜がとれる、1品〜ワンプレートで完結する料理", note: "・平日でも作れる、手間が少なめの家庭料理にする\n" },
};

// 栄養の数字は出させない。目標はこちらの計算に使う。slot は、頼む食事(朝食・昼食・夕食のどれか1つ)
export function buildPlanPrompt({ dates, slot = "dinner", targetsText, excluded = [], notes = [], avoidNames = [], favorMetric = null }) {
  const n = dates.length;
  const label = SLOT_LABEL[slot] || SLOT_LABEL.dinner;
  const guide = SLOT_GUIDE[slot] || SLOT_GUIDE.dinner;
  const fav = { fiber: "食物繊維が多い(きのこ・豆・海藻・根菜など)", protein: "たんぱく質が多い(卵・豆腐・魚など)", veg: "野菜が多い" }[favorMetric];
  return 'あなたは家庭の' + label + 'の献立を考えるアシスタントです。' + n + '日分の' + label + 'を考えて、JSON配列の形式のみで出力してください。前置き・説明・Markdownのコードブロック記号(```)は一切つけないでください。\n\n' +
    '【1日の栄養の目安(平均して近づければよい。厳密に合わせなくてよい)】\n' + (targetsText || '栄養バランスの良い一般的な家庭料理にしてください。') + '\n\n' +
    (excluded.length ? '【使わない食材(絶対に使わない)】\n' + excluded.map((x) => '・' + x).join('\n') + '\n\n' : '') +
    (notes.length ? '【ユーザーの個人的な要望(調理環境・好み)】\n' + notes.map((x) => '・' + x).join('\n') + '\n\n' : '') +
    (avoidNames.length ? '【最近つくった料理(同じものは避ける)】\n' + avoidNames.slice(0, 20).map((x) => '・' + x).join('\n') + '\n\n' : '') +
    '【条件】\n' +
    '・ちょうど' + n + '個。1個=1日の' + label + '(' + guide.dish + ')\n' +
    '・' + n + '日の中で、主材料(肉・魚・卵・豆腐など)と調理法が偏らないようにする\n' +
    guide.note +
    (fav ? '・今週は特に、' + fav + '料理を多めにする\n' : '') +
    '・油はごま油かオリーブオイルのみ。ハム・ソーセージ・ベーコンなどの加工肉は使わない\n' +
    '・栄養量はこちらで成分表から計算するため、出力しない\n' +
    '・grams は正味の重さをg単位の数値で入れる(水は0)。food は日本食品標準成分表(八訂)の食品名に合わせる(例: "たまねぎ りん茎 生"、"ぶた ロース 脂身つき 生"、"こいくちしょうゆ")\n\n' +
    '出力形式(キーはこの通り):\n' +
    '[\n  { "name": "料理名", "type": "鍋・炒め物・丼・サラダ・スープ・プレート・カレー・パスタ・ご飯もの・煮物・洋食のいずれか", "minutes": 所要時間(整数),\n' +
    '    "ingredients": [ { "name": "食材名", "amount": "分量の表記", "grams": 正味のg, "food": "成分表の食品名" } ],\n    "steps": ["手順1", "手順2"] }\n]';
}

// 目標を、AIに伝える短い文にする(自分で設定した値・基準表の値、どちらでも)。1食ぶんは、1日の SLOT_SHARE(夕食35%・昼食30%・朝食25%)を目安にする
export function targetsToText(effective, slot = "dinner") {
  const names = { calories: "エネルギー", protein: "たんぱく質", fat: "脂質", salt: "塩分", fiber: "食物繊維", veg: "野菜" };
  const lines = [];
  for (const id of ["calories", "protein", "fat", "fiber", "veg", "salt"]) {
    const t = effective && effective[id];
    if (!t) continue;
    const share = (v) => Math.round(v * (SLOT_SHARE[slot] || SLOT_SHARE.dinner) * 10) / 10;
    const suffix = t.kind === "max" ? "以下" : t.kind === "min" ? "以上" : "前後";
    lines.push('・' + names[id] + ': ' + (SLOT_LABEL[slot] || SLOT_LABEL.dinner) + '1回で ' + share(t.value) + t.unit + suffix);
  }
  return lines.join('\n');
}

const stageUpdate = (env, id, userId, stage, progress, now) =>
  env.DB.prepare("UPDATE week_plans SET stage = ?, progress = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(stage, progress, now, id, userId).run();

// 実行。deps(必須): reserveGlobal(env)→{ok,day} / refundGlobal(env,day) / reserveMonthly / refundMonthly / callAi(prompt)→{content}|{status,body} / parseDishes(content,{count}) /
//                    loadExcluded(env,userId) / findExcludedHits(dishes, excluded) / loadNotes(env,userId) / now
// opts.slot: 頼む食事(breakfast/lunch/dinner)。省くと、決まっていない食事がある最初の食事(朝→昼→夕)。1回の実行で頼むのは1つの食事だけ。
// 成功: { ok:true, filled, skipped:["日付:食事"], slot, pendingSlots } / 失敗: { ok:false, status, error }
// pendingSlots は、まだ決まっていない食事がある食事の一覧(画面が次の1回を頼むかどうかの判断に使う。サーバーは勝手に続けてAIを呼ばない)
export const pendingKeysOf = (days, fill) => (fill || []).filter((k) => { const [date, slot] = splitKey(k); return days.some((x) => x.date === date && x.slot === slot && x.kind === "cook" && !x.recipe); });
export const pendingSlotsOf = (days, fill) => { const keys = pendingKeysOf(days, fill); return SLOT_ORDER.filter((s) => keys.some((k) => splitKey(k)[1] === s)); };

export async function runPlan(env, userId, planId, deps, opts = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const plan = await loadPlan(env, userId, "id", planId);
  if (!plan) return { ok: false, status: 404, error: "プランが見つかりません" };
  if (plan.status === "running" && plan.lease_until > now) return { ok: false, status: 409, error: "いま作成中です。少し待ってからお試しください" };
  if (opts.slot !== undefined && opts.slot !== null && !SLOT_ORDER.includes(opts.slot)) return { ok: false, status: 400, error: "食事の指定が不正です" };
  const pendingKeys = pendingKeysOf(plan.days, plan.request.fill);
  const slot = opts.slot || SLOT_ORDER.find((s) => pendingKeys.some((k) => splitKey(k)[1] === s));
  const fillKeys = pendingKeys.filter((k) => splitKey(k)[1] === slot).slice(0, MAX_FILL_PER_RUN);
  const fill = fillKeys.map((k) => splitKey(k)[0]);
  if (!fill.length) return { ok: true, filled: 0, skipped: [], slot: slot || null, pendingSlots: pendingSlotsOf(plan.days, plan.request.fill) };

  // 1) 利用回数を確保(ユーザーの月間 → アプリ全体の1日)。どちらかが上限なら、AIを呼ばずに終える
  const mo = await deps.reserveMonthly(env, userId, "week");
  if (!mo.ok) return { ok: false, status: 429, error: "limit-user" };
  const gl = await deps.reserveGlobal(env);
  if (!gl.ok) { await deps.refundMonthly(env, userId, "week", mo.month); return { ok: false, status: 429, error: "limit-global" }; }

  // 2) 取り合い防止(lease)。取れなければ、確保した回数を戻して終える
  const claim = await env.DB.prepare(
    "UPDATE week_plans SET status = 'running', stage = 'queued', progress = 5, lease_until = ?, usage_day = ?, error = NULL, ai_calls = ai_calls + 1, updated_at = ? WHERE id = ? AND user_id = ? AND (status != 'running' OR lease_until <= ?)"
  ).bind(now + LEASE_MS, gl.day, now, planId, userId, now).run();
  const refundAll = async () => { await deps.refundGlobal(env, gl.day); await deps.refundMonthly(env, userId, "week", mo.month); };
  if (!(claim.meta && claim.meta.changes > 0)) { await refundAll(); return { ok: false, status: 409, error: "いま作成中です。少し待ってからお試しください" }; }

  const fail = async (status, message) => {
    await refundAll();
    await env.DB.prepare("UPDATE week_plans SET status = 'error', error = ?, lease_until = 0, updated_at = ? WHERE id = ? AND user_id = ?").bind(message, Date.now(), planId, userId).run();
    return { ok: false, status, error: message };
  };
  try {
    const excluded = await deps.loadExcluded(env, userId);
    const notes = await deps.loadNotes(env, userId);
    const { loadEffectiveTargets } = await import("./targets.js");
    const { built } = await loadEffectiveTargets(env, userId);
    const recent = plan.days.filter((d) => d.recipe).map((d) => d.recipe.name); // 別の食事の料理も入る(同じ料理が続かないように)
    const prompt = buildPlanPrompt({
      dates: fill, slot, targetsText: built ? targetsToText(built.effective, slot) : "", excluded, notes, avoidNames: recent,
      favorMetric: plan.request.favor || null,
    });
    await stageUpdate(env, planId, userId, "ai", 20, Date.now());
    const ai = await deps.callAi(prompt, fill.length); // ← AIを呼ぶのはここ1回だけ
    if (!ai || ai.content === undefined) return await fail(502, "ai-error");
    let dishes;
    try { dishes = deps.parseDishes(ai.content, { count: fill.length }); } catch (e) { return await fail(502, "ai-format"); }
    await stageUpdate(env, planId, userId, "calc", 70, Date.now());
    await attachNutrition(env, dishes, []);
    // 料理ごとに調べる(findExcludedHits は、含まれていた除外食材の名前の一覧を返す)
    const bad = new Set();
    if (deps.findExcludedHits) dishes.forEach((d, i) => { if ((deps.findExcludedHits([d], excluded) || []).length) bad.add(i); });

    const days = plan.days.map((d) => ({ ...d }));
    const skipped = [];
    let filled = 0;
    fill.forEach((date, i) => {
      const dish = dishes[i];
      if (!dish || bad.has(i)) { skipped.push(slotKey(date, slot)); return; }
      days.find((d) => d.date === date && d.slot === slot).recipe = snapshotRecipe(dish, "ai");
      filled++;
    });
    const request = { ...plan.request, fill: fillKeys.filter((k) => skipped.includes(k)).concat((plan.request.fill || []).filter((k) => !fillKeys.includes(k))) };
    await env.DB.prepare("UPDATE week_plans SET days = ?, request = ?, status = 'done', stage = 'done', progress = 100, lease_until = 0, error = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(JSON.stringify(days), JSON.stringify(request), Date.now(), planId, userId).run();
    return { ok: true, filled, skipped, slot, pendingSlots: pendingSlotsOf(days, request.fill) };
  } catch (e) {
    console.error("runPlan failed: " + (e && e.message));
    return await fail(500, "failed");
  }
}

export const stageText = (s) => PLAN_STAGES[s] || PLAN_STAGES.queued;
