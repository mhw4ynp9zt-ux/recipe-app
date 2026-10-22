// 食事の記録のテスト。AI(有料)も外部サイトも呼びません(見張り役が外部通信を1件でも試みたら失敗)。
import assert from "node:assert/strict";
import fs from "node:fs";
import { createEnv, loginAs, callJson, installFetchGuard, makeRunner, saveRecipe } from "./_support.mjs";

const guard = installFetchGuard();
const t = makeRunner("食事の記録");
const lib = await import("../functions/_lib/meals.js");
const api = await import("../functions/api/meals.js");
const del = await import("../functions/api/meals/[id].js");

assert.equal(lib.todayJst(Date.parse("2026-10-22T14:59:00Z")), "2026-10-22");
assert.equal(lib.todayJst(Date.parse("2026-10-22T15:00:00Z")), "2026-10-23");
assert.equal(lib.weekStartOf("2026-10-22"), "2026-10-19"); // 木曜 → 月曜
assert.equal(lib.weekStartOf("2026-10-25"), "2026-10-19"); // 日曜 → 月曜
assert.equal(lib.isValidDay("2026-02-30"), false);
assert.equal(lib.isValidDay("2026-10-22"), true);
t.ok("日本時間の「今日」・週の始まり(月曜)・日付の検証");

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
// 日本食品標準成分表(db/seed-foods.sql)を、メモリ上のDBに流して使う(外部通信なし)
const { env, sqlite } = createEnv({ extraSql: [read("db/migration-003-foods.sql"), read("db/seed-foods.sql")] });
const alice = await loginAs(env, sqlite, "alice");
const bob = await loginAs(env, sqlite, "bob");
const today = lib.todayJst();
const nut = { calories: 600, protein: 30, fat: 20, salt: 3, fiber: 5, carbs: 60, carbohydrate: 65, veg: 120 };
saveRecipe(sqlite, alice.id, { id: "r1", name: "鮭の塩焼き", nutrition: nut, nutritionCheck: { unmatched: [], missing: [] } });
saveRecipe(sqlite, alice.id, { id: "r2", name: "あやしい煮物", nutrition: nut, nutritionCheck: { unmatched: ["謎の食材"], missing: [] } });
saveRecipe(sqlite, bob.id, { id: "rb", name: "bobの料理", nutrition: nut });
const post = (user, body, extra = {}) => callJson(api.onRequestPost, env, { method: "POST", cookie: user && user.cookie, body, ...extra });
const get = (user, day) => callJson(api.onRequestGet, env, { cookie: user && user.cookie, url: "https://recipe.test/api/meals" + (day ? "?day=" + day : "") });

let r = await post(null, { day: today, slot: "dinner", recipeId: "r1" });
assert.equal(r.status, 401); t.ok("未ログインでは記録できない(401)");
r = await post(alice, { day: today, slot: "dinner", recipeId: "r1" }, { headers: { Origin: "https://evil.example" } });
assert.equal(r.status, 403); t.ok("別サイトからの記録は断る(403)");
r = await get(null); assert.equal(r.status, 401); t.ok("未ログインでは見られない(401)");

r = await post(alice, { day: today, slot: "dinner", recipeId: "r1", portion: 0.5 });
assert.equal(r.status, 200); assert.equal(r.data.nutrition.calories, 300); assert.equal(r.data.nutrition.protein, 15); assert.equal(r.data.approx, false);
assert.match(r.data.name, /0.5人前/);
t.ok("保存済みレシピを0.5人前で記録すると、栄養が半分になる");
const firstId = r.data.id;

r = await post(alice, { day: today, slot: "lunch", recipeId: "r2", portion: 2 });
assert.equal(r.data.nutrition.calories, 1200); assert.equal(r.data.approx, true);
t.ok("計算に入れられなかった食材があるレシピは「おおよそ」として記録する");

r = await post(alice, { day: today, slot: "snack", name: "コンビニのおにぎり", nutrition: { calories: 180, protein: 4 } });
assert.equal(r.status, 200); assert.equal(r.data.approx, true);
t.ok("かんたん入力(料理名+おおよその値)は「おおよそ」として記録する");

for (const [body, re] of [
  [{ day: "2026-13-01", slot: "dinner", recipeId: "r1" }, /日付/],
  [{ day: today, slot: "brunch", recipeId: "r1" }, /区分/],
  [{ day: lib.addDays(today, 5), slot: "dinner", recipeId: "r1" }, /先の日付/],
  [{ day: lib.addDays(today, -40), slot: "dinner", recipeId: "r1" }, /古い日付/],
  [{ day: today, slot: "dinner", recipeId: "r1", portion: 7 }, /量/],
  [{ day: today, slot: "dinner", name: "", nutrition: { calories: 1 } }, /料理名/],
  [{ day: today, slot: "dinner", name: "x", nutrition: { calories: -5 } }, /値/],
  [{ day: today, slot: "dinner", name: "x", nutrition: { calories: 99999 } }, /値/],
  [{ day: today, slot: "dinner", name: "x", nutrition: { magic: 5 } }, /項目/],
  [{ day: today, slot: "dinner", name: "x", nutrition: {} }, /1つ以上/],
  [{ day: today, slot: "dinner", name: "x", ingredients: [{ name: "米", grams: 0 }] }, /食材/],
]) {
  r = await post(alice, body); assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.data.error, re);
}
r = await post(alice, { day: today, slot: "dinner", recipeId: "nothing" }); assert.equal(r.status, 404);
r = await post(alice, { day: today, slot: "dinner", recipeId: "rb" }); assert.equal(r.status, 404);
t.ok("不正な入力は400、存在しない/他人のレシピは404(他人のレシピは記録できない)");

r = await post(alice, { day: today, slot: "dinner", name: "謎", ingredients: [{ name: "ほげふがぴよ", grams: 150 }] });
assert.equal(r.status, 422); t.ok("成分表で見つからない食材だけのときは422(誤った値を入れない)");
r = await post(alice, { day: today, slot: "dinner", name: "ブロッコリーと謎", ingredients: [{ name: "ブロッコリー", grams: 100 }, { name: "ほげふがぴよ", grams: 50 }] });
assert.equal(r.status, 200); assert.ok(r.data.nutrition.calories > 0); assert.equal(r.data.approx, true);
await callJson(del.onRequestDelete, env, { method: "DELETE", cookie: alice.cookie, params: { id: r.data.id } });
t.ok("食材のグラム入力は成分表から計算し、見つからない食材があれば「おおよそ」にする");

r = await get(alice, today);
assert.equal(r.data.meals.length, 3); assert.equal(r.data.totals.calories, 300 + 1200 + 180); assert.equal(r.data.approx, true);
r = await get(bob, today); assert.equal(r.data.meals.length, 0);
t.ok("その日の記録と合計が返る。ほかのユーザーの記録は見えない");

r = await callJson(del.onRequestDelete, env, { method: "DELETE", cookie: bob.cookie, params: { id: firstId } });
assert.equal(r.status, 404);
r = await callJson(del.onRequestDelete, env, { method: "DELETE", cookie: alice.cookie, params: { id: firstId }, headers: { Origin: "https://evil.example" } });
assert.equal(r.status, 403);
r = await callJson(del.onRequestDelete, env, { method: "DELETE", cookie: alice.cookie, params: { id: firstId } });
assert.equal(r.status, 200);
r = await get(alice, today); assert.equal(r.data.meals.length, 2);
t.ok("記録は本人だけが消せる(他人は404・別サイトは403)");

// 古い記録は、記録のたびに消える
sqlite.prepare("INSERT INTO meal_logs (id,user_id,day,slot,name,nutrition,approx,source,created_at) VALUES ('old',?,?,?,?,?,0,'quick',1)").run(alice.id, lib.addDays(today, -60), "dinner", "古い", "{}");
await post(alice, { day: today, slot: "snack", name: "x", nutrition: { calories: 1 } });
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM meal_logs WHERE id='old'").get().n, 0);
t.ok("35日より古い記録は、記録のたびに消える");

for (let i = 0; i < 20; i++) await post(alice, { day: lib.addDays(today, -1), slot: "snack", name: "n" + i, nutrition: { calories: 1 } });
r = await post(alice, { day: lib.addDays(today, -1), slot: "snack", name: "over", nutrition: { calories: 1 } });
assert.equal(r.status, 400); t.ok("1日に記録できるのは20件まで");

sqlite.exec("DROP TABLE meal_logs");
r = await get(alice, today); assert.equal(r.status, 503); assert.equal(r.data.unavailable, true);
r = await post(alice, { day: today, slot: "dinner", recipeId: "r1" }); assert.equal(r.status, 503);
t.ok("マイグレーション前(テーブルなし)は、落ちずに「準備中」(503)");

assert.deepEqual(guard.calls, [], "外部通信は1件も試みられていない");
guard.restore();
t.done();
