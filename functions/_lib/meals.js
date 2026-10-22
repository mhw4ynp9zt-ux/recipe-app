// 食事の記録(「今日」に足していく)。AIは呼ばない。
//   ・保存済みレシピを「◯人前(0.5〜3)」で記録 … レシピに保存済みの栄養値を倍率で掛けるだけ
//   ・食材のグラムを入れて記録 … 成分表(attachNutrition)でサーバー側が計算する
//   ・かんたん入力(料理名+おおよその値) … 値は「おおよそ」として記録する
// 記録は約5週間ぶんだけ持ち、それより古いものは記録のたびに消す(長期の履歴画面は作らない方針)。

import { attachNutrition, METRIC_IDS } from "./nutrition.js";

export const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
export const SLOT_LABEL = { breakfast: "朝", lunch: "昼", dinner: "夜", snack: "間食" };
export const KEEP_DAYS = 35;
export const MAX_PER_DAY = 20;
export const PORTIONS = [0.5, 1, 1.5, 2, 3];
const QUICK_MAX = { calories: 5000, protein: 300, veg: 1500, fat: 300, salt: 30, fiber: 100, carbs: 800, carbohydrate: 800 };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const round = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };
const DIGITS = { calories: 0, veg: 0 };

// 日本時間の「今日」(YYYY-MM-DD)
export function todayJst(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
export function isValidDay(s) {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function addDays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 週の始まり(月曜日)
export function weekStartOf(day) {
  const dow = new Date(day + "T00:00:00Z").getUTCDay(); // 0=日
  return addDays(day, -((dow + 6) % 7));
}

function cleanNutrition(src) {
  const out = {};
  if (!src || typeof src !== "object") return out;
  for (const id of METRIC_IDS) {
    const v = src[id];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[id] = round(v, DIGITS[id] ?? 1);
  }
  return out;
}

// 成功: { value } / 失敗: { error }
export function parseMealRequest(body, now = Date.now()) {
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };
  if (!isValidDay(body.day)) return { error: "日付が不正です" };
  const today = todayJst(now);
  if (body.day > addDays(today, 1)) return { error: "先の日付には記録できません" };
  if (body.day < addDays(today, -KEEP_DAYS)) return { error: "古い日付には記録できません" };
  if (!SLOTS.includes(body.slot)) return { error: "食事の区分が不正です" };
  const base = { day: body.day, slot: body.slot };

  if (typeof body.recipeId === "string" && body.recipeId) {
    const p = body.portion === undefined ? 1 : Number(body.portion);
    if (!PORTIONS.includes(p)) return { error: "量の指定が不正です" };
    return { value: { ...base, kind: "recipe", recipeId: body.recipeId.slice(0, 80), portion: p } };
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return { error: "料理名を入力してください" };

  if (Array.isArray(body.ingredients)) {
    const list = body.ingredients.slice(0, 20).map((i) => ({
      name: typeof (i && i.name) === "string" ? i.name.trim().slice(0, 40) : "",
      grams: Number(i && i.grams),
    }));
    if (!list.length || list.some((i) => !i.name || !Number.isFinite(i.grams) || i.grams <= 0 || i.grams > 3000)) {
      return { error: "食材の名前とグラム数(1〜3000)を入力してください" };
    }
    return { value: { ...base, kind: "ingredients", name, ingredients: list, via: body.via === "photo" ? "photo" : null } };
  }
  const n = body.nutrition && typeof body.nutrition === "object" ? body.nutrition : null;
  if (!n) return { error: "栄養の値か食材を入力してください" };
  const nutrition = {};
  for (const id of Object.keys(n)) {
    if (!QUICK_MAX[id]) return { error: "栄養の項目が不正です" };
    if (n[id] === null || n[id] === "" || n[id] === undefined) continue;
    const v = Number(n[id]);
    if (!Number.isFinite(v) || v < 0 || v > QUICK_MAX[id]) return { error: "栄養の値が不正です" };
    nutrition[id] = round(v, DIGITS[id] ?? 1);
  }
  if (!Object.keys(nutrition).length) return { error: "栄養の値を1つ以上入力してください" };
  return { value: { ...base, kind: "quick", name, nutrition } };
}

export function scaleNutrition(n, portion) {
  const out = {};
  for (const [k, v] of Object.entries(cleanNutrition(n))) out[k] = round(v * portion, DIGITS[k] ?? 1);
  return out;
}

// 記録の中身(name, nutrition, approx, source, recipe_id)を作る。作れないとき { error, status }
export async function resolveMeal(env, userId, v) {
  if (v.kind === "recipe") {
    const row = await env.DB.prepare("SELECT data FROM recipes WHERE user_id = ? AND id = ?").bind(userId, v.recipeId).first();
    if (!row) return { error: "レシピが見つかりません", status: 404 };
    let r; try { r = JSON.parse(row.data); } catch (e) { return { error: "レシピが読み取れません", status: 422 }; }
    const base = r.nutrition && typeof r.nutrition === "object" ? r.nutrition : r;
    const nutrition = scaleNutrition(base, v.portion);
    if (!Object.keys(nutrition).length) return { error: "このレシピには栄養の値がありません", status: 422 };
    const approx = !!(r.nutritionCheck && ((r.nutritionCheck.unmatched || []).length || (r.nutritionCheck.missing || []).length));
    return { name: String(r.name || "レシピ").slice(0, 60) + (v.portion === 1 ? "" : `(${v.portion}人前)`), nutrition, approx, source: "recipe", recipeId: v.recipeId };
  }
  if (v.kind === "ingredients") {
    const dish = { name: v.name, ingredientDetails: v.ingredients.map((i) => ({ name: i.name, amount: `${i.grams}g`, grams: i.grams, food: i.name })) };
    await attachNutrition(env, [dish], []);
    const check = dish.nutritionCheck || { unmatched: [], missing: [] };
    if (check.unmatched.length === v.ingredients.length) return { error: "成分表で見つかった食材がありませんでした。料理名と値を入力する方法をお試しください", status: 422 };
    return { name: v.name, nutrition: cleanNutrition(dish.nutrition), approx: v.via === "photo" || check.unmatched.length > 0 || check.missing.length > 0, source: v.via === "photo" ? "photo" : "ingredients", recipeId: null };
  }
  return { name: v.name, nutrition: v.nutrition, approx: true, source: "quick", recipeId: null };
}

const isMissingTable = (e) => /no such table/i.test(String((e && e.message) || e));
export { isMissingTable };

export async function addMeal(env, userId, v, resolved, now = Date.now()) {
  const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM meal_logs WHERE user_id = ? AND day = ?").bind(userId, v.day).first();
  if (c && c.n >= MAX_PER_DAY) return { error: `1日に記録できるのは${MAX_PER_DAY}件までです`, status: 400 };
  const id = "m-" + crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO meal_logs (id, user_id, day, slot, name, nutrition, approx, source, recipe_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, userId, v.day, v.slot, resolved.name, JSON.stringify(resolved.nutrition), resolved.approx ? 1 : 0, resolved.source, resolved.recipeId, now).run();
  // 古い記録を消す
  await env.DB.prepare("DELETE FROM meal_logs WHERE user_id = ? AND day < ?").bind(userId, addDays(todayJst(now), -KEEP_DAYS)).run();
  return { id };
}

export async function listMeals(env, userId, from, to) {
  const { results } = await env.DB.prepare(
    "SELECT id, day, slot, name, nutrition, approx, source, recipe_id FROM meal_logs WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day, created_at"
  ).bind(userId, from, to).all();
  return results.map((r) => {
    let n = {}; try { n = JSON.parse(r.nutrition) || {}; } catch (e) { /* 壊れた値は空 */ }
    return { id: r.id, day: r.day, slot: r.slot, name: r.name, nutrition: n, approx: !!r.approx, source: r.source, recipeId: r.recipe_id };
  });
}

export async function deleteMeal(env, userId, id) {
  const r = await env.DB.prepare("DELETE FROM meal_logs WHERE user_id = ? AND id = ?").bind(userId, id).run();
  return r.meta.changes > 0;
}

export function sumNutrition(meals) {
  const t = {};
  let approx = false;
  for (const m of meals) {
    if (m.approx) approx = true;
    for (const [k, v] of Object.entries(m.nutrition)) t[k] = (t[k] || 0) + v;
  }
  for (const k of Object.keys(t)) t[k] = round(t[k], DIGITS[k] ?? 1);
  return { totals: t, approx };
}
