// 文言のチェック: 画面に出す言葉に、ユーザーを責める言葉(不足・足りない・未達・失敗…)が入っていないことを確かめる。
// 「あと◯g足りない」のような差の数字を出す言い方も使わない。文言を足したときに、うっかり入れてしまうのを防ぐ。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, makeRunner } from "./_support.mjs";
import * as M from "../functions/_lib/kondate-messages.js";

const t = makeRunner("やさしい言葉づかい");
const AVOID = [...M.AVOID_WORDS];
assert.ok(AVOID.includes("不足") && AVOID.includes("足りない") && AVOID.includes("未達") && AVOID.includes("失敗"));

// 1) サーバー側の文言(関数は例の引数で呼ぶ)
const strings = [];
(function collect(v) {
  if (typeof v === "string") strings.push(v);
  else if (typeof v === "function") { try { collect(v(3, 5, "protein", 1200)); } catch (e) { /* 引数が合わないものは飛ばす */ } }
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === "object") Object.values(v).forEach(collect);
})(Object.fromEntries(Object.entries(M).filter(([k]) => k !== "AVOID_WORDS")));
assert.ok(strings.length > 30, "文言を集められている: " + strings.length);
for (const s of strings) for (const w of AVOID) assert.ok(!s.includes(w), `文言「${s}」に避けたい言葉「${w}」が入っています`);
t.ok(`サーバー側の文言(${strings.length}個)に、避けたい言葉が1つも入っていない`);

// 2) 画面側(コメントを除いた本文)
const files = ["js/today.js", "js/week.js", "js/targets.js", "js/meal-photo.js", "js/kondate-core.js"];
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s\/\/.*$/gm, "");
  for (const w of AVOID) assert.ok(!src.includes(w), `${f} に避けたい言葉「${w}」が入っています`);
  assert.ok(!/あと\s*['"+]?\s*\$?\{?[^'"]*[gｇ]\s*(足|不)/.test(src), `${f} に「あと◯g足りない」の言い方があります`);
}
t.ok(`画面側のファイル(${files.length}個)に、避けたい言葉が1つも入っていない`);

// 3) 数字の差を、サーバーが返さない(ゲージは位置だけ)
const { gaugeOf } = await import("../functions/_lib/balance.js");
const g = gaugeOf("protein", 20, { value: 65, kind: "min", unit: "g" });
assert.ok(!("gap" in g) && !("remaining" in g) && !("shortfall" in g));
t.ok("ゲージは「目標との差」の数字を返さない(位置と状態の言葉だけ)");

// 4) 言い回しの方向: 状態の言葉は「足せる」「整う」側
assert.equal(M.STATUS_TEXT.below, "まだ伸ばせます");
assert.equal(M.STATUS_TEXT.ok, "ちょうど良い");
t.ok("状態の言葉は「まだ伸ばせます」「ちょうど良い」の言い方");

t.done();
