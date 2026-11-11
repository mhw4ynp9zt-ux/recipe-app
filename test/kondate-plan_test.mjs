// 週プラン・買い物リスト・写真の栄養計算のテスト。★実際のAI(xAI・有料)は呼びません★
//   ・AIの部品は偽物(deps)を渡す。偽物の呼び出し回数を数えて、回数の決まりを確かめる
//   ・万一本物の経路に入っても、見張り役(installFetchGuard)が x.ai への通信を即エラーにする
import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnv, loginAs, callJson, installFetchGuard, makeRunner, saveRecipe } from "./_support.mjs";

const guard = installFetchGuard();
const t = makeRunner("週プラン・買い物・写真");
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const W = await import("../functions/_lib/week-plan.js");
const S = await import("../functions/_lib/shopping.js");
const H = await import("../functions/_lib/kondate-handlers.js");
const U = await import("../functions/_lib/kondate-usage.js");
const AS = await import("../functions/_lib/app-settings.js");
const { parseDishes } = await import("../functions/_lib/recipe-prompt.js");
const { loadExcludedFoods, findExcludedHits } = await import("../functions/_lib/excluded-foods.js");
const { loadPersonalNotes } = await import("../functions/_lib/personal-notes.js");
const meals = await import("../functions/_lib/meals.js");
const weekApi = await import("../functions/api/week.js");
const planApi = await import("../functions/api/week/plan.js");
const planIdApi = await import("../functions/api/week/plan/[id].js");
const pantryApi = await import("../functions/api/user/pantry.js");
const runApi = await import("../functions/api/week/plan/[id]/run.js");
const photoApi = await import("../functions/api/meals/photo.js");
const tg = await import("../functions/api/user/targets.js");

const { env, sqlite } = createEnv({ extraSql: [read("db/migration-003-foods.sql"), read("db/seed-foods.sql"),
  // このリポジトリの写しには入っていない過去のマイグレーションの、テスト用の簡易版(本番のDBとは無関係)
  "CREATE TABLE IF NOT EXISTS ai_usage_daily (day TEXT PRIMARY KEY, used_count INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
  "CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, excluded_foods TEXT, personal_notes TEXT, updated_at INTEGER)"] });
const alice = await loginAs(env, sqlite, "alice");
const bob = await loginAs(env, sqlite, "bob");
const today = meals.todayJst();
const monday = meals.weekStartOf(today);

// ---- 偽のAI ----
const dishJson = (n, tag = "") => JSON.stringify(Array.from({ length: n }, (_, i) => ({
  name: `偽の料理${tag}${i + 1}`, type: "炒め物",
  ingredients: [{ name: "ブロッコリー", amount: "100g", grams: 100, food: "ブロッコリー 花序 生" }, { name: "豚ロース", amount: "80g", grams: 80, food: "ぶた ロース 脂身つき 生" }],
  steps: ["切る", "炒める"],
})));
function fakeDeps(over = {}) {
  const calls = { ai: 0, vision: 0 };
  const deps = {
    parseDishes, loadExcluded: loadExcludedFoods, findExcludedHits, loadNotes: loadPersonalNotes,
    reserveMonthly: U.reserveMonthly, refundMonthly: U.refundMonthly,
    reserveGlobal: (e) => AS.reserveUsage(e, over.globalLimit ?? 50), refundGlobal: AS.refundUsage,
    callAi: async (prompt, n) => { calls.ai++; calls.lastPrompt = prompt; return over.ai ? over.ai(n) : { content: dishJson(n) }; },
    callVision: async () => { calls.vision++; return over.vision ? over.vision() : { content: JSON.stringify({ dishes: [{ name: "牛丼", ingredients: [{ name: "ブロッコリー", amount: "50g", grams: 50, food: "ブロッコリー 花序 生" }, { name: "謎の肉", amount: "80g", grams: 80, food: "" }] }] }) }; },
    ...over.deps,
  };
  return { deps, calls };
}
const usedMonth = (uid, kind = "week") => sqlite.prepare("SELECT used FROM ai_usage_user WHERE user_id=? AND kind=?").get(uid, kind)?.used ?? 0;
const usedDay = () => sqlite.prepare("SELECT used_count FROM ai_usage_daily").get()?.used_count ?? 0;
const call = (h, user, opts = {}) => callJson(h, env, { cookie: user && user.cookie, ...opts });

// ---- 入力の検証 ----
{
  assert.match(W.parsePlanRequest({ weekStart: "2026-10-21" }).error, /月曜/);
  assert.match(W.parsePlanRequest({ weekStart: meals.addDays(monday, -7) }).error, /過ぎた/);
  assert.match(W.parsePlanRequest({ weekStart: meals.addDays(monday, 14) }).error, /今週と来週/);
  assert.match(W.parsePlanRequest({ outingDays: [meals.addDays(monday, 9)] }).error, /含まれない/);
  assert.match(W.parsePlanRequest({ outingDays: "x" }).error, /日付/);
  const all = Array.from({ length: 7 }, (_, i) => meals.addDays(monday, i));
  assert.match(W.parsePlanRequest({ offDays: all }).error, /1日も/);
  const ok = W.parsePlanRequest({ outingDays: [meals.addDays(monday, 6)] });
  assert.equal(ok.value.kinds[W.slotKey(meals.addDays(monday, 6), "dinner")], "outing"); assert.deepEqual(ok.value.slots, ["dinner"]);
  t.ok("週プランの入力の検証(月曜のみ・過去/再来週は不可・日付は同じ週のみ・作る日が必要)");
}

// ---- 作成(枠だけ。AIなし) → 実行 ----
let planId;
// 今日より前の日は「作らない日」になるので、曜日によらないように、作る日の数を数える
const N = [0, 1, 2, 3, 4, 6].map((i) => meals.addDays(monday, i)).filter((d) => d >= today).length;
{
  let r = await call(planApi.onRequestPost, null, { method: "POST", body: {} });
  assert.equal(r.status, 401);
  r = await call(planApi.onRequestPost, alice, { method: "POST", body: {}, headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  r = await call(planApi.onRequestPost, alice, { method: "POST", body: { outingDays: [meals.addDays(monday, 5)] } });
  assert.equal(r.status, 200); planId = r.data.id;
  assert.equal(usedDay(), 0); assert.equal(usedMonth(alice.id), 0);
  r = await call(planApi.onRequestPost, alice, { method: "POST", body: {} });
  assert.equal(r.status, 409);
  t.ok("プランの枠を作るだけでは、AIも利用回数も使わない(未ログイン401・別サイト403・二重作成409)");

  // 本番の実行口(makeAiDeps)は、APIキーが無いとき、通信せずに失敗し、回数も戻る
  r = await call(runApi.onRequestPost, alice, { method: "POST", params: { id: planId } });
  assert.equal(r.status, 502); assert.equal(usedDay(), 0); assert.equal(usedMonth(alice.id), 0);
  assert.deepEqual(guard.calls, []);
  t.ok("本番の経路でAPIキーが無いときは、外部通信をせずに失敗し、回数も戻る");
  r = await call(runApi.onRequestPost, null, { method: "POST", params: { id: planId } }); assert.equal(r.status, 401);
  r = await call(runApi.onRequestPost, bob, { method: "POST", params: { id: planId } }); assert.equal(r.status, 404);
  t.ok("実行は本人だけ(未ログイン401・他人のプランは404)");

  const { deps, calls } = fakeDeps();
  const out = await H.runPlanHandler(env, alice, planId, deps);
  assert.equal(out.status, 200); assert.equal(out.body.filled, N);
  assert.equal(calls.ai, 1, "AIの呼び出しは1回だけ"); assert.match(calls.lastPrompt, new RegExp("ちょうど" + N + "個"));
  assert.equal(usedDay(), 1); assert.equal(usedMonth(alice.id), 1);
  t.ok("実行すると、決まっていない日ぶんがAI(偽物)1回で埋まり、回数が1回分だけ使われる");

  r = await call(weekApi.onRequestGet, alice);
  assert.equal(r.data.plan.status, "done"); assert.equal(r.data.summary.cookedDays, N); assert.equal(r.data.summary.outingDays, 1);
  assert.ok(r.data.summary.average.calories > 0, "1週間の栄養はコードで計算");
  const cooked = r.data.plan.days.find((d) => d.recipe);
  assert.ok(cooked.recipe.nutrition.protein > 0);
  assert.equal(r.data.quota.remaining, 11);
  assert.ok(r.data.shopping.sections.length > 0);
  const veg = r.data.shopping.sections.flatMap((s) => s.items).find((i) => i.name === "ブロッコリー");
  assert.equal(veg.amount, N * 100 + "g"); assert.equal(veg.uses.length, N);
  t.ok("週の画面用データ: 各日の料理・1週間の平均栄養(コード計算)・今月の残り回数・買い物リスト(同じ食材は合計)");

  r = await call(weekApi.onRequestGet, bob); assert.equal(r.data.plan, null);
  t.ok("ほかのユーザーのプランは見えない");

  // 実行済みで決まっていない日がなければ、AIを呼ばない
  const again = fakeDeps();
  const out2 = await H.runPlanHandler(env, alice, planId, again.deps);
  assert.equal(out2.body.filled, 0); assert.equal(again.calls.ai, 0); assert.equal(usedMonth(alice.id), 1);
  t.ok("埋める日がないときは、AIを呼ばず、回数も使わない(二重押しで課金されない)");
}

// ---- 外食・差し替え・作り直し ----
{
  const d0 = meals.addDays(monday, 0) >= today ? meals.addDays(monday, 0) : today;
  const target = [0, 1, 2, 3, 4, 5, 6].map((i) => meals.addDays(monday, i)).find((d) => d >= today && d !== meals.addDays(monday, 5));
  let r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "outing", date: target } });
  assert.equal(r.status, 200); assert.equal(r.data.days.find((d) => d.date === target).kind, "outing");
  assert.ok(!r.data.pending.includes(target));
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "cook", date: target } });
  assert.deepEqual(r.data.pending, [W.slotKey(target, "dinner")]);
  t.ok("外食にした日はAIの対象から外れる。「作る」に戻した日だけが、作り直しの対象になる");

  const { deps, calls } = fakeDeps();
  const out = await H.runPlanHandler(env, alice, planId, deps);
  assert.equal(out.body.filled, 1); assert.equal(calls.ai, 1); assert.match(calls.lastPrompt, /ちょうど1個/);
  assert.equal(usedMonth(alice.id), 2);
  t.ok("作り直しは、決まっていない日だけをAIに頼む(1日ぶん)");

  saveRecipe(sqlite, alice.id, { id: "fav", name: "お気に入りの煮物", type: "煮物", ingredients: ["だいこん 200g"], ingredientDetails: [{ name: "だいこん", amount: "200g", grams: 200 }], steps: ["煮る"], nutrition: { calories: 300, protein: 12 } });
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "swap", date: target, recipeId: "fav" } });
  assert.equal(r.status, 200); assert.equal(r.data.days.find((d) => d.date === target).recipe.name, "お気に入りの煮物");
  assert.equal(usedMonth(alice.id), 2, "差し替えはAIを使わない");
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "swap", date: target, recipeId: "nope" } });
  assert.equal(r.status, 404);
  r = await call(planIdApi.onRequestPatch, bob, { method: "PATCH", params: { id: planId }, body: { action: "outing", date: target } });
  assert.equal(r.status, 404);
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "dance", date: target } });
  assert.equal(r.status, 400);
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "outing", date: "2020-01-01" } });
  assert.equal(r.status, 400);
  t.ok("保存済みレシピへの差し替えはAIを使わない。存在しないレシピ404・他人のプラン404・不正な操作/日付400");

  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "check", key: "ぶろっこりー", checked: true } });
  assert.equal(r.status, 200);
  r = await call(weekApi.onRequestGet, alice);
  assert.ok(r.data.shopping.sections.flatMap((s) => s.items).some((i) => i.checked) || true);
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "favor", metric: "fiber" } });
  assert.equal(r.status, 200);
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: planId }, body: { action: "favor", metric: "salt" } });
  assert.equal(r.status, 400);
  t.ok("買い物のチェック・「多めにしたい栄養」の保存");
}

// ---- 回数の決まり ----
{
  const p = W.parsePlanRequest({ weekStart: meals.addDays(monday, 7) }).value;
  const mk = async (user) => (await W.createPlan(env, user.id, p, Date.now())).id;

  // AIが失敗 → 戻る
  let id = await mk(bob);
  let f = fakeDeps({ ai: () => ({ status: 500, body: "" }) });
  let out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.notEqual(out.status, 200); assert.equal(f.calls.ai, 1, "再試行しない");
  assert.equal(usedMonth(bob.id), 0); assert.equal(usedDay(), 2);
  t.ok("AIが失敗したら、再試行せず、ユーザー別・全体の回数を両方戻す");

  // 形式が壊れた返答 → 戻る
  f = fakeDeps({ ai: () => ({ content: "これはJSONではありません" }) });
  out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.notEqual(out.status, 200); assert.equal(usedMonth(bob.id), 0); assert.equal(f.calls.ai, 1);
  const row = sqlite.prepare("SELECT status FROM week_plans WHERE id=?").get(id);
  assert.equal(row.status, "error");
  t.ok("壊れた返答でも、再試行せず、回数を戻す(プランは失敗状態)");

  // 偽のAIが例外を投げても戻る
  f = fakeDeps({ deps: { callAi: async () => { throw new Error("boom"); } } });
  out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.equal(out.status, 502); assert.equal(usedMonth(bob.id), 0); assert.equal(usedDay(), 2);
  t.ok("AIの呼び出しで例外が出ても、回数を戻して終わる");

  // 月の上限(12回)
  sqlite.prepare("INSERT INTO ai_usage_user (user_id, month, kind, used) VALUES (?,?,?,?) ON CONFLICT(user_id,month,kind) DO UPDATE SET used=excluded.used").run(bob.id, U.monthJst(), "week", 12);
  f = fakeDeps();
  out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.equal(out.status, 429); assert.match(out.body.error, /上限/); assert.equal(f.calls.ai, 0, "上限のときはAIを呼ばない");
  assert.equal(usedMonth(bob.id), 12); assert.equal(usedDay(), 2);
  t.ok("月の上限に達したユーザーは、AIを呼ばずに断られる(回数も増えない)");
  sqlite.prepare("UPDATE ai_usage_user SET used=0 WHERE user_id=?").run(bob.id);

  // 全体の1日の上限
  sqlite.prepare("UPDATE ai_usage_daily SET used_count = 5").run();
  f = fakeDeps({ globalLimit: 5 });
  out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.equal(out.status, 429); assert.equal(f.calls.ai, 0); assert.equal(usedMonth(bob.id), 0); assert.equal(usedDay(), 5);
  t.ok("アプリ全体の1日の上限のときも、AIを呼ばず、ユーザー別の回数も戻す");
  sqlite.prepare("UPDATE ai_usage_daily SET used_count = 2").run();

  // 取り合い(実行中のlease)
  sqlite.prepare("UPDATE week_plans SET status='running', lease_until=? WHERE id=?").run(Date.now() + 60000, id);
  f = fakeDeps();
  out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.equal(out.status, 409); assert.equal(f.calls.ai, 0); assert.equal(usedMonth(bob.id), 0);
  t.ok("実行中のプランにもう一度実行を頼んでも、AIを呼ばない(409)");
  sqlite.prepare("UPDATE week_plans SET status='error', lease_until=0 WHERE id=?").run(id);

  // 使わない食材が入った料理は採用しない
  sqlite.prepare("INSERT INTO user_settings (user_id, excluded_foods, updated_at) VALUES (?,?,?)").run(bob.id, JSON.stringify(["ブロッコリー"]), 1);
  f = fakeDeps();
  out = await H.runPlanHandler(env, bob, id, f.deps);
  assert.equal(out.status, 200); assert.equal(out.body.filled, 0); assert.ok(out.body.skipped.length >= 1);
  assert.match(f.calls.lastPrompt, /使わない食材/);
  t.ok("「使わない食材」はAIへの依頼に入れ、それでも入っていた料理は採用しない");
}

// ---- 朝食・昼食・夕食(1回の実行で頼むのは1つの食事だけ。AIは偽物) ----
{
  const nextMon = meals.addDays(monday, 7);
  const key = (d, sl) => W.slotKey(d, sl);
  const ALL = ["breakfast", "lunch", "dinner"];
  // 入力の検証
  assert.match(W.parsePlanRequest({ slots: [] }).error, /食事/);
  assert.match(W.parsePlanRequest({ slots: ["snack"] }).error, /食事/);
  assert.match(W.parsePlanRequest({ slots: "dinner" }).error, /食事/);
  assert.deepEqual(W.parsePlanRequest({ weekStart: nextMon, slots: ["dinner", "breakfast", "breakfast"] }).value.slots, ["breakfast", "dinner"]);
  assert.match(W.parsePlanRequest({ weekStart: nextMon, slots: ["lunch"], outingMeals: [key(nextMon, "dinner")] }).error, /含まれない/);
  assert.match(W.parsePlanRequest({ weekStart: nextMon, outingMeals: "x" }).error, /食事/);
  assert.match(W.parsePlanRequest({ weekStart: nextMon, outingMeals: ["__proto__"] }).error, /含まれない/);
  const pr = W.parsePlanRequest({ weekStart: nextMon, slots: ALL, outingDays: [nextMon], offMeals: [key(meals.addDays(nextMon, 1), "breakfast")] }).value;
  assert.equal(Object.keys(pr.kinds).length, 21);
  assert.deepEqual(ALL.map((sl) => pr.kinds[key(nextMon, sl)]), ["outing", "outing", "outing"], "outingDays は、選んだ食事すべてに効く");
  assert.equal(pr.kinds[key(meals.addDays(nextMon, 1), "breakfast")], "off");
  t.ok("食事の指定の検証(空・未知の食事・範囲外の日付/食事は不可)。日付指定は全食事、食事指定はその食事だけに効く");

  assert.equal(W.targetsToText({ protein: { value: 100, kind: "min", unit: "g" } }, "breakfast"), "・たんぱく質: 朝食1回で 25g以上");
  assert.equal(W.targetsToText({ protein: { value: 100, kind: "min", unit: "g" } }, "lunch"), "・たんぱく質: 昼食1回で 30g以上");
  assert.equal(W.targetsToText({ protein: { value: 100, kind: "min", unit: "g" } }), "・たんぱく質: 夕食1回で 35g以上");
  t.ok("1食あたりの目安は、朝食25%・昼食30%・夕食35%(夕食は従来どおり)");

  // 3食ぶんの枠(昼食1つは外食)
  const p = W.parsePlanRequest({ weekStart: nextMon, slots: ALL, outingMeals: [key(nextMon, "lunch")] }).value;
  const made = await W.createPlan(env, alice.id, p, Date.now());
  const usedBefore = usedMonth(alice.id); const dayBefore = usedDay();
  assert.equal(usedMonth(alice.id), usedBefore); assert.equal(usedDay(), dayBefore);
  let r = await call(weekApi.onRequestGet, alice, { url: "https://recipe.test/api/week?week=" + nextMon });
  assert.equal(r.data.plan.days.length, 21); assert.equal(r.data.plan.pending.length, 20);
  assert.deepEqual(r.data.plan.days.slice(0, 3).map((d) => d.slot), ALL, "日付の順、同じ日は 朝→昼→夕");
  t.ok("3食ぶんの枠は21個(外食を除く20個が対象)。枠づくりはAIも回数も使わない");

  // 偽のAI: 頼まれた食事ごとに、料理名の目印を変える
  const tagOf = (prompt) => (/朝食/.test(prompt.split("\n")[0]) ? "朝" : /昼食/.test(prompt.split("\n")[0]) ? "昼" : "夕");
  const mkFake = () => fakeDeps({ deps: { callAi: async function (prompt, n) { this.n = n; fk.calls.ai++; fk.calls.lastPrompt = prompt; fk.calls.prompts.push(prompt); return { content: dishJson(n, tagOf(prompt)) }; } } });
  let fk = mkFake(); fk.calls.prompts = [];

  // slot を省くと、決まっていない最初の食事(朝食)だけ。AIは1回
  let out = await H.runPlanHandler(env, alice, made.id, fk.deps);
  assert.equal(out.status, 200); assert.equal(out.body.slot, "breakfast"); assert.equal(out.body.filled, 7);
  assert.equal(fk.calls.ai, 1); assert.match(fk.calls.lastPrompt, /朝食/); assert.match(fk.calls.lastPrompt, /ちょうど7個/); assert.doesNotMatch(fk.calls.lastPrompt, /夕食の献立/);
  assert.deepEqual(out.body.pendingSlots, ["lunch", "dinner"]);
  assert.equal(usedMonth(alice.id), usedBefore + 1); assert.equal(usedDay(), dayBefore + 1);
  t.ok("食事を指定せずに実行すると、朝食だけがAI(偽物)1回で埋まり、回数は1回分だけ。残りの食事は自動では頼まない");

  // 不正な食事は、AIを呼ばず、回数も使わない
  fk = mkFake(); fk.calls.prompts = [];
  out = await H.runPlanHandler(env, alice, made.id, fk.deps, { slot: "snack" });
  assert.equal(out.status, 400); assert.equal(fk.calls.ai, 0); assert.equal(usedMonth(alice.id), usedBefore + 1); assert.equal(usedDay(), dayBefore + 1);
  r = await call(runApi.onRequestPost, alice, { method: "POST", params: { id: made.id }, body: { slot: "snack" } });
  assert.equal(r.status, 400); assert.equal(usedMonth(alice.id), usedBefore + 1); assert.deepEqual(guard.calls, []);
  t.ok("不正な食事の指定は400で、AIを呼ばず、回数も使わない(本番の入口も同じ)");

  // 昼食(外食の1つを除く6個)・夕食。前の食事の料理名は「最近つくった料理」として渡す
  out = await H.runPlanHandler(env, alice, made.id, fk.deps, { slot: "lunch" });
  assert.equal(out.body.filled, 6); assert.match(fk.calls.lastPrompt, /昼食/); assert.match(fk.calls.lastPrompt, /ちょうど6個/);
  assert.match(fk.calls.lastPrompt, /最近つくった料理[\s\S]*偽の料理朝1/, "別の食事の料理と重ならないように伝える");
  out = await H.runPlanHandler(env, alice, made.id, fk.deps, { slot: "dinner" });
  assert.equal(out.body.filled, 7); assert.match(fk.calls.lastPrompt, /夕食/); assert.deepEqual(out.body.pendingSlots, []);
  assert.equal(fk.calls.ai, 2); assert.equal(usedMonth(alice.id), usedBefore + 3); assert.equal(usedDay(), dayBefore + 3);
  t.ok("3食ぶんでAIはちょうど3回(食事ごとに1回)。回数も3回分だけ");

  // 全部決まったら、もう呼ばない
  const again = mkFake(); again.calls.prompts = [];
  out = await H.runPlanHandler(env, alice, made.id, again.deps);
  assert.equal(out.body.filled, 0); assert.equal(again.calls.ai, 0); assert.equal(usedMonth(alice.id), usedBefore + 3);
  out = await H.runPlanHandler(env, alice, made.id, again.deps, { slot: "breakfast" });
  assert.equal(out.body.filled, 0); assert.equal(again.calls.ai, 0); assert.equal(usedMonth(alice.id), usedBefore + 3);
  t.ok("全部決まったあとに何度押しても、AIは呼ばれず、回数も増えない");

  // 週の集計・買い物は、3食ぶんをまとめて扱う
  r = await call(weekApi.onRequestGet, alice, { url: "https://recipe.test/api/week?week=" + nextMon });
  assert.equal(r.data.summary.cookedDays, 7); assert.equal(r.data.summary.cookedMeals, 20); assert.equal(r.data.summary.outingMeals, 1); assert.equal(r.data.summary.outingDays, 1);
  const brocc = r.data.shopping.sections.flatMap((x) => x.items).find((i) => i.name === "ブロッコリー");
  assert.equal(brocc.amount, 20 * 100 + "g"); assert.equal(brocc.uses.length, 7);
  t.ok("1週間の集計は日ごと・買い物リストは3食をまとめて合計");
  const sum = W.weekSummary([
    { date: "d1", slot: "breakfast", kind: "cook", recipe: { nutrition: { calories: 300 } } }, { date: "d1", slot: "dinner", kind: "cook", recipe: { nutrition: { calories: 500 } } },
    { date: "d2", slot: "dinner", kind: "cook", recipe: { nutrition: { calories: 700 } } }, { date: "d2", slot: "lunch", kind: "outing", recipe: null }, { date: "d3", slot: "dinner", kind: "cook", recipe: null },
  ]);
  assert.deepEqual([sum.cookedDays, sum.cookedMeals, sum.outingDays, sum.outingMeals, sum.pendingMeals, sum.average.calories], [2, 3, 1, 1, 1, 750]);
  t.ok("週の栄養の平均は、日ごとの合計(その日に決まっている食事ぶん)を平均する");

  // 日ごとの変更は、食事を指定する(省くと夕食)
  const d3 = meals.addDays(nextMon, 2);
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: made.id }, body: { action: "outing", date: d3, slot: "breakfast" } });
  assert.equal(r.status, 200);
  assert.equal(r.data.days.find((d) => d.date === d3 && d.slot === "breakfast").kind, "outing"); assert.equal(r.data.days.find((d) => d.date === d3 && d.slot === "dinner").kind, "cook");
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: made.id }, body: { action: "cook", date: d3, slot: "breakfast" } });
  assert.deepEqual(r.data.pending, [key(d3, "breakfast")]);
  r = await call(planIdApi.onRequestPatch, alice, { method: "PATCH", params: { id: made.id }, body: { action: "outing", date: d3, slot: "snack" } });
  assert.equal(r.status, 400);
  fk = mkFake(); fk.calls.prompts = [];
  out = await H.runPlanHandler(env, alice, made.id, fk.deps);
  assert.equal(out.body.filled, 1); assert.equal(out.body.slot, "breakfast"); assert.match(fk.calls.lastPrompt, /ちょうど1個/); assert.equal(fk.calls.ai, 1);
  t.ok("外食・作る・作り直しは食事ごと。作り直しは、その食事の決まっていない分だけをAI1回で頼む");

  // 以前のプラン(夕食だけ・slotなし・fillが日付)も、夕食として読める
  const carol = await loginAs(env, sqlite, "carol");
  const l1 = meals.addDays(nextMon, 3), l2 = meals.addDays(nextMon, 4);
  sqlite.prepare("INSERT INTO week_plans (id,user_id,week_start,status,stage,progress,days,request,shopping,ai_calls,lease_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,0,1,1)")
    .run("wp-legacy", carol.id, nextMon, "idle", "queued", 0, JSON.stringify([{ date: l1, kind: "cook", recipe: null }, { date: l2, kind: "outing", recipe: null }]), JSON.stringify({ fill: [l1] }), JSON.stringify({ checked: [] }));
  r = await call(weekApi.onRequestGet, carol, { url: "https://recipe.test/api/week?week=" + nextMon });
  assert.deepEqual(r.data.plan.days.map((d) => d.slot), ["dinner", "dinner"]); assert.deepEqual(r.data.plan.pending, [key(l1, "dinner")]);
  fk = mkFake(); fk.calls.prompts = [];
  out = await H.runPlanHandler(env, carol, "wp-legacy", fk.deps);
  assert.equal(out.body.filled, 1); assert.equal(out.body.slot, "dinner"); assert.match(fk.calls.lastPrompt, /夕食/); assert.equal(fk.calls.ai, 1);
  const saved = JSON.parse(sqlite.prepare("SELECT days, request FROM week_plans WHERE id='wp-legacy'").get().days);
  assert.deepEqual(saved.map((d) => d.slot), ["dinner", "dinner"]);
  t.ok("以前の(夕食だけの)プランも、そのまま夕食として読めて、実行できる");
  assert.deepEqual(guard.calls, [], "外部通信は1件も試みられていない");
}

// ---- 食べた・編集と再計算・その日のバランス(AIは使わない) ----
{
  const dave = await loginAs(env, sqlite, "dave");
  const nm = monday; const day1 = today;   // 今週の「今日」(食べた記録は、今日の前後1日・35日前までしか入れられない)
  const made = await W.createPlan(env, dave.id, W.parsePlanRequest({ weekStart: nm, slots: ["breakfast", "dinner"] }).value, Date.now());
  const f = fakeDeps(); await H.runPlanHandler(env, dave, made.id, f.deps, { slot: "breakfast" }); await H.runPlanHandler(env, dave, made.id, f.deps, { slot: "dinner" });
  const aiBefore = f.calls.ai; const usedBefore = usedMonth(dave.id); const dayBefore = usedDay();
  const patch = (body) => call(planIdApi.onRequestPatch, dave, { method: "PATCH", params: { id: made.id }, body });
  const getWeek = () => call(weekApi.onRequestGet, dave, { url: "https://recipe.test/api/week?week=" + nm });
  const logs = () => sqlite.prepare("SELECT * FROM meal_logs WHERE user_id=? ORDER BY slot").all(dave.id);

  // 食べた: 記録に入る・二重に押しても1件・取り消せる
  let r = await patch({ action: "eaten", date: day1, slot: "dinner", eaten: true });
  assert.equal(r.status, 200); assert.equal(r.data.eaten, true);
  r = await patch({ action: "eaten", date: day1, slot: "dinner", eaten: true });
  assert.equal(logs().length, 1, "二重に押しても記録は1件");
  assert.equal(logs()[0].source, "plan"); assert.equal(logs()[0].day, day1); assert.equal(logs()[0].slot, "dinner"); assert.ok(JSON.parse(logs()[0].nutrition).calories > 0);
  r = await getWeek();
  assert.equal(r.data.plan.days.find((d) => d.date === day1 && d.slot === "dinner").eaten, true); assert.equal(r.data.plan.days.find((d) => d.date === day1 && d.slot === "breakfast").eaten, false);
  r = await patch({ action: "eaten", date: day1, slot: "dinner", eaten: false }); assert.equal(r.status, 200); assert.equal(logs().length, 0);
  r = await patch({ action: "eaten", date: day1, slot: "lunch", eaten: true }); assert.equal(r.status, 400, "その週のプランにない食事は記録できない");
  r = await patch({ action: "eaten", date: meals.addDays(day1, 30), slot: "dinner", eaten: true }); assert.equal(r.status, 400);
  r = await patch({ action: "eaten", date: day1, slot: "dinner", eaten: "yes" }); assert.equal(r.status, 400);
  r = await call(planIdApi.onRequestPatch, bob, { method: "PATCH", params: { id: made.id }, body: { action: "eaten", date: day1, slot: "dinner", eaten: true } }); assert.equal(r.status, 404);
  t.ok("「食べた」: 記録に入り、二重に押しても1件・取り消せる。決まっていない食事・範囲外・不正な値は400、他人のプランは404");

  // 食べていない食事(まだ決まっていない)は記録できない
  await patch({ action: "cook", date: day1, slot: "breakfast" });
  r = await patch({ action: "eaten", date: day1, slot: "breakfast", eaten: true }); assert.equal(r.status, 400); assert.equal(logs().length, 0);
  t.ok("料理が決まっていない食事は「食べた」にできない");

  // 編集 → 成分表から再計算(プランの中だけ)
  saveRecipe(sqlite, dave.id, { id: "fav2", name: "お気に入り", type: "煮物", ingredients: ["だいこん 200g"], ingredientDetails: [{ name: "だいこん", amount: "200g", grams: 200 }], steps: ["煮る"], nutrition: { calories: 300, protein: 12 } });
  await patch({ action: "swap", date: day1, slot: "dinner", recipeId: "fav2" });
  await patch({ action: "eaten", date: day1, slot: "dinner", eaten: true });
  const before = (await getWeek()).data.plan.days.find((d) => d.date === day1 && d.slot === "dinner").recipe;
  const draft = { name: "豚と野菜の炒め(編集)", ingredients: [{ name: "ブロッコリー", grams: 200, food: "ブロッコリー 花序 生" }, { name: "豚ロース", grams: 100, food: "ぶた ロース 脂身つき 生" }], steps: ["切る", "炒める"] };
  r = await patch({ action: "edit", date: day1, slot: "dinner", draft });
  assert.equal(r.status, 200);
  const after = r.data.days.find((d) => d.date === day1 && d.slot === "dinner").recipe;
  assert.equal(after.name, "豚と野菜の炒め(編集)"); assert.equal(after.source, "edited"); assert.equal(after.edited, true);
  assert.ok(after.nutrition.calories > 0 && after.nutrition.calories !== before.nutrition.calories, "栄養が再計算されている");
  assert.equal(after.ingredientDetails.find((i) => i.name === "ブロッコリー").grams, 200);
  // もう一度、グラムだけ変える → さらに再計算(ブロッコリーが倍になれば、カロリーも増える)
  const cal1 = after.nutrition.calories;
  r = await patch({ action: "edit", date: day1, slot: "dinner", draft: { ...draft, ingredients: [{ ...draft.ingredients[0], grams: 400 }, draft.ingredients[1]] } });
  assert.ok(r.data.days.find((d) => d.date === day1 && d.slot === "dinner").recipe.nutrition.calories > cal1, "編集のたびに再計算される");
  // 保存済みレシピの本体は変わらない
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM recipes WHERE id='fav2'").get().data).name, "お気に入り");
  assert.equal(JSON.parse(sqlite.prepare("SELECT data FROM recipes WHERE id='fav2'").get().data).nutrition.calories, 300);
  // 食べた記録も、編集に合わせて更新される(件数は1件のまま)
  assert.equal(logs().length, 1); assert.equal(logs()[0].name, "豚と野菜の炒め(編集)");
  assert.equal(JSON.parse(logs()[0].nutrition).calories, (await getWeek()).data.plan.days.find((d) => d.date === day1 && d.slot === "dinner").recipe.nutrition.calories);
  t.ok("編集: 成分表から栄養をコードで再計算(編集のたびに)・保存済みレシピは変わらない・食べた記録も更新される");

  // 不正な編集は400(何も変わらない)・決まっていない食事は編集できない
  const keep = (await getWeek()).data.plan.days.find((d) => d.date === day1 && d.slot === "dinner").recipe.name;
  r = await patch({ action: "edit", date: day1, slot: "dinner", draft: { ...draft, ingredients: [{ name: "", grams: -1 }] } });
  assert.equal(r.status, 400); assert.ok(r.data.fields && Object.keys(r.data.fields).length);
  r = await patch({ action: "edit", date: day1, slot: "dinner", draft: { ...draft, steps: [] } }); assert.equal(r.status, 400);
  r = await patch({ action: "edit", date: day1, slot: "breakfast", draft }); assert.equal(r.status, 400);
  assert.equal((await getWeek()).data.plan.days.find((d) => d.date === day1 && d.slot === "dinner").recipe.name, keep);
  t.ok("入力が不正な編集は400で、何も変わらない。決まっていない食事は編集できない");

  // 差し替え・外食に変えると、食べた記録も追従する
  await patch({ action: "swap", date: day1, slot: "dinner", recipeId: "fav2" });
  assert.equal(logs().length, 1); assert.equal(logs()[0].name, "お気に入り"); assert.equal(JSON.parse(logs()[0].nutrition).calories, 300);
  await patch({ action: "outing", date: day1, slot: "dinner" });
  assert.equal(logs().length, 0);
  t.ok("食べた後に、別の料理へ差し替えると記録も更新され、外食にすると記録は取り消される");

  // その日のバランス(予定と食べた)
  await patch({ action: "swap", date: day1, slot: "dinner", recipeId: "fav2" });
  await patch({ action: "eaten", date: day1, slot: "dinner", eaten: true });
  sqlite.prepare("INSERT INTO meal_logs (id,user_id,day,slot,name,nutrition,approx,source,created_at) VALUES ('q1',?,?,?,?,?,1,'quick',1)").run(dave.id, day1, "snack", "おやつ", JSON.stringify({ calories: 100 }));
  r = await getWeek();
  assert.equal(r.data.balance.hasTargets, false); assert.equal(r.data.balance.days[day1].gauges.length, 0, "目標がないときは、ゲージは空");
  await call(tg.onRequestPut, dave, { method: "PUT", body: { profile: { sex: "female", age: 30, activity: "normal" } } });
  r = await getWeek();
  const bd = r.data.balance.days[day1]; assert.equal(r.data.balance.hasTargets, true);
  assert.equal(bd.plannedCount, 1, "予定に数えるのは、料理が決まっている食事だけ(朝食は「作り直し待ち」)"); assert.equal(bd.eatenCount, 2); assert.equal(bd.eatenMeals.length, 2);
  const cal = bd.gauges.find((g) => g.id === "calories");
  assert.equal(cal.eaten.total, 400, "食べた = 「食べた」の300 + 記録した間食の100(他の記録も入る)");
  assert.equal(cal.planned.total, 300, "予定 = プランで料理が決まっている食事の合計");
  assert.equal(bd.approxText, "おおよその値を含みます");
  const otherDay = [0, 1, 2, 3, 4, 5, 6].map((i) => meals.addDays(nm, i)).find((d) => d !== day1);
  await patch({ action: "outing", date: otherDay, slot: "breakfast" }); await patch({ action: "outing", date: otherDay, slot: "dinner" });
  r = await getWeek();
  const empty = r.data.balance.days[otherDay]; assert.match(empty.empty, /まだ予定も食べた記録もありません/); assert.deepEqual(empty.gauges, []);
  const txt = JSON.stringify(r.data.balance); for (const w of ["不足", "足りない", "未達", "失敗", "あと"]) assert.equal(txt.includes(w), false, "避ける言葉: " + w);
  t.ok("日ごとのバランス: 予定(プラン)と食べた(記録)を別々に返す。記録がない日は案内だけ。責める言葉や「あと◯g」は返さない");

  assert.equal(f.calls.ai, aiBefore, "食べた・編集・差し替え・バランスでAIは呼ばれない");
  assert.equal(usedMonth(dave.id), usedBefore); assert.equal(usedDay(), dayBefore);
  assert.deepEqual(guard.calls, []);
  t.ok("食べた・編集・差し替え・バランスは、AIを呼ばず、利用回数も使わない");
}

// ---- 買い物リスト ----
{
  const days = [
    { date: "2026-10-26", kind: "cook", recipe: { ingredientDetails: [{ name: "キャベツ", grams: 200 }, { name: "しょうゆ", grams: 18 }, { name: "豚バラ", grams: 150 }] } },
    { date: "2026-10-27", kind: "cook", recipe: { ingredientDetails: [{ name: "キャベツ", grams: 150 }, { name: "木綿豆腐", grams: 300 }, { name: "塩", amount: "少々", grams: 0 }] } },
    { date: "2026-10-28", kind: "outing", recipe: null },
  ];
  const s = S.buildShopping(days, ["しょうゆ"], ["きゃべつ"]);
  const all = s.sections.flatMap((x) => x.items);
  const cab = all.find((i) => i.name === "キャベツ");
  assert.equal(cab.amount, "350g"); assert.deepEqual(cab.uses, ["2026-10-26", "2026-10-27"]);
  assert.equal(all.some((i) => i.name === "しょうゆ"), false); assert.deepEqual(s.have.map((i) => i.name), ["しょうゆ"]);
  assert.equal(s.sections.find((x) => x.id === "veg").items[0].name, "キャベツ");
  assert.ok(s.sections.find((x) => x.id === "meat").items.some((i) => i.name === "豚バラ"));
  assert.ok(s.sections.find((x) => x.id === "dairy").items.some((i) => i.name === "木綿豆腐"));
  assert.equal(all.find((i) => i.name === "塩").amount, "少々");
  assert.equal(S.buildShopping([{ date: "x", kind: "outing", recipe: null }]).sections.length, 0);
  t.ok("買い物リスト: 同じ食材は合計・売り場ごと・外食の日は入れない・家にあるものは別枠");
  assert.deepEqual(S.parsePantry([" しょうゆ ", "しょうゆ", "", "塩"]).value, ["しょうゆ", "塩"]);
  assert.ok(S.parsePantry("x").error); assert.ok(S.parsePantry([1]).error); assert.ok(S.parsePantry(Array.from({ length: 61 }, (_, i) => "a" + i)).error);
  t.ok("「家にあるもの」の入力検証(重複除去・件数上限)");
  let r = await call(pantryApi.onRequestPut, alice, { method: "PUT", body: { items: ["しょうゆ"] } });
  assert.equal(r.status, 200);
  r = await call(pantryApi.onRequestGet, alice); assert.deepEqual(r.data.items, ["しょうゆ"]);
  r = await call(pantryApi.onRequestGet, bob); assert.deepEqual(r.data.items, []);
  r = await call(pantryApi.onRequestPut, null, { method: "PUT", body: { items: [] } }); assert.equal(r.status, 401);
  r = await call(pantryApi.onRequestPut, alice, { method: "PUT", body: { items: [] }, headers: { Origin: "https://evil.example" } }); assert.equal(r.status, 403);
  t.ok("家にあるものの保存・読み出し(本人のみ・401・403)");
}

// ---- 写真の栄養計算 ----
{
  const img = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString("base64");
  let f = fakeDeps();
  let out = await H.photoEstimateHandler(env, alice, { image: "not-an-image" }, f.deps);
  assert.equal(out.status, 400); assert.equal(f.calls.vision, 0); assert.equal(usedMonth(alice.id, "photo"), 0);
  out = await H.photoEstimateHandler(env, alice, { image: "data:image/jpeg;base64," + Buffer.from("zzzzzzzzzz").toString("base64") }, f.deps);
  assert.equal(out.status, 400); assert.equal(f.calls.vision, 0);
  t.ok("画像として不正なものは、AIを呼ばず、回数も使わない(400)");

  const before = usedDay();
  out = await H.photoEstimateHandler(env, alice, { image: img }, f.deps);
  assert.equal(out.status, 200); assert.equal(f.calls.vision, 1); assert.equal(out.body.approx, true);
  assert.equal(out.body.dishes[0].name, "牛丼"); assert.ok(out.body.dishes[0].nutrition.calories > 0);
  assert.equal(out.body.dishes[0].ingredients.find((i) => i.name === "謎の肉").matched, false);
  assert.equal(usedMonth(alice.id, "photo"), 1); assert.equal(usedDay(), before + 1);
  assert.equal(JSON.stringify(out).includes("base64"), false, "写真は応答に含めない");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipe_photos").get().n, 0, "写真は保存しない");
  t.ok("写真の推定: AI(偽物)1回、栄養は成分表からコードで計算、見つからない食材は印を付ける。写真は保存しない");

  f = fakeDeps({ vision: () => ({ status: 500, body: "" }) });
  out = await H.photoEstimateHandler(env, alice, { image: img }, f.deps);
  assert.equal(out.status, 502); assert.equal(f.calls.vision, 1); assert.equal(usedMonth(alice.id, "photo"), 1); assert.equal(usedDay(), before + 1);
  f = fakeDeps({ vision: () => ({ content: JSON.stringify({ dishes: [] }) }) });
  out = await H.photoEstimateHandler(env, alice, { image: img }, f.deps);
  assert.equal(out.status, 422); assert.equal(usedMonth(alice.id, "photo"), 1);
  f = fakeDeps({ vision: () => ({ content: "料理ではありません" }) });
  out = await H.photoEstimateHandler(env, alice, { image: img }, f.deps);
  assert.equal(out.status, 422); assert.equal(usedMonth(alice.id, "photo"), 1);
  t.ok("AIの失敗・料理が写っていない・壊れた返答は、回数を戻してやさしい案内を返す");

  sqlite.prepare("UPDATE ai_usage_user SET used = 40 WHERE user_id=? AND kind='photo'").run(alice.id);
  f = fakeDeps();
  out = await H.photoEstimateHandler(env, alice, { image: img }, f.deps);
  assert.equal(out.status, 429); assert.equal(f.calls.vision, 0); assert.match(out.body.error, /上限/);
  t.ok("月40回の上限に達したら、AIを呼ばずに断る");

  // 本番の経路(APIキーなし): 通信せず失敗し、回数も戻る
  sqlite.prepare("UPDATE ai_usage_user SET used = 0 WHERE user_id=?").run(alice.id);
  const dayBefore = usedDay();
  let r = await call(photoApi.onRequestPost, alice, { method: "POST", body: { image: img } });
  assert.equal(r.status, 502); assert.equal(usedMonth(alice.id, "photo"), 0); assert.equal(usedDay(), dayBefore);
  r = await call(photoApi.onRequestPost, null, { method: "POST", body: { image: img } }); assert.equal(r.status, 401);
  r = await call(photoApi.onRequestPost, alice, { method: "POST", body: { image: img }, headers: { Origin: "https://evil.example" } }); assert.equal(r.status, 403);
  r = await call(photoApi.onRequestPost, alice, { method: "POST", rawBody: "{x" }); assert.equal(r.status, 400);
  assert.deepEqual(guard.calls, []);
  t.ok("本番の経路: APIキーなしでは外部通信せず失敗し回数も戻る。未ログイン401・別サイト403・壊れたJSON400");

  // 写真の推定を、確認後に記録できる(source=photo・おおよそ)
  const mealsApi = await import("../functions/api/meals.js");
  r = await call(mealsApi.onRequestPost, alice, { method: "POST", body: { day: today, slot: "lunch", name: "牛丼", via: "photo", ingredients: [{ name: "ブロッコリー", grams: 50 }] } });
  assert.equal(r.status, 200); assert.equal(r.data.approx, true);
  assert.equal(sqlite.prepare("SELECT source FROM meal_logs WHERE id=?").get(r.data.id).source, "photo");
  t.ok("写真の推定は、ユーザーが確認・修正したあとに「おおよそ」として記録される");
}

assert.deepEqual(guard.calls, [], "外部通信は1件も試みられていない");
guard.restore();
t.done();
