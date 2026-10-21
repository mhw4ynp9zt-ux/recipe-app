// 炭水化物量の計算テスト。
// 【重要】実際のAI(xAI・有料)も外部サイトも呼びません。
//   ・メモリ上のSQLiteに、日本食品標準成分表(db/seed-foods.sql)を流して、nutrition.js の計算だけを確かめる
//   ・fetch は「見張り役」に差し替え、どこへの通信も即エラーにする(通信が1回でも起きたら失敗)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, createEnv, installFetchGuard, makeRunner } from "./_support.mjs";
import { attachNutrition, METRIC_IDS } from "../functions/_lib/nutrition.js";

const t = makeRunner("炭水化物量の計算");
const guard = installFetchGuard({}); // 許可する通信は無し

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const { env, sqlite } = createEnv({ extraSql: [read("db/migration-003-foods.sql"), read("db/seed-foods.sql")] });

const dish = (details) => ({ name: "テスト", ingredientDetails: details.map(([name, grams, food]) => ({ name, amount: grams + "g", grams, food })) });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.06, `${msg}: ${a} vs ${b}`);

// 1) 指標一覧に炭水化物がある(糖質・食物繊維とは別の指標)
assert.ok(METRIC_IDS.includes("carbohydrate") && METRIC_IDS.includes("carbs") && METRIC_IDS.includes("fiber"));
t.ok("指標に carbohydrate がある(carbs・fiber とは別)");

// 2) 成分表の「炭水化物」× グラム数 ÷ 100 で計算される(200g のごはんと 100g のブロッコリーで確かめる)
const rows = sqlite.prepare("SELECT food_no, name, chocdf, choavl, choavldf, fib FROM foods WHERE name LIKE '%めし%精白米%うるち米%' OR name LIKE '%ブロッコリー%花序%生%'").all();
assert.ok(rows.length >= 2, "テスト用の食品が成分表に無い: " + JSON.stringify(rows.map((r) => r.name)));
const rice = rows.find((r) => /めし/.test(r.name));
const broccoli = rows.find((r) => /ブロッコリー/.test(r.name));
const [d] = await attachNutrition(env, [dish([["ごはん", 200, rice.name], ["ブロッコリー", 100, broccoli.name]])], ["carbohydrate", "carbs", "fiber"]);
const expectCarb = rice.chocdf * 2 + broccoli.chocdf;
near(d.nutrition.carbohydrate, Math.round(expectCarb * 10) / 10, "炭水化物の合計");
t.ok(`炭水化物 = 成分表の値×グラム数(ごはん200g+ブロッコリー100g → ${d.nutrition.carbohydrate}g)`);

// 3) 炭水化物は、糖質より小さくならない(糖質 + 食物繊維 ≒ 炭水化物)
assert.ok(d.nutrition.carbohydrate >= d.nutrition.carbs, "炭水化物 < 糖質");
t.ok(`炭水化物(${d.nutrition.carbohydrate}g) ≧ 糖質(${d.nutrition.carbs}g)`);

// 4) 有効にした指標は dish にも入り、手入力の食材も合計に入る
assert.equal(d.carbohydrate, d.nutrition.carbohydrate);
const [d2] = await attachNutrition(env, [{ name: "手入力", ingredientDetails: [{ name: "謎の食材", amount: "50g", grams: 50, food: "存在しない食品名zzz", manual: { carbohydrate: 12.5 } }] }], ["carbohydrate"]);
assert.equal(d2.nutrition.carbohydrate, 12.5);
t.ok("有効指標は dish にも入る/成分表に無い食材の手入力値も合計に入る");

// 5) 通信は1回も起きていない
assert.deepEqual(guard.calls, []);
guard.restore();
t.ok("外部通信は0回(AIも呼んでいない)");
t.done();
