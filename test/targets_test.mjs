// 「目標の目安」(基準表・安全設定・保存API)のテスト。AI(有料)も外部サイトも呼びません(見張り役が外部通信を1件でも試みたら失敗)。
// 基準表の値は、公式の「日本人の食事摂取基準(2025年版)」の値を固定している。直すときは公式の報告書と見比べること。
import assert from "node:assert/strict";
import { createEnv, loginAs, callJson, installFetchGuard, makeRunner } from "./_support.mjs";

const guard = installFetchGuard();
const t = makeRunner("目標の目安");
const dri = await import("../functions/_lib/dri2025.js");
const targets = await import("../functions/_lib/targets.js");
const api = await import("../functions/api/user/targets.js");

// ---- 基準表そのもの(公式の値) ----
{
  const E = dri.DRI_TABLES.ENERGY;
  assert.deepEqual(E.male["18-29"], [2250, 2600, 3000]);
  assert.deepEqual(E.male["30-49"], [2350, 2750, 3150]);
  assert.deepEqual(E.male["50-64"], [2250, 2650, 3000]);
  assert.deepEqual(E.male["65-74"], [2100, 2350, 2650]);
  assert.deepEqual(E.male["75+"], [1850, 2250, null]);
  assert.deepEqual(E.female["18-29"], [1700, 1950, 2250]);
  assert.deepEqual(E.female["30-49"], [1750, 2050, 2350]);
  assert.deepEqual(E.female["50-64"], [1700, 1950, 2250]);
  assert.deepEqual(E.female["65-74"], [1650, 1850, 2050]);
  assert.deepEqual(E.female["75+"], [1450, 1750, null]);
  t.ok("推定エネルギー必要量の表(男女・5区分・低い/ふつう/高い)が公式の値と一致");

  const T = dri.DRI_TABLES;
  assert.deepEqual(T.PROTEIN_RDA.male, { "18-29": 65, "30-49": 65, "50-64": 65, "65-74": 60, "75+": 60 });
  assert.deepEqual(T.PROTEIN_RDA.female, { "18-29": 50, "30-49": 50, "50-64": 50, "65-74": 50, "75+": 50 });
  assert.deepEqual(T.PROTEIN_PCT, { "18-29": [13, 20], "30-49": [13, 20], "50-64": [14, 20], "65-74": [15, 20], "75+": [15, 20] });
  assert.deepEqual(T.FAT_PCT, [20, 30]);
  assert.deepEqual(T.CARBOHYDRATE_PCT, [50, 65]);
  assert.deepEqual(T.FIBER_MIN.male, { "18-29": 20, "30-49": 22, "50-64": 22, "65-74": 21, "75+": 20 });
  assert.deepEqual(T.FIBER_MIN.female, { "18-29": 18, "30-49": 18, "50-64": 18, "65-74": 18, "75+": 17 });
  assert.deepEqual(T.SALT_MAX, { male: 7.5, female: 6.5 });
  assert.deepEqual(T.BMI_RANGE["18-29"], [18.5, 24.9]);
  assert.deepEqual(T.BMI_RANGE["30-49"], [18.5, 24.9]);
  assert.deepEqual(T.BMI_RANGE["50-64"], [20.0, 24.9]);
  assert.deepEqual(T.BMI_RANGE["65-74"], [21.5, 24.9]);
  assert.deepEqual(T.BMI_RANGE["75+"], [21.5, 24.9]);
  assert.deepEqual(T.KCAL_PER_G, { protein: 4, carbohydrate: 4, fat: 9 });
  t.ok("たんぱく質・脂質・炭水化物・食物繊維・食塩相当量・目標とするBMIの表が公式の値と一致");
  assert.ok(Object.isFrozen(T), "表は書き換えできない");
}

// ---- 基準値を引く ----
{
  const r = dri.computeStandard({ sex: "male", age: 25, activity: "normal" });
  assert.equal(r.ok, true);
  assert.equal(r.band, "18-29");
  assert.equal(r.requirement, 2600);
  assert.equal(r.items.calories.value, 2600);
  assert.equal(r.items.protein.value, 85);   // 2600×13%÷4=84.5→85(推奨量65gより大きい)
  assert.equal(r.items.protein.hi, 130);     // 2600×20%÷4
  assert.equal(r.items.fat.lo, 58);          // 2600×20%÷9=57.8
  assert.equal(r.items.fat.hi, 87);          // 2600×30%÷9=86.7
  assert.equal(r.items.carbohydrate.lo, 325);
  assert.equal(r.items.carbohydrate.hi, 423);
  assert.equal(r.items.fiber.value, 20);
  assert.equal(r.items.salt.value, 7.5);
  assert.equal(r.items.salt.kind, "max");
  t.ok("男性25歳・ふつう: エネルギー2,600・たんぱく質85以上(推奨量65と13%Eの大きい方)・食物繊維20以上・食塩7.5未満");

  const w = dri.computeStandard({ sex: "female", age: 30, activity: "low" });
  assert.equal(w.requirement, 1750);
  assert.equal(w.items.protein.value, Math.max(50, Math.round(1750 * 0.13 / 4)));
  assert.equal(w.items.salt.value, 6.5);
  t.ok("女性30歳・低い: エネルギー1,750・食塩6.5未満");

  assert.equal(dri.computeStandard({ sex: "male", age: 80, activity: "high" }).reason, "no-value");
  assert.equal(dri.computeStandard({ sex: "female", age: 80, activity: "high" }).reason, "no-value");
  assert.equal(dri.computeStandard({ sex: "male", age: 17, activity: "normal" }).reason, "age");
  assert.equal(dri.computeStandard({ sex: "other", age: 30, activity: "normal" }).reason, "sex");
  assert.equal(dri.computeStandard({ sex: "male", age: 30, activity: "super" }).reason, "activity");
  t.ok("表に無い組み合わせ(75歳以上の「高い」)・18歳未満・不正な値は、値を出さない");

  const adj = dri.computeStandard({ sex: "male", age: 25, activity: "normal" }, { energyAim: 2340 });
  assert.equal(adj.items.calories.value, 2340);
  assert.equal(adj.items.fat.lo, Math.round(2340 * 0.2 / 9));
  t.ok("エネルギーを調整したときは、%エネルギーの目標量を調整後のエネルギーでgに換算する");

  assert.equal(dri.ageBandOf(18).id, "18-29"); assert.equal(dri.ageBandOf(29).id, "18-29"); assert.equal(dri.ageBandOf(30).id, "30-49");
  assert.equal(dri.ageBandOf(49).id, "30-49"); assert.equal(dri.ageBandOf(50).id, "50-64"); assert.equal(dri.ageBandOf(64).id, "50-64");
  assert.equal(dri.ageBandOf(65).id, "65-74"); assert.equal(dri.ageBandOf(74).id, "65-74"); assert.equal(dri.ageBandOf(75).id, "75+"); assert.equal(dri.ageBandOf(110).id, "75+");
  t.ok("年齢区分の境目(29/30・49/50・64/65・74/75)");

  const b = dri.bmiInfo(25, 170, 65);
  assert.equal(b.bmi, 22.5); assert.equal(b.position, "in"); assert.deepEqual(b.range, [18.5, 24.9]);
  assert.equal(dri.bmiInfo(25, 170, 50).position, "below");
  assert.equal(dri.bmiInfo(25, 170, 80).position, "above");
  assert.equal(dri.bmiInfo(55, 170, 55).position, "below"); // 50〜64歳の下限は20.0 → BMI19.0
  t.ok("BMIの計算と、年齢ごとの目標範囲との位置づけ");
}

// ---- 入力の検証・目標の組み立て ----
{
  const ok = (profile, extra = {}) => targets.parseTargetsRequest({ profile, ...extra });
  assert.equal(ok({ sex: "male", age: 25, activity: "normal" }).value.profile.purpose, "maintain");
  assert.match(ok({ age: 25, activity: "normal" }).error, /性別/);
  assert.match(ok({ sex: "male", age: 17, activity: "normal" }).error, /18歳未満/);
  assert.match(ok({ sex: "male", age: 25.5, activity: "normal" }).error, /年齢/);
  assert.match(ok({ sex: "male", age: 25, activity: "x" }).error, /活動/);
  assert.match(ok({ sex: "male", age: 25, activity: "normal", heightCm: 170 }).error, /両方/);
  assert.match(ok({ sex: "male", age: 25, activity: "normal", heightCm: 20, weightKg: 60 }).error, /身長/);
  assert.match(ok({ sex: "male", age: 25, activity: "normal", purpose: "x" }).error, /目的/);
  assert.match(ok({ sex: "male", age: 25, activity: "normal" }, { overrides: { protein: -3 } }).error, /たんぱく質/);
  assert.match(ok({ sex: "male", age: 25, activity: "normal" }, { overrides: { magic: 3 } }).error, /項目/);
  assert.match(ok({ sex: "male", age: 25, activity: "normal" }, { showNumbers: "yes" }).error, /表示/);
  assert.equal(targets.parseTargetsRequest(null).error, "リクエストが不正です");
  t.ok("入力の検証(性別・年齢・活動・身長体重・目的・自分で設定した値・表示設定)");

  let r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal" }).value);
  assert.equal(r.ok, true);
  assert.equal(r.effective.calories.source, "standard"); assert.equal(r.effective.protein.value, 85);
  assert.equal(r.effective.veg, undefined, "基準表に無い野菜・糖質は、自分で設定するまで目標なし");
  assert.equal(r.effective.carbs, undefined);
  assert.equal(r.notices.length, 0);
  t.ok("基準表の値が目標になる。野菜・糖質は基準表に値が無いので、目標なし");

  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal" }, { overrides: { protein: 104, veg: 800 } }).value);
  assert.equal(r.effective.protein.value, 104); assert.equal(r.effective.protein.source, "self"); assert.equal(r.effective.protein.hi, undefined);
  assert.equal(r.effective.veg.value, 800);
  assert.equal(r.effective.fiber.source, "standard");
  assert.ok(r.notices.some((n) => /自分で設定/.test(n)));
  t.ok("自分で入力した値が優先され「自己設定値」の注意が出る(ほかの項目は基準表のまま)");

  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", purpose: "lose" }).value);
  assert.equal(r.effective.calories.value, 2340); // 2600×0.9=2340
  assert.ok(r.notices.some((n) => /アプリ独自/.test(n)));
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", purpose: "gain" }).value);
  assert.equal(r.effective.calories.value, 2860);
  t.ok("「減らす」「増やす」はエネルギーを±10%だけ動かし、アプリ独自の調整だと表示する");

  r = targets.buildTargets(ok({ sex: "female", age: 25, activity: "low", purpose: "lose" }).value);
  assert.equal(r.ok, true); assert.equal(r.effective.calories.value, 1530);
  r = targets.buildTargets(ok({ sex: "female", age: 80, activity: "low", purpose: "lose" }).value);
  assert.equal(r.ok, true); assert.equal(r.effective.calories.value, 1310);
  r = targets.buildTargets(ok({ sex: "female", age: 80, activity: "low", purpose: "lose" }, { overrides: { calories: 1100 } }).value);
  assert.equal(r.ok, false); assert.match(r.error, /1,200kcal以上/);
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal" }, { overrides: { calories: 1199 } }).value);
  assert.equal(r.ok, false);
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal" }, { overrides: { calories: 1200 } }).value);
  assert.equal(r.ok, true);
  assert.ok(r.notices.some((n) => /相談/.test(n)), "基準より大きく低い値には、止めずに相談のおすすめ");
  t.ok("エネルギーは1,200kcal未満にできない(境目1,199は不可・1,200は可)。基準より大きく低いときは相談のおすすめを出す");

  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", heightCm: 170, weightKg: 50, purpose: "lose" }).value);
  assert.equal(r.ok, false); assert.match(r.error, /減らす/);
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", heightCm: 170, weightKg: 80, purpose: "gain" }).value);
  assert.equal(r.ok, false); assert.match(r.error, /増やす/);
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", heightCm: 170, weightKg: 50 }).value);
  assert.equal(r.ok, true); assert.ok(r.notices.some((n) => /低め/.test(n)));
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", heightCm: 170, weightKg: 80 }).value);
  assert.equal(r.ok, true); assert.ok(r.notices.some((n) => /高め/.test(n)));
  r = targets.buildTargets(ok({ sex: "male", age: 25, activity: "normal", heightCm: 170, weightKg: 65, purpose: "lose" }).value);
  assert.equal(r.ok, true);
  t.ok("目標とするBMIより低い人は「減らす」、高い人は「増やす」を選べない。範囲外のBMIには相談のおすすめ");

  r = targets.buildTargets(ok({ sex: "male", age: 80, activity: "high" }).value);
  assert.equal(r.ok, false); assert.match(r.error, /公表されていません/);
  t.ok("表に値のない組み合わせは、理由を伝えて保存させない");

  r = targets.buildTargets(ok({ special: true }, { overrides: { calories: 1800, protein: 70 } }).value);
  assert.equal(r.ok, true); assert.equal(r.mode, "manual"); assert.equal(r.standard, null);
  assert.deepEqual(Object.keys(r.effective).sort(), ["calories", "protein"]);
  assert.ok(r.notices.some((n) => /医師や管理栄養士/.test(n)));
  r = targets.buildTargets(ok({ special: true }).value);
  assert.equal(r.ok, true); assert.deepEqual(r.effective, {});
  t.ok("妊娠中・授乳中・18歳未満・通院中に当てはまるときは、基準表を使わず、手入力の値だけ(未入力なら目標なし)");
}

// ---- API ----
{
  const { env, sqlite } = createEnv();
  const alice = await loginAs(env, sqlite, "alice");
  const bob = await loginAs(env, sqlite, "bob");
  const B = { profile: { sex: "male", age: 25, activity: "normal", purpose: "maintain" }, overrides: { protein: 104 }, showNumbers: true };

  let r = await callJson(api.onRequestGet, env, {});
  assert.equal(r.status, 401); t.ok("未ログインでは見られない(401)");
  r = await callJson(api.onRequestPut, env, { method: "PUT", body: B });
  assert.equal(r.status, 401); t.ok("未ログインでは保存できない(401)");
  r = await callJson(api.onRequestPut, env, { method: "PUT", cookie: alice.cookie, body: B, headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403); t.ok("別サイトからの保存は断る(403)");
  r = await callJson(api.onRequestPut, env, { method: "PUT", cookie: alice.cookie, rawBody: "{oops" });
  assert.equal(r.status, 400); t.ok("壊れたJSONは400");
  r = await callJson(api.onRequestPut, env, { method: "PUT", cookie: alice.cookie, body: { ...B, overrides: { calories: 900 } } });
  assert.equal(r.status, 400); assert.match(r.data.error, /1,200/); t.ok("安全設定に反する値は400(保存されない)");

  r = await callJson(api.onRequestGet, env, { cookie: alice.cookie });
  assert.equal(r.status, 200); assert.equal(r.data.configured, false); assert.deepEqual(r.data.effective, {});
  t.ok("まだ保存していないときは、目標なし(configured: false)で返る");

  r = await callJson(api.onRequestPut, env, { method: "PUT", cookie: alice.cookie, body: B });
  assert.equal(r.status, 200); assert.equal(r.data.effective.protein.value, 104); assert.equal(r.data.effective.calories.value, 2600);
  assert.equal(r.data.source.publisher, "厚生労働省");
  r = await callJson(api.onRequestGet, env, { cookie: alice.cookie });
  assert.equal(r.data.configured, true); assert.equal(r.data.effective.protein.source, "self"); assert.equal(r.data.profile.age, 25);
  t.ok("保存して読み直せる。出典(厚生労働省)も返る");

  r = await callJson(api.onRequestGet, env, { cookie: bob.cookie });
  assert.equal(r.data.configured, false); t.ok("ほかのユーザーの設定は見えない");

  r = await callJson(api.onRequestPut, env, { method: "PUT", cookie: alice.cookie, body: { ...B, showNumbers: false, overrides: {} } });
  assert.equal(r.data.showNumbers, false); assert.equal(r.data.effective.protein.source, "standard");
  t.ok("数字を隠す設定と、自己設定値の取り消しが保存できる");

  sqlite.exec("DROP TABLE user_targets");
  r = await callJson(api.onRequestGet, env, { cookie: alice.cookie });
  assert.equal(r.status, 503); assert.equal(r.data.unavailable, true); t.ok("マイグレーション前(テーブルなし)は、落ちずに「準備中」(503)");
}

assert.deepEqual(guard.calls, [], "外部通信は1件も試みられていない");
guard.restore();
t.done();
