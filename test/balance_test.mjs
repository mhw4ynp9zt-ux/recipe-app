// 栄養の状態の判定(gaugeOf)・週の振り返り・今日の食事APIのテスト。AI(有料)も外部サイトも呼びません。
// (「今日のバランス」「次の食事のおすすめ」は画面とAPIから外したため、そのテストはありません。外したことも下で確かめます)
import assert from "node:assert/strict";
import { createEnv, loginAs, callJson, installFetchGuard, makeRunner } from "./_support.mjs";
import { AVOID_WORDS } from "../functions/_lib/kondate-messages.js";

const guard = installFetchGuard();
const t = makeRunner("栄養の状態判定・振り返り・今日の食事API");
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

// ---- 外したもの ----
{
  assert.equal(B.buildBalance, undefined); assert.equal(B.suggestNext, undefined);
  t.ok("「今日のバランス」(buildBalance)と「次の食事のおすすめ」(suggestNext)は、もう無い");
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
  assert.equal(r.status, 200); assert.deepEqual(r.data.meals, []); assert.equal(r.data.showNumbers, true);
  assert.equal("balance" in r.data, false); assert.equal("next" in r.data, false); assert.equal("hasTargets" in r.data, false);
  t.ok("記録がないときは、空の一覧を返す(バランス・次の食事のおすすめは返さない)");

  await callJson(tg.onRequestPut, env, { method: "PUT", cookie: a.cookie, body: { profile: { sex: "female", age: 30, activity: "normal" }, showNumbers: false } });
  sqlite.prepare("INSERT INTO meal_logs (id,user_id,day,slot,name,nutrition,approx,source,created_at) VALUES ('m1',?,?,?,?,?,0,'quick',1)").run(a.id, day, "breakfast", "トースト", JSON.stringify({ calories: 300, protein: 10, fiber: 2, salt: 1.5 }));
  r = await callJson(today.onRequestGet, env, { cookie: a.cookie });
  assert.equal(r.data.meals.length, 1); assert.equal(r.data.meals[0].name, "トースト"); assert.equal(r.data.showNumbers, false);
  assert.equal(r.data.quota.photo.cap, 40);
  t.ok("記録した食事が返り、「数字を隠す」設定と写真の残り回数も返る");

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
