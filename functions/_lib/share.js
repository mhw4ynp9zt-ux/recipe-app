// レシピの共有(リンク)と写真の付け外しに使う共通処理。AIも外部APIも呼ばない(外部通信をしない)。
import { json } from "./session.js";

export const TOKEN_RE = /^[a-f0-9]{32}$/;
export const MAX_SHARES_PER_USER = 300;
const METRICS = ["protein", "veg", "fat", "salt", "fiber", "carbs", "calories"];
const SNAPSHOT_MAX_CHARS = 200000;

export function newToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function newRecipeId() {
  return "r-" + crypto.randomUUID();
}

// 共有・取り込みで受け渡してよい項目だけを抜き出す(id・利用者・写真のURL・共有トークンなどは含めない)。
// 共有されたレシピは、見た人の画面にそのまま表示されるため、型も厳しく揃える:
//   文字列は文字列、数値は有限の数値だけを通す(HTMLや関数のようなものは入れない)。ここを通ったものだけが共有・取り込みの対象になる。
// 栄養値は、保存されているものをそのまま写す(成分表から計算済みの値)。
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function cleanDetail(d) {
  const o = { name: str(d.name, 100) };
  const g = num(d.grams);
  if (g !== null) o.grams = g;
  if (typeof d.amount === "string") o.amount = d.amount.slice(0, 40);
  if (typeof d.food === "string" && d.food) o.food = d.food.slice(0, 100);
  if (d.match && typeof d.match === "object") {
    const m = { label: str(d.match.label, 100) };
    if (num(d.match.foodNo) !== null) m.foodNo = d.match.foodNo;
    if (d.match.manual === true) m.manual = true;
    o.match = m;
  } else if (d.match === null) {
    o.match = null;
  }
  if (d.manual && typeof d.manual === "object" && !Array.isArray(d.manual)) {
    const manual = {};
    METRICS.forEach((k) => { const v = num(d.manual[k]); if (v !== null) manual[k] = v; });
    if (Object.keys(manual).length) o.manual = manual;
  }
  return o;
}

export function buildSnapshot(recipe) {
  const r = recipe && typeof recipe === "object" ? recipe : {};
  const out = {};
  out.name = str(r.name, 100);
  out.type = str(r.type, 40);
  ["genre", "role", "main"].forEach((k) => { if (typeof r[k] === "string" && r[k]) out[k] = r[k].slice(0, 40); });
  out.ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .filter((x) => typeof x === "string").slice(0, 60).map((x) => x.slice(0, 120));
  out.steps = (Array.isArray(r.steps) ? r.steps : [])
    .filter((x) => typeof x === "string").slice(0, 60).map((x) => x.slice(0, 600));
  if (Array.isArray(r.ingredientDetails)) {
    out.ingredientDetails = r.ingredientDetails.filter((d) => d && typeof d === "object" && !Array.isArray(d)).slice(0, 60).map(cleanDetail);
  }
  if (r.nutrition && typeof r.nutrition === "object" && !Array.isArray(r.nutrition)) {
    const n = {};
    METRICS.forEach((k) => { const v = num(r.nutrition[k]); if (v !== null) n[k] = v; });
    out.nutrition = n;
  }
  if (r.nutritionCheck && typeof r.nutritionCheck === "object" && !Array.isArray(r.nutritionCheck)) {
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 60).map((x) => x.slice(0, 100)) : []);
    out.nutritionCheck = { unmatched: list(r.nutritionCheck.unmatched), missing: list(r.nutritionCheck.missing) };
  }
  METRICS.forEach((m) => { const v = num(r[m]); if (v !== null) out[m] = v; });
  if (typeof r.sourceUrl === "string" && /^https?:\/\/[^\s<>"']+$/i.test(r.sourceUrl)) out.sourceUrl = r.sourceUrl.slice(0, 500);
  const text = JSON.stringify(out);
  if (text.length > SNAPSHOT_MAX_CHARS) throw new Error("レシピのデータが大きすぎます");
  return out;
}

// 保存済みレシピ(recipes.data)に、写真のURLと共有トークンを付ける(保存はしない。表示のための付け足し)
export function annotateRecipe(recipe, photos, shares) {
  const out = { ...recipe };
  delete out.photoData;
  const ts = photos && photos[recipe.id];
  if (ts) out.photoUrl = `/api/recipes/${encodeURIComponent(recipe.id)}/photo?v=${ts}`;
  else delete out.photoUrl;
  const token = shares && shares[recipe.id];
  if (token) out.shareToken = token;
  else delete out.shareToken;
  return out;
}

// 画面表示用の付け足しを、保存する前に取り除く
export function stripAnnotations(recipe) {
  const out = { ...recipe };
  delete out.photoUrl;
  delete out.photoData;
  delete out.shareToken;
  return out;
}

// 写真・共有のテーブルがまだ作られていない(マイグレーション未適用)ときの案内
export function isMissingTable(err) {
  return /no such table/i.test(String((err && err.message) || err));
}

export const MIGRATION_PENDING = "写真・共有の機能に必要なデータベースの更新(マイグレーション)がまだ適用されていません";

// 写真・共有のAPIで共通に使う:テーブルが無いときは503の案内を返す
export async function withMediaTables(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isMissingTable(err)) return json({ error: MIGRATION_PENDING }, { status: 503 });
    throw err;
  }
}

export function publicOrigin(request, env) {
  return env.ORIGIN || new URL(request.url).origin;
}
