// 「今日のバランス」と「週の振り返り」。AIは呼ばない。計算はすべてコード(保存済みの栄養値の足し算と比較)。
// 文言は kondate-messages.js にまとめてある。数字の差(あと◯g)は、責める見え方になるので返さない(ゲージの位置だけ返す)。

import * as M from "./kondate-messages.js";
import { addDays } from "./meals.js";

const GAUGE_METRICS = ["calories", "protein", "veg", "fat", "salt", "fiber", "carbs", "carbohydrate"];
const AIM_BAND = 0.1; // 範囲のない「目安」は ±10% を「ちょうど良い」とする
const round1 = (v) => Math.round(v * 10) / 10;

// 1つの指標の状態。status: ok / below / above / none
export function gaugeOf(id, total, target) {
  if (!target) return { id, status: "none", total, target: null };
  const v = target.value;
  const kind = target.kind;
  let lo = null, hi = null;
  if (kind === "min") { lo = v; hi = target.hi ?? null; }
  else if (kind === "max") { hi = v; }
  else if (target.lo != null && target.hi != null) { lo = target.lo; hi = target.hi; }
  else { lo = v * (1 - AIM_BAND); hi = v * (1 + AIM_BAND); }
  let status = "ok";
  if (lo != null && total < lo) status = "below";
  else if (hi != null && total > hi) status = "above";
  const scaleMax = Math.max(hi ?? v, v) * 1.5;
  return {
    id, status, total: round1(total), target: { value: v, kind, lo, hi, unit: target.unit, source: target.source },
    // ゲージ用の位置(0〜1)。目安の線の位置も返す
    fill: Math.min(1, total / scaleMax), mark: Math.min(1, v / scaleMax),
    text: M.STATUS_TEXT[status],
  };
}

export function buildBalance(totals, effective, { hasMeals, approx, showNumbers = true }) {
  const gauges = GAUGE_METRICS.filter((id) => effective[id]).map((id) => gaugeOf(id, totals[id] || 0, effective[id]));
  return { hasMeals, approx, approxText: approx ? M.APPROX_TEXT : null, showNumbers, gauges, help: M.GAUGE_HELP, empty: hasMeals ? null : M.NO_RECORD_TEXT };
}

// 次の食事のおすすめ。まだ伸ばせる指標を、残りの余裕の範囲で満たせる保存済みレシピを最大3件。
// 上限のある指標(カロリー・塩分)を超えるレシピは選ばない。何も当てはまらないときは「今日はここまでで十分です」。
export function suggestNext(gauges, recipes, { limit = 3 } = {}) {
  const need = gauges.filter((g) => g.status === "below" && ["protein", "fiber", "veg"].includes(g.id));
  const room = {};
  for (const g of gauges) {
    if (!g.target) continue;
    if (g.id === "calories" && g.target.hi != null) room.calories = g.target.hi - g.total;
    if (g.id === "salt" && g.target.hi != null) room.salt = g.target.hi - g.total;
  }
  const scored = [];
  for (const r of recipes) {
    const n = r.nutrition && typeof r.nutrition === "object" ? r.nutrition : r;
    if (typeof n.calories !== "number") continue;
    if (room.calories !== undefined && n.calories > room.calories) continue;
    if (room.salt !== undefined && typeof n.salt === "number" && n.salt > room.salt) continue;
    let score = 0;
    const helps = [];
    for (const g of need) {
      const have = n[g.id];
      if (typeof have !== "number" || have <= 0) continue;
      const remaining = Math.max(0.0001, g.target.lo - g.total);
      const part = Math.min(have, remaining) / remaining;
      if (part >= 0.2) { score += part; helps.push(g.id); }
    }
    if (score > 0) scored.push({ recipeId: r.id, name: r.name, helps, score: round1(score), calories: n.calories });
  }
  scored.sort((a, b) => b.score - a.score || a.calories - b.calories);
  const picks = scored.slice(0, limit);
  return { title: M.nextMealTitle(picks.length > 0), picks };
}

// ==== 週の振り返り ====
const REVIEW_IDS = ["protein", "fiber", "veg", "salt", "fat"];
const HINT_ORDER = ["fiber", "protein", "veg"]; // 増やすヒント(足せる方向)を先に
const MAX_HINT_BELOW = 0.85;   // 平均が目安の下限の85%未満なら、ヒントの候補
const MIN_DAYS_FOR_REVIEW = 3; // 記録のある日がこれ未満なら、傾向は出さない

function dayTotals(meals) {
  const by = new Map();
  for (const m of meals) {
    const t = by.get(m.day) || {};
    for (const [k, v] of Object.entries(m.nutrition)) t[k] = (t[k] || 0) + v;
    by.set(m.day, t);
  }
  return by;
}
function averageOf(byDay) {
  const days = [...byDay.values()];
  const avg = {};
  if (!days.length) return avg;
  for (const k of new Set(days.flatMap((d) => Object.keys(d)))) avg[k] = days.reduce((s, d) => s + (d[k] || 0), 0) / days.length;
  return avg;
}

// weekMeals: その週(月〜日)の記録 / fourWeekMeals: 直近4週の記録(今週を含む)
export function buildReview(weekStart, weekMeals, fourWeekMeals, effective, { showNumbers = true } = {}) {
  const byDay = dayTotals(weekMeals);
  const recordedDays = byDay.size;
  const out = { weekStart, weekEnd: addDays(weekStart, 6), title: M.REVIEW_TITLE, recordedDays, showNumbers, positives: [], hint: null, average: null, fourWeek: null, notes: [M.REVIEW_NOTE, M.RECORD_DAYS_NOTE] };
  if (recordedDays < MIN_DAYS_FOR_REVIEW) { out.few = M.REVIEW_FEW; if (recordedDays) out.positives.push(M.positive.recorded(recordedDays)); return out; }

  const avg = averageOf(byDay);
  out.average = {};
  const ok = [];
  const hints = [];
  for (const id of REVIEW_IDS) {
    const target = effective[id];
    if (!target) continue;
    const g = gaugeOf(id, avg[id] || 0, target);
    out.average[id] = { total: g.total, status: g.status, target: g.target };
    if (g.status === "ok") ok.push(id);
    else if (g.status === "below" && HINT_ORDER.includes(id) && g.target.lo > 0 && g.total / g.target.lo < MAX_HINT_BELOW) hints.push({ id, ratio: g.total / g.target.lo });
    else if (g.status === "above" && (id === "salt" || id === "fat")) hints.push({ id, ratio: 99 });
  }
  ok.slice(0, 3).forEach((id) => out.positives.push(M.positive.metricOk(id)));
  const vegDays = [...byDay.values()].filter((d) => (d.veg || 0) > 0).length;
  if (vegDays >= 3) out.positives.push(M.positive.vegDays(vegDays));
  out.positives.push(M.positive.recorded(recordedDays));
  out.summary = ok.length >= 3 ? M.REVIEW_AVERAGE_OK : M.REVIEW_AVERAGE_MIXED;

  // ヒントは1つだけ。増やす方向(食物繊維→たんぱく質→野菜)を先に、無ければ塩分・脂質
  const pickBelow = hints.filter((h) => HINT_ORDER.includes(h.id)).sort((a, b) => a.ratio - b.ratio)[0];
  const pick = pickBelow || hints.find((h) => h.id === "salt") || hints.find((h) => h.id === "fat");
  if (pick) out.hint = { id: pick.id, text: M.hint[pick.id], action: HINT_ORDER.includes(pick.id) ? { type: "favor", metric: pick.id } : null };

  // 直近4週の平均(記録のある日だけで平均する。記録のない日は評価に入れない)
  const fourByDay = dayTotals(fourWeekMeals);
  if (fourByDay.size >= 7) {
    const a4 = averageOf(fourByDay);
    out.fourWeek = { days: fourByDay.size, average: {} };
    for (const id of REVIEW_IDS) if (effective[id]) { const g = gaugeOf(id, a4[id] || 0, effective[id]); out.fourWeek.average[id] = { total: g.total, status: g.status }; }
  }
  return out;
}
