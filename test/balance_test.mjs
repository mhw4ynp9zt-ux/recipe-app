// 今日のバランス・次の食事のおすすめ・週の振り返りのテスト。AI(有料)も外部サイトも呼びません。
import assert from "node:assert/strict";
import { createEnv, loginAs, callJson, installFetchGuard, makeRunner, saveRecipe } from "./_support.mjs";
import { AVOID_WORDS } from "../functions/_lib/kondate-messages.js";

const guard = installFetchGuard();
const t = makeRunner("今日のバランス・振り返り");
const B = await import("../functions/_lib/balance.js");
const meals = await import("../functions/_lib/meals.js");
const today = await import("../functions/api/today.js");
const review = await import("../functions/api/week/review.js");
const tg = await import("../functions/api/user/targets.js");

// ---- ゲージ ----
{
  const prot = { value: 65, kind: "min", unit: "g", source: "standard" };
  assert.equal(B.gaugeOf("protein", 40, prot).status, "below");
  assert.equal(B.gaugeOf("protein", 65, prot).status, "ok");
  assert.equal(B.gaugeOf("protein", 100, prot).status, "ok");
  assert.equal(B.gaugeOf("protein", 200, { ...prot, hi: 130 }).status, "above");
  const salt = { value: 7.5, kind: "max", unit: "g" };
  assert.equal(B.gaugeOf("salt", 7.4, salt).status, "ok");
  assert.equal(B.gaugeOf("salt", 7.6, salt).status, "above");
  assert.equal(B.gaugeOf("salt", 0, salt).status, "ok", "塩分は少ないほど良い側なので、0でも責めない");
  const fat = { value: 58, kind: "aim", lo: 50, hi: 70, unit: "g" };
  assert.equal(B.gaugeOf("fat", 49, fat).status, "below");
  assert.equal(B.gaugeOf("fat", 60, fat).status, "ok");
  assert.equal(B.gaugeOf("fat", 71, fat).status, "above");
  const cal = { value: 2000, kind: "aim", unit: "kcal" };
  assert.equal(B.gaugeOf("calories", 1800, cal).status, "ok");
  assert.equal(B.gaugeOf("calories", 1799, cal).status, "below");
  assert.equal(B.gaugeOf("calories", 2200, cal).status, "ok");
  assert.equal(B.gaugeOf("calories", 2201, cal).status, "above");
  assert.equal(B.gaugeOf("x", 5, null).status, "none");
  const g = B.gaugeOf("protein", 40, prot);
  assert.ok(g.fill >= 0 && g.fill <= 1 && g.mark >= 0 && g.mark <= 1);
  assert.equal(JSON.stringify(g).includes("あと"), false, "「あと◯g」のような差の数字は返さない");
  t.ok("ゲージの状態(以上/未満/範囲/目安±10%)の境目。塩分は少なくても責めない。差の数字は返さない");
}

// ---- 次の食事 ----
{
  const gauges = [
    B.gaugeOf("calories", 1200, { value: 2000, kind: "aim", unit: "kcal" }),
    B.gaugeOf("protein", 30, { value: 65, kind: "min", unit: "g" }),
    B.gaugeOf("fiber", 8, { value: 20, kind: "min", unit: "g" }),
    B.gaugeOf("salt", 5, { value: 7.5, kind: "max", unit: "g" }),
  ];
  const recipes = [
    { id: "a", name: "豆と魚の煮物", nutrition: { calories: 450, protein: 28, fiber: 9, salt: 2 } },
    { id: "b", name: "しょっぱい丼", nutrition: { calories: 500, protein: 35, fiber: 10, salt: 6 } },
    { id: "c", name: "こってり", nutrition: { calories: 1500, protein: 50, fiber: 15, salt: 2 } },
    { id: "d", name: "ゼリー", nutrition: { calories: 80, protein: 0, fiber: 0, salt: 0 } },
  ];
  const n = B.suggestNext(gauges, recipes);
  assert.deepEqual(n.picks.map((p) => p.recipeId), ["a"], "塩分・カロリーの余裕を超えるレシピと、役に立たないレシピは選ばない");
  assert.ok(n.picks[0].helps.includes("protein") && n.picks[0].helps.includes("fiber"));
  const done = B.suggestNext([B.gaugeOf("protein", 80, { value: 65, kind: "min" }), B.gaugeOf("fiber", 25, { value: 20, kind: "min" })], recipes);
  assert.equal(done.picks.length, 0); assert.match(done.title, /ここまでで十分/);
  t.ok("次の食事のおすすめ: 余裕の範囲で足せるものだけ。全部ちょうど良ければ「今日はここまでで十分です」");
}

// ---- 週の振り返り ----
{
  const eff = {
    protein: { value: 65, kind: "min", unit: "g" }, fiber: { value: 20, kind: "min", unit: "g" },
    veg: { value: 350, kind: "min", unit: "g" }, salt: { value: 7.5, kind: "max", unit: "g" }, fat: { value: 58, kind: "aim", lo: 50, hi: 70, unit: "g" },
  };
  const ws = "2026-10-19";
  const mk = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ day: meals.addDays(ws, i), nutrition: { protein: 70, fiber: 10, veg: 400, salt: 6, fat: 60, ...over } }));
  let r = B.buildReview(ws, mk(2), mk(2), eff);
  assert.ok(r.few); assert.equal(r.hint, null); assert.equal(r.average, null);
  t.ok("記録のある日が3日未満のときは、傾向もヒントも出さず「これから見えてきます」");
  r = B.buildReview(ws, mk(5), mk(5), eff);
  assert.equal(r.recordedDays, 5); assert.ok(r.positives.length >= 2); assert.equal(r.hint.id, "fiber");
  assert.equal(r.hint.action.metric, "fiber");
  assert.equal(r.fourWeek, null, "4週の平均は、記録が7日以上になってから");
  t.ok("良かった点を先に出し、ヒントは1つだけ(食物繊維が低めの週は食物繊維)");
  r = B.buildReview(ws, mk(7, { fiber: 22 }), mk(7, { fiber: 22 }), eff);
  assert.equal(r.hint, null); assert.equal(r.fourWeek.days, 7);
  t.ok("全部整っている週はヒントなし。7日以上たまると4週の平均も出る");
  r = B.buildReview(ws, mk(5, { fiber: 22, salt: 9 }), mk(5), eff);
  assert.equal(r.hint.id, "salt"); assert.equal(r.hint.action, null);
  t.ok("塩分が多めの週のヒントは、責めずに味付けの工夫を伝える");
  const text = JSON.stringify(B.buildReview(ws, mk(7, { fiber: 2, protein: 10, veg: 0, salt: 12, fat: 100 }), mk(7), eff));
  for (const w of AVOID_WORDS) assert.equal(text.includes(w), false, "避ける言葉: " + w);
  t.ok("どれだけ崩れた週でも、避けたい言葉(不足・足りない・失敗…)は文面に出ない");
}

// ---- API ----
{
  const { env, sqlite } = createEnv();
  const a = await loginAs(env, sqlite, "alice");
  const day = meals.todayJst();
  let r = await callJson(today.onRequestGet, env, {});
  assert.equal(r.status, 401);
  r = await callJson(review.onRequestGet, env, {});
  assert.equal(r.status, 401);
  r = await callJson(today.onRequestGet, env, { cookie: a.cookie, url: "https://recipe.test/api/today?day=bad" });
  assert.equal(r.status, 400);
  t.ok("未ログインは401、不正な日付は400");

  r = await callJson(today.onRequestGet, env, { cookie: a.cookie });
  assert.equal(r.status, 200); assert.equal(r.data.balance.hasMeals, false); assert.match(r.data.balance.empty, /まだ記録がありません/); assert.equal(r.data.next, null);
  t.ok("記録も目標もないときは、責めずに案内だけ返す");

  await callJson(tg.onRequestPut, env, { method: "PUT", cookie: a.cookie, body: { profile: { sex: "female", age: 30, activity: "normal" } } });
  saveRecipe(sqlite, a.id, { id: "r1", name: "豆と魚", nutrition: { calories: 400, protein: 25, fiber: 9, salt: 2 } });
  sqlite.prepare("INSERT INTO meal_logs (id,user_id,day,slot,name,nutrition,approx,source,created_at) VALUES ('m1',?,?,?,?,?,0,'quick',1)").run(a.id, day, "breakfast", "トースト", JSON.stringify({ calories: 300, protein: 10, fiber: 2, salt: 1.5 }));
  r = await callJson(today.onRequestGet, env, { cookie: a.cookie });
  assert.equal(r.data.balance.hasMeals, true); assert.equal(r.data.hasTargets, true);
  const prot = r.data.balance.gauges.find((g) => g.id === "protein");
  assert.equal(prot.status, "below"); assert.equal(prot.text, "まだ伸ばせます");
  assert.ok(r.data.next.picks.some((p) => p.recipeId === "r1"));
  t.ok("目標と記録があれば、ゲージと次の食事のおすすめ(保存済みレシピ)が返る");

  r = await callJson(review.onRequestGet, env, { cookie: a.cookie });
  assert.equal(r.status, 200); assert.ok(r.data.title);
  sqlite.exec("DROP TABLE meal_logs");
  r = await callJson(today.onRequestGet, env, { cookie: a.cookie }); assert.equal(r.status, 503);
  r = await callJson(review.onRequestGet, env, { cookie: a.cookie }); assert.equal(r.status, 503);
  t.ok("週の振り返りAPIが返る。テーブルなしは503");
}

assert.deepEqual(guard.calls, [], "外部通信は1件も試みられていない");
guard.restore();
t.done();
