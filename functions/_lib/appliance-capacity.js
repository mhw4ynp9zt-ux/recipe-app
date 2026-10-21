// 調理家電の「容量」を、レシピが守れているかをコードで調べる(AIは呼ばない。計算と文字列の照合だけ)。
//
// 使いどころ
//   ・設定タブに登録された家電の spec.capacity(例: "600ml(300ml〜Maxライン)")の「最大」を上限として読み取る(固定の数値は持たない)
//   ・AIが返した各品のうち、その家電を使う品の材料の合計(水・牛乳・豆乳などの液体を含む)が上限を超えていないかを調べる
//   ・超えていたら、recipe-job.js が「作り直し」の理由にする(作り直しの回数・AI呼び出しの上限は変わらない=費用の上限は増えない)
//
// 材料の量の数え方(簡易)
//   ・amount に ml / cc / L / カップ があれば、その量(ml)。なければ grams をそのまま ml とみなす(1g=1ml)
//   ・水・お湯は grams が 0 なので、amount の "水 300ml" のような表記から数える
//   ・「容量を超える」ことだけを見つける目的なので、固形の食材は少なめに数える(=実際より容量に余裕があるように見える)側。誤検出は少ない

const UNIT = "(ml|cc|㏄|リットル|ℓ|l)";
const NUM = "(\\d+(?:\\.\\d+)?)";
const ML_RE = new RegExp(NUM + "\\s*" + UNIT, "gi");
const CUP_RE = new RegExp("(?:カップ\\s*" + NUM + "|" + NUM + "\\s*カップ)", "i");
const CUP_ML = 200; // 日本の計量カップ(1カップ=200ml)

const norm = (s) => String(s == null ? "" : s).normalize("NFKC");

function toMl(value, unit) {
  const u = unit.toLowerCase();
  return u === "l" || u === "ℓ" || u === "リットル" ? value * 1000 : value;
}

// 容量の文字列から、最大の容量(ml)を読み取る。読めなければ null
//   例: "600ml(300ml〜Maxライン)" → 600 / "1.5L" → 1500 / "Maxラインまで" → null
export function parseCapacityMl(text) {
  const t = norm(text);
  let max = null;
  for (const m of t.matchAll(ML_RE)) {
    const ml = toMl(Number(m[1]), m[2]);
    if (Number.isFinite(ml) && ml > 0 && (max === null || ml > max)) max = ml;
  }
  return max;
}

// 1つの材料の量(ml相当)。amount の ml/cc/L/カップ を優先し、なければ grams
function ingredientMl(ing) {
  const amount = norm(ing && ing.amount);
  let ml = null;
  for (const m of amount.matchAll(ML_RE)) {
    const v = toMl(Number(m[1]), m[2]);
    if (Number.isFinite(v)) ml = (ml || 0) + v;
  }
  if (ml !== null) return ml;
  const cup = amount.match(CUP_RE);
  if (cup) return Number(cup[1] || cup[2]) * CUP_ML;
  const g = Number(ing && ing.grams);
  return Number.isFinite(g) && g > 0 ? g : 0;
}

// 1品の材料ごとの量(ml相当)。量の大きい順。作り直しの依頼文で、どれを減らすかを示すために使う
export function ingredientVolumes(dish) {
  const list = dish && Array.isArray(dish.ingredientDetails) ? dish.ingredientDetails : [];
  return list.map((i) => ({ name: String((i && i.name) || ""), ml: Math.round(ingredientMl(i)) })).filter((x) => x.ml > 0).sort((a, b) => b.ml - a.ml);
}

// 1品の材料の合計(ml相当)
export function dishVolumeMl(dish) {
  const list = dish && Array.isArray(dish.ingredientDetails) ? dish.ingredientDetails : [];
  return list.reduce((s, ing) => s + ingredientMl(ing), 0);
}

const squash = (s) => norm(s).toLowerCase().replace(/[\s・･\-ー_()()「」]/g, "");

// その品が、その家電を使うか。次のどちらかなら「使う」とみなす(AIの申告の書き間違い・null で、確認をすり抜けないため)
//   ・AIが dish.appliance(使う家電の名前)に、その家電の名前を書いている
//   ・品名・手順に、その家電の名前(の主な単語)が書かれている
function usesAppliance(dish, appliance) {
  const name = squash(appliance.name);
  if (!name) return false;
  const declared = squash(dish && dish.appliance);
  if (declared && (declared.includes(name) || name.includes(declared))) return true;
  const text = squash([dish && dish.name].concat((dish && dish.steps) || []).join(" "));
  if (text.includes(name)) return true;
  const tokens = norm(appliance.name).split(/[\s・･]+/).map(squash).filter((t) => t.length >= 3);
  return tokens.some((t) => text.includes(t));
}

// 容量を超えている品を探す。返り値: [{ dishIndex, dish, appliance, volumeMl, maxMl }](無ければ空配列)
//   appliances は appliancesOf() の形([{ name, spec: { capacity, ... } }])。容量が読み取れない家電は調べない
export function findCapacityHits(dishes, appliances) {
  const out = [];
  if (!Array.isArray(dishes) || !Array.isArray(appliances)) return out;
  for (const a of appliances) {
    const maxMl = a && a.spec ? parseCapacityMl(a.spec.capacity) : null;
    if (!maxMl) continue;
    dishes.forEach((dish, i) => {
      if (!usesAppliance(dish, a)) return;
      const volumeMl = Math.round(dishVolumeMl(dish));
      if (volumeMl > maxMl) out.push({ dishIndex: i, dish: String((dish && dish.name) || ""), appliance: a.name, volumeMl, maxMl, items: ingredientVolumes(dish).slice(0, 6) });
    });
  }
  return out;
}

// プロンプト用: 容量が読み取れる家電の { name, maxMl } の一覧
export function capacityLimits(appliances) {
  const out = [];
  for (const a of Array.isArray(appliances) ? appliances : []) {
    const maxMl = a && a.spec ? parseCapacityMl(a.spec.capacity) : null;
    if (maxMl) out.push({ name: a.name, maxMl });
  }
  return out;
}
