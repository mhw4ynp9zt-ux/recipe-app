// 「目標の目安」(1日の栄養の目標)。AIは呼ばない。
//   ・parseTargetsRequest … 画面から受け取った入力の検証・整形
//   ・buildTargets        … 入力から、基準表の目安(standard)と、実際に使う目標(effective)を作る
//   ・loadTargets / saveTargets … D1(user_targets テーブル)への読み書き
//
// 使う値の決まり
//   1. 基準表(functions/_lib/dri2025.js)の値を引く。性別・年齢・身体活動レベルの3つで決まる(任意で身長・体重)。
//   2. ユーザーが項目ごとに自分で入力した値(overrides)があれば、そちらを優先する(「自己設定値」と表示する)。
//   3. 妊娠中・授乳中・18歳未満・通院治療中に当てはまる(special)ときは、基準表の値は使わず、手入力の値だけを使う。
//
// 安全のための歯止め(アプリ独自の設定。基準表の値ではない。公開前に確認すること)
//   ・エネルギーの目標は ENERGY_FLOOR_KCAL 未満にできない(自動でも手入力でも)。
//   ・BMIが「目標とするBMI」の範囲を外れているとき、同じ向きの調整は選べない(低い人は「減らす」、高い人は「増やす」)。
//   ・「減らす」「増やす」は、エネルギーを PURPOSE_ADJUST(±10%)だけ動かす。それ以上の調整はできない。
//   ・基準より大きく低い手入力には、止めずに「相談のおすすめ」を表示する。

import { computeStandard, bmiInfo, ageBandOf, MIN_AGE, MAX_AGE, SEXES, ACTIVITY_LEVELS, DRI_SOURCE } from "./dri2025.js";
import * as M from "./kondate-messages.js";

export const ENERGY_FLOOR_KCAL = 1200;
export const PURPOSES = [
  { id: "maintain", label: "維持" },
  { id: "lose", label: "減らす" },
  { id: "gain", label: "増やす" },
];
export const PURPOSE_ADJUST = { maintain: 0, lose: -0.1, gain: 0.1 };
export const LOW_ENERGY_RATIO = 0.85; // 基準のエネルギーのこの割合より低い手入力には、相談のおすすめを出す

// 手入力できる指標(config.js の NUTRIENT_METRICS と同じ id)。max は入力の上限、kind は目標としての向き
export const TARGET_METRICS = {
  calories: { max: 6000, kind: "aim", digits: 0 },
  protein: { max: 400, kind: "min", digits: 1 },
  veg: { max: 3000, kind: "min", digits: 0 },
  fat: { max: 300, kind: "aim", digits: 1 },
  salt: { max: 30, kind: "max", digits: 1 },
  fiber: { max: 100, kind: "min", digits: 1 },
  carbs: { max: 1000, kind: "aim", digits: 1 },
  carbohydrate: { max: 1000, kind: "aim", digits: 1 },
};
export const TARGET_METRIC_IDS = Object.keys(TARGET_METRICS);

const SEX_IDS = SEXES.map((s) => s.id);
const ACTIVITY_IDS = ACTIVITY_LEVELS.map((a) => a.id);
const PURPOSE_IDS = PURPOSES.map((p) => p.id);
const round = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };

export const DEFAULT_TARGETS = Object.freeze({
  profile: { sex: null, age: null, activity: "normal", purpose: "maintain", heightCm: null, weightKg: null, special: false },
  overrides: {},
  showNumbers: true,
});

// 成功: { value: { profile, overrides, showNumbers } } / 失敗: { error }
export function parseTargetsRequest(body) {
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };
  const p = body.profile && typeof body.profile === "object" ? body.profile : {};
  const special = p.special === true;
  const profile = { sex: null, age: null, activity: "normal", purpose: "maintain", heightCm: null, weightKg: null, special };

  if (!special) {
    if (!SEX_IDS.includes(p.sex)) return { error: "性別を選んでください" };
    const age = Number(p.age);
    if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) return { error: `年齢は${MIN_AGE}〜${MAX_AGE}歳で入力してください(18歳未満の方は「当てはまる」を選んでください)` };
    if (!ACTIVITY_IDS.includes(p.activity)) return { error: "身体活動レベルを選んでください" };
    profile.sex = p.sex; profile.age = age; profile.activity = p.activity;
  }
  if (p.purpose !== undefined && p.purpose !== null) {
    if (!PURPOSE_IDS.includes(p.purpose)) return { error: "目的の指定が不正です" };
    profile.purpose = p.purpose;
  }
  if (special) profile.purpose = "maintain"; // 基準表を使わないので、調整は意味を持たない

  for (const [key, label, lo, hi] of [["heightCm", "身長", 100, 250], ["weightKg", "体重", 25, 300]]) {
    const v = p[key];
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: `${label}は${lo}〜${hi}で入力してください` };
    profile[key] = round(n, 1);
  }
  if ((profile.heightCm === null) !== (profile.weightKg === null)) return { error: "身長と体重は、両方入力するか、両方空にしてください" };

  const overrides = {};
  const raw = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
  for (const id of Object.keys(raw)) {
    if (!TARGET_METRICS[id]) return { error: "目標の項目が不正です" };
    const v = raw[id];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > TARGET_METRICS[id].max) return { error: `${M.metricLabel(id)}の目標値が不正です(0より大きく${TARGET_METRICS[id].max}以下で入力してください)` };
    overrides[id] = round(n, TARGET_METRICS[id].digits);
  }
  if (body.showNumbers !== undefined && typeof body.showNumbers !== "boolean") return { error: "数字の表示の指定が不正です" };
  const showNumbers = body.showNumbers === undefined ? true : body.showNumbers;
  return { value: { profile, overrides, showNumbers } };
}

// 保存済みのデータ(壊れていても落ちないように、既定値で補う)
export function normalizeStored(data) {
  const out = JSON.parse(JSON.stringify(DEFAULT_TARGETS));
  if (!data || typeof data !== "object") return out;
  const r = parseTargetsRequest({
    profile: { ...out.profile, ...(data.profile || {}) },
    overrides: data.overrides, showNumbers: data.showNumbers,
  });
  return r.value || out;
}

// 入力から目標を作る。成功: { ok: true, ...view } / 失敗: { ok: false, error }
export function buildTargets(input) {
  const { profile, overrides, showNumbers } = input;
  const notices = [];
  const view = { profile, overrides, showNumbers, mode: profile.special ? "manual" : "standard", standard: null, effective: {}, notices, bmi: null, source: DRI_SOURCE };

  let std = null;
  if (!profile.special) {
    const base = computeStandard(profile);
    if (!base.ok) {
      return { ok: false, error: base.reason === "no-value" ? "この年齢・活動レベルの基準値は公表されていません。別の活動レベルを選ぶか、「当てはまる」を選んで手入力してください" : "入力を確認してください" };
    }
    // 体重の調整(目的)。BMIが目標とする範囲を外れているときは、同じ向きの調整を選べない
    const info = bmiInfo(profile.age, profile.heightCm, profile.weightKg);
    view.bmi = info;
    if (info && info.position === "below" && profile.purpose === "lose") return { ok: false, error: M.errorLoseBelowBmi };
    if (info && info.position === "above" && profile.purpose === "gain") return { ok: false, error: M.errorGainAboveBmi };
    if (info && info.position === "below") notices.push(M.noticeBmiBelow(info.range[0], info.range[1]));
    if (info && info.position === "above") notices.push(M.noticeBmiAbove(info.range[0], info.range[1]));

    const adjust = PURPOSE_ADJUST[profile.purpose] || 0;
    let energy = base.requirement;
    if (adjust !== 0) {
      energy = Math.round((base.requirement * (1 + adjust)) / 10) * 10;
      if (energy < ENERGY_FLOOR_KCAL) return { ok: false, error: M.errorEnergyFloor(ENERGY_FLOOR_KCAL) };
      notices.push(M.PURPOSE_NOTE);
    }
    std = computeStandard(profile, { energyAim: energy });
    view.standard = { band: std.band, requirement: base.requirement, items: std.items };
  } else {
    notices.push(M.SPECIAL_NOTE);
  }

  // 実際に使う目標。自分で入力した値があればそちらを優先し、範囲(lo・hi)は持たない
  for (const id of TARGET_METRIC_IDS) {
    const spec = TARGET_METRICS[id];
    if (overrides[id] !== undefined) {
      view.effective[id] = { value: overrides[id], kind: spec.kind, unit: id === "calories" ? "kcal" : "g", source: "self" };
    } else if (std && std.items[id]) {
      const s = std.items[id];
      view.effective[id] = { ...s, source: "standard" };
    }
  }

  const cal = view.effective.calories;
  if (cal && cal.value < ENERGY_FLOOR_KCAL) return { ok: false, error: M.errorEnergyFloor(ENERGY_FLOOR_KCAL) };
  if (cal && cal.source === "self") {
    notices.push(M.SELF_SET_NOTE);
    if (view.standard && cal.value < view.standard.requirement * LOW_ENERGY_RATIO) notices.push(M.noticeLowEnergy);
  } else if (Object.values(view.effective).some((e) => e.source === "self")) {
    notices.push(M.SELF_SET_NOTE);
  }
  return { ok: true, ...view };
}

// ==== D1 ====
const isMissingTable = (e) => /no such table/i.test(String((e && e.message) || e));

export async function loadTargets(env, userId) {
  let row;
  try {
    row = await env.DB.prepare("SELECT data FROM user_targets WHERE user_id = ?").bind(userId).first();
  } catch (e) {
    if (isMissingTable(e)) return { ...JSON.parse(JSON.stringify(DEFAULT_TARGETS)), missingTable: true };
    throw e;
  }
  if (!row) return JSON.parse(JSON.stringify(DEFAULT_TARGETS));
  let data = null;
  try { data = JSON.parse(row.data); } catch (e) { /* 壊れていれば既定値 */ }
  return normalizeStored(data);
}

export async function saveTargets(env, userId, value, now = Date.now()) {
  await env.DB.prepare(
    `INSERT INTO user_targets (user_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(userId, JSON.stringify(value), now).run();
}

// 保存済みの入力から、いま使う目標を作る(基準表を引けない入力が残っていても落とさず、目標なしとして扱う)
export async function loadEffectiveTargets(env, userId) {
  const stored = await loadTargets(env, userId);
  const built = stored.missingTable ? { ok: false } : buildTargets(stored);
  return { stored, built: built.ok ? built : null };
}

export { ageBandOf };
