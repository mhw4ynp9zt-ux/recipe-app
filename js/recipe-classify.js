// 保存済みレシピの分類(系統・役割・主材料)の読み出しと、絞り込みの判定。DOM は触らない(通信もしない)。
// config.js の GENRES / ROLES / MAINS / NUTRIENT_METRICS を使う(読み込み順: config.js → recipe-classify.js)。

const UNCLASSIFIED = '未分類';
const MAIN_GRAMS_MIN = 40; // 肉・魚介・卵・大豆が主材料になる最低グラム数

// 食品番号の上2桁 = 食品群
const MAIN_GROUPS = [
  ['肉', ['11']],
  ['魚介', ['10']],
  ['卵', ['12']],
  ['大豆', ['04']],
];
const VEG_GROUPS = ['06', '08', '09'];
const STAPLE_GROUPS = ['01', '02'];

function inferMain(recipe) {
  const rows = recipe && Array.isArray(recipe.ingredientDetails) ? recipe.ingredientDetails : [];
  const byGroup = {};
  rows.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const m = r.match;
    if (!m || typeof m !== 'object' || m.manual) return;
    if (m.foodNo == null) return;
    if (typeof r.grams !== 'number' || !isFinite(r.grams) || r.grams <= 0) return;
    const g = String(m.foodNo).slice(0, 2);
    byGroup[g] = (byGroup[g] || 0) + r.grams;
  });
  const sum = (groups) => groups.reduce((s, g) => s + (byGroup[g] || 0), 0);

  let best = null;
  let bestGrams = 0;
  MAIN_GROUPS.forEach(([label, groups]) => {
    const g = sum(groups);
    if (g >= MAIN_GRAMS_MIN && g > bestGrams) { best = label; bestGrams = g; } // 同量は先(肉>魚介>卵>大豆)が残る
  });
  if (best) return best;

  const veg = sum(VEG_GROUPS);
  const staple = sum(STAPLE_GROUPS);
  if (veg <= 0 && staple <= 0) return 'その他';
  return staple > veg ? '穀類' : '野菜';
}

function effectiveMain(recipe) {
  const m = recipe && recipe.main;
  if (typeof m === 'string' && MAINS.indexOf(m) >= 0) return m;
  return inferMain(recipe);
}

function genreOf(recipe) {
  const v = recipe && recipe.genre;
  return typeof v === 'string' && GENRES.indexOf(v) >= 0 ? v : null;
}

function roleOf(recipe) {
  const v = recipe && recipe.role;
  return typeof v === 'string' && ROLES.indexOf(v) >= 0 ? v : null;
}

// ---- 絞り込み ----

function emptyFilters() {
  return { genre: null, role: null, main: null, ranges: {} };
}

function activeRanges(filters) {
  const out = [];
  const ranges = filters && filters.ranges ? filters.ranges : {};
  Object.keys(ranges).forEach((id) => {
    const r = ranges[id];
    if (!r) return;
    const min = typeof r.min === 'number' ? r.min : null;
    const max = typeof r.max === 'number' ? r.max : null;
    if (min !== null || max !== null) out.push({ id, min, max });
  });
  return out;
}

function hasActiveFilters(filters) {
  if (!filters) return false;
  return !!(filters.genre || filters.role || filters.main) || activeRanges(filters).length > 0;
}

function rangeConflict(filters) {
  return activeRanges(filters).some((r) => r.min !== null && r.max !== null && r.min > r.max);
}

// 入力欄の文字を数に直す。空・数字でない・負・無限大は null。全角数字は半角に直す。
function parseRangeValue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．。]/g, '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// 栄養値。recipe.nutrition[id] が有限の数ならそれ、無ければ recipe[id]。どちらも無ければ null(0 は値あり)。
function nutritionValue(recipe, id) {
  if (!recipe) return null;
  const n = recipe.nutrition;
  if (n && typeof n === 'object' && typeof n[id] === 'number' && isFinite(n[id])) return n[id];
  if (typeof recipe[id] === 'number' && isFinite(recipe[id])) return recipe[id];
  return null;
}

function genreKey(recipe) { return genreOf(recipe) || UNCLASSIFIED; }
function roleKey(recipe) { return roleOf(recipe) || UNCLASSIFIED; }

// 1件を判定する。skipAxis の軸の条件だけは無視する。戻り値: 'ok' | 'missing'(値なしで外れた) | 'no'
function judgeRecipe(recipe, filters, textMatch, skipAxis) {
  if (textMatch && !textMatch(recipe)) return 'no';
  if (skipAxis !== 'genre' && filters.genre && genreKey(recipe) !== filters.genre) return 'no';
  if (skipAxis !== 'role' && filters.role && roleKey(recipe) !== filters.role) return 'no';
  if (skipAxis !== 'main' && filters.main && effectiveMain(recipe) !== filters.main) return 'no';
  let missing = false;
  const ranges = activeRanges(filters);
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    const v = nutritionValue(recipe, r.id);
    if (v === null) { missing = true; continue; }
    if (r.min !== null && v < r.min) return 'no';
    if (r.max !== null && v > r.max) return 'no';
  }
  return missing ? 'missing' : 'ok';
}

function applyRecipeFilters(recipes, filters, textMatch) {
  const f = filters || emptyFilters();
  const matched = [];
  let missingExcluded = 0;
  (Array.isArray(recipes) ? recipes : []).forEach((recipe) => {
    const j = judgeRecipe(recipe, f, textMatch, null);
    if (j === 'ok') matched.push(recipe);
    else if (j === 'missing') missingExcluded++;
  });
  return { matched, missingExcluded };
}

// axis('genre' | 'role' | 'main')の自分の条件だけを外して件数を数える。
function facetCounts(recipes, filters, axis, textMatch) {
  const f = filters || emptyFilters();
  const counts = { all: 0 };
  const options = axis === 'genre' ? GENRES.concat([UNCLASSIFIED])
    : axis === 'role' ? ROLES.concat([UNCLASSIFIED])
    : MAINS;
  options.forEach((o) => { counts[o] = 0; });
  (Array.isArray(recipes) ? recipes : []).forEach((recipe) => {
    if (judgeRecipe(recipe, f, textMatch, axis) !== 'ok') return;
    counts.all++;
    const key = axis === 'genre' ? genreKey(recipe) : axis === 'role' ? roleKey(recipe) : effectiveMain(recipe);
    if (key in counts) counts[key]++;
  });
  return counts;
}
