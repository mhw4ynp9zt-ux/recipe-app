// 栄養の調整案(コード計算)のテスト。AIへの通信は一切なし(関数に直接データを渡すだけ)
import assert from "node:assert/strict";
import { suggestAdjustments, buildRetryPrompt } from "../functions/_lib/recipe-prompt.js";

const apps = [{ name: "レコルト 調理ポット", spec: { capacity: "600ml(300ml〜Maxライン)" } }];
const req = { appliances: apps, targets: { protein: 78, veg: 600 } };
const ing = (name, grams, protein, veg) => ({ name, grams, amount: grams + "g", contrib: { protein, veg } });
const dishes = [
  { name: "鶏のソテー", appliance: null, ingredientDetails: [ing("鶏むね肉", 200, 40, 0), ing("ブロッコリー", 100, 3, 100)] },
  { name: "ポタージュ", appliance: "レコルト 調理ポット", ingredientDetails: [ing("豆乳", 200, 7, 0), ing("かぼちゃ", 150, 3, 150)] },
];
const row = (id, label, target, total) => ({ id, label, unit: "g", target, total, min: target * 0.9, max: target * 1.1, diffPct: ((total - target) / target) * 100, ok: Math.abs(total - target) <= target * 0.1 });
const check = { ok: false, worst: 58, results: [row("protein", "たんぱく質", 78, 53), row("veg", "野菜", 600, 250)] };
const r = suggestAdjustments(req, dishes, check, []);
assert.ok(r, "調整案が出る");
const text = r.lines.join("\n");
assert.ok(text.includes("鶏のソテー"), "ポット以外の品を調整");
assert.ok(!text.includes("ポタージュ") && !text.includes("豆乳"), "ポットの品は触らない");
assert.ok(/鶏むね肉 200g → \d+g/.test(text) && /ブロッコリー 100g → \d+g/.test(text));
const exp = Object.fromEntries(r.expected.map((e) => [e.label, e.value]));
assert.ok(exp["たんぱく質"] > 53 && exp["野菜"] > 250, "見込みは増える方向");

// 目標内なら調整案なし
const ok = { ok: true, worst: 0, results: [row("protein", "たんぱく質", 78, 78), row("veg", "野菜", 600, 600)] };
assert.equal(suggestAdjustments(req, dishes, ok, []), null);

// 作り直し文: 容量のある家電があれば調整案と容量の注意が入る / なければ入らない
const p = buildRetryPrompt(req, dishes, check, [], []);
assert.ok(p.includes("【調整案】") && p.includes("600ml"), "調整案と容量の注意");
const p2 = buildRetryPrompt({ targets: req.targets }, dishes, check, [], []);
assert.ok(!p2.includes("【調整案】"), "家電なしでは従来どおり");
console.log("調整案テスト PASS(実際のAIへの通信: 0件)");
