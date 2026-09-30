// レシピ作成のリクエスト検証・プロンプト組み立て・AIの返答の検証(すべてサーバー側)。
// ブラウザからは「食材・雰囲気・品数・栄養目標」だけを受け取り、プロンプトはここで組み立てます。
// (自由なプロンプトを受け付けると、AIの中継として悪用されてしまうため)
//
// 注意: METRICS は js/config.js の NUTRIENT_METRICS(id・label・unit)と同じ内容に保ってください。
// max は入力できる目標値の上限、decimals は表示する小数点以下の桁数です。
//
// 栄養量はAIに答えさせず、AIが書いた材料(食材名とg数)をもとに、サーバーで
// 食品成分表(nutrition-db.js)の値から計算します。AIの暗算による誤差をなくすためです。

import { FOODS } from "./nutrition-db.js";

const METRICS = {
  protein:  { label: "たんぱく質", unit: "g",    max: 500,  decimals: 0 },
  veg:      { label: "野菜",       unit: "g",    max: 3000, decimals: 0 },
  fat:      { label: "脂質",       unit: "g",    max: 500,  decimals: 0 },
  salt:     { label: "塩分",       unit: "g",    max: 50,   decimals: 1 },
  fiber:    { label: "食物繊維",   unit: "g",    max: 200,  decimals: 1 },
  carbs:    { label: "糖質",       unit: "g",    max: 1000, decimals: 0 },
  calories: { label: "カロリー",   unit: "kcal", max: 6000, decimals: 0 },
};

const ALLOWED_COUNTS = [1, 2, 3];
const MAX_INGREDIENTS_LEN = 500;
const MAX_MOOD_LEN = 300;

function cleanText(value) {
  // 改行などの制御文字は空白にしてプロンプトを崩されないようにする
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

// 成功: { value: { ingredients, mood, count, metrics: [{id,label,unit,target}] } } / 失敗: { error }
function parseCreateRequest(body) {
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };

  const ingredients = typeof body.ingredients === "string" ? cleanText(body.ingredients) : "";
  if (!ingredients) return { error: "食材を1つ以上入力してください" };
  if (ingredients.length > MAX_INGREDIENTS_LEN) {
    return { error: `食材の入力が長すぎます(${MAX_INGREDIENTS_LEN}文字まで)` };
  }

  const mood = typeof body.mood === "string" ? cleanText(body.mood) : "";
  if (mood.length > MAX_MOOD_LEN) {
    return { error: `雰囲気・ジャンルの入力が長すぎます(${MAX_MOOD_LEN}文字まで)` };
  }

  const count = Number(body.count);
  if (!ALLOWED_COUNTS.includes(count)) return { error: "品数が不正です" };

  const targets = body.targets && typeof body.targets === "object" ? body.targets : {};
  const metrics = [];
  for (const id of Object.keys(METRICS)) {
    if (targets[id] === undefined) continue;
    const v = Number(targets[id]);
    if (!Number.isInteger(v) || v < 1 || v > METRICS[id].max) {
      return { error: `${METRICS[id].label}の目標値が不正です(1〜${METRICS[id].max}で入力してください)` };
    }
    metrics.push({ id, label: METRICS[id].label, unit: METRICS[id].unit, target: v });
  }

  return { value: { ingredients, mood, count, metrics } };
}

// ==== AIに渡す成分表(毎回まったく同じ文面なので、プロンプトの先頭に置く) ====
// 先頭が毎回同じだと、AI側のプロンプトキャッシュが効きやすく、表を足しても待ち時間がほぼ増えません。
const FOOD_TABLE_TEXT = FOODS
  .filter((f) => f.name !== "水")
  .map((f) => f.name + (f.cat === "veg" ? "[野]" : "") + " " + f.v.join("/"))
  .join("\n");

const STATIC_PREFIX =
  "あなたは家庭料理のレシピ考案アシスタントです。栄養量は、あなたが書いた材料のg数から食品成分表で機械的に計算して利用者に表示します。そのため材料の食材名と分量の書き方が最も重要です。\n" +
  "食材は料理に合うものを自由に選んでください。下の成分表は栄養計算の参照用で、使える食材の一覧ではありません。表にない食材も遠慮なく使ってください。\n\n" +
  "【参照用の食品成分表(日本食品標準成分表(八訂)、可食部100gあたり)】\n" +
  "形式: 食材名 エネルギーkcal/たんぱく質g/脂質g/炭水化物g/食物繊維g/食塩相当量g ([野]は野菜量に数える食材)\n" +
  FOOD_TABLE_TEXT + "\n\n" +
  "【材料の書き方(栄養計算に使うため厳守)】\n" +
  "・材料の分量はすべて1人分で書く\n" +
  "・成分表にある食材は、表の表記を一字一句そのまま使う(例:「鶏むね」ではなく「鶏むね肉(皮なし)」)\n" +
  "・成分表にない食材は一般的な名称で書き、その品の \"custom_foods\" に、材料欄と同じ食材名で、日本食品標準成分表(八訂)の可食部100gあたりの値を上と同じ順で必ず書く。野菜類なら \"veg\": true をつける(例: 塩麹、白味噌、黒酢、ごまドレッシング、牛もも肉、ビーツ)\n" +
  "・似た名前でも成分が違う食材(例: 塩と塩麹、醤油とだし醤油、卵と卵白)は、成分表の近い食材に置き換えず custom_foods に書く\n" +
  "・1つの材料は「食材名 分量」の形で書き、分量には必ず可食部のグラム数を入れる(例:「鶏むね肉(皮なし) 150g」「醤油 大さじ1(18g)」「卵 2個(100g)」)\n" +
  "・「少々」「適量」「お好みで」は使わず、塩や調味料も必ずg数を書く(例:「塩 0.5g」)\n" +
  "・ご飯・ゆでうどん・ゆでそばは調理後、スパゲッティ・乾物は乾燥状態の重量で書く(成分表の状態に合わせる)\n" +
  "・野菜の量には[野]の食材だけを数える(きのこ・海藻・いも・果物は含めない)\n" +
  "・栄養の目標は、上の成分表の値に材料のg数を掛けて合計し、目標に近づくよう分量を決める\n\n";

function buildPrompt(req) {
  const { ingredients, mood, count, metrics } = req;

  const targetText = metrics.length
    ? '全' + count + '品の合計で、' + metrics.map(m => m.label + 'を' + m.target + m.unit + '程度').join('、') + 'になるようにしてください(多少の前後は構いませんが、大きく外れないようにしてください)。'
    : '栄養バランスの良い、一般的な家庭料理にしてください。';
  const countText = count === 1
    ? '1品だけで完結する料理にしてください。'
    : count + '品構成にしてください。実在感のある主菜+副菜の組み合わせにし、内容が偏らないよう彩りや食感に変化をつけてください。';

  const soupRule = count === 1
    ? '・1品だけの構成のため、スープ(種類:「スープ」)は選ばないでください\n'
    : '・スープ(種類:「スープ」)を1品含める場合、その1品に使う野菜と肉・魚介・豆腐などの具材は合計300g以内に収めてください(recorteのスープメーカーを使用しており、1回に調理できる野菜+具材が合計300gまでのため)\n';

  return STATIC_PREFIX +
    '以下の条件をもとに、' + count + '品分のレシピを考えて、JSON配列の形式のみで出力してください。前置き・説明・Markdownのコードブロック記号(```)は一切つけないでください。\n\n' +
    '【使う食材】(成分表にない食材が含まれていても、必ず使ってください)\n' + ingredients + '\n\n' +
    '【料理の雰囲気・ジャンル・味の方向性】\n' + (mood ? mood : '指定なし(食材から自由に発想してよい)') + '\n\n' +
    '【栄養の目標】\n' + targetText + '\n\n' +
    '【品数】\n' + countText + '\n\n' +
    '【必ず守る条件】\n' +
    '・油はごま油かオリーブオイルのみ使用する(サラダ油などの他の植物油は使わない)\n' +
    '・ハム・ソーセージ・ベーコンなどの加工肉は使わない\n' +
    '・家庭で無理なく作れる、実在感のある料理にする\n' +
    '・各品の手順は3〜6ステップ程度で具体的に書く\n' +
    '・ガスコンロ(フライパン・鍋など)を使う料理は全品の中で1品までにする(スープ類はスープメーカー使用として対象外)\n' +
    soupRule + '\n' +
    '出力は必ずちょうど' + count + '個の要素を持つ、以下の形式のJSON配列のみとしてください(キーはこの通りに、値は日本語で入れる。栄養量の数値は書かない):\n' +
    '[\n' +
    '  {\n' +
    '    "name": "料理名",\n' +
    '    "type": "鍋・炒め物・丼・サラダ・スープ・プレート・サンド・中華・カレー・パスタ・ご飯もの・煮物・洋食のいずれか、最も近いもの",\n' +
    '    "ingredients": ["食材名 分量(g)", "食材名 分量(g)"],\n' +
    '    "steps": ["手順1", "手順2"],\n' +
    '    "custom_foods": {"成分表にない食材名": {"v": [kcal, たんぱく質, 脂質, 炭水化物, 食物繊維, 食塩相当量], "veg": false}}\n' +
    '  }\n' +
    ']\n' +
    '(custom_foods は成分表にない食材を使わなかった品では省略する)';
}

// 1回のリクエストで使う出力トークン数の上限(品数が多いほど増やす)
function maxTokensFor(count) {
  return Math.min(4000, 700 + 800 * count);
}

function cleanList(list, maxItems) {
  return list
    .filter((x) => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, maxItems);
}

// ==== 栄養計算 ====

function normalizeName(s) {
  return String(s).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

// 食材名(正式名・別名)→ 成分データ の対応表
const FOOD_INDEX = new Map();
FOODS.forEach((f) => {
  [f.name, ...(f.aliases || [])].forEach((n) => {
    const key = normalizeName(n);
    if (!FOOD_INDEX.has(key)) FOOD_INDEX.set(key, f);
  });
});
// ※部分一致(「塩麹」→「塩」など)は成分が大きく違う食材を取り違えるため行いません。
//   表にない食材はAIが custom_foods で補った値を使い、それもなければ「成分値不明」として注記します。

function lookupFood(name, customMap) {
  const key = normalizeName(name);
  if (!key) return null;
  if (customMap.has(key)) return customMap.get(key);
  if (FOOD_INDEX.has(key)) return FOOD_INDEX.get(key);
  const noParen = normalizeName(String(name).replace(/[(（][^)）]*[)）]/g, ""));
  if (customMap.has(noParen)) return customMap.get(noParen);
  if (FOOD_INDEX.has(noParen)) return FOOD_INDEX.get(noParen);
  return null;
}

// 「醤油 大さじ1(18g)」→ { name: "醤油", grams: 18 }
function parseIngredient(str) {
  const s = String(str).normalize("NFKC").trim();
  const m = s.match(/^(\S+)\s*(.*)$/);
  const name = m ? m[1] : s;
  const rest = m ? m[2] : "";
  let grams = null;
  const gramMatches = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|ml|mL|cc)(?![a-zA-Z])/g)];
  if (gramMatches.length) {
    const last = gramMatches[gramMatches.length - 1];
    grams = parseFloat(last[1]) * (last[2] === "kg" ? 1000 : 1); // 液体は1ml≒1gとして扱う
  } else {
    // g数が書かれていない場合の予備(目安量)
    const spoon = rest.match(/(大さじ|小さじ)\s*(\d+(?:\.\d+)?)(?:\/(\d+))?/);
    if (spoon) {
      const n = spoon[3] ? parseFloat(spoon[2]) / parseFloat(spoon[3]) : parseFloat(spoon[2]);
      grams = n * (spoon[1] === "大さじ" ? 15 : 5);
    } else if (/少々/.test(rest)) grams = 0.5;
    else if (/ひとつまみ/.test(rest)) grams = 1;
  }
  return { name, grams };
}

function buildCustomMap(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  Object.keys(raw).slice(0, 20).forEach((name) => {
    const entry = raw[name];
    const arr = Array.isArray(entry) ? entry : (entry && Array.isArray(entry.v) ? entry.v : null);
    if (!arr || arr.length < 6) return;
    const v = arr.slice(0, 6).map((x) => Number(x));
    // 可食部100gあたりとしてありえない値は採用しない
    if (v.some((x) => !Number.isFinite(x) || x < 0) || v[0] > 950 || v.slice(1).some((x) => x > 100)) return;
    map.set(normalizeName(name), { name: String(name).slice(0, 50), v, cat: entry && entry.veg === true ? "veg" : null, custom: true });
  });
  return map;
}

function roundTo(value, decimals) {
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

// 1品分の材料から栄養量を計算する
function computeNutrition(ingredients, customMap) {
  const total = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, salt: 0, veg: 0 };
  const estimated = [];  // AIが値を補った食材
  const unknown = [];    // 成分が分からず計算に入れられなかった食材
  ingredients.forEach((line) => {
    const { name, grams } = parseIngredient(line);
    const food = lookupFood(name, customMap);
    if (!food || grams == null) {
      unknown.push(name);
      return;
    }
    const r = grams / 100;
    const [kcal, p, f, c, fib, salt] = food.v;
    total.calories += kcal * r;
    total.protein += p * r;
    total.fat += f * r;
    total.fiber += fib * r;
    total.carbs += Math.max(0, c - fib) * r; // 糖質 = 炭水化物 − 食物繊維
    total.salt += salt * r;
    if (food.cat === "veg") total.veg += grams;
    if (food.custom) estimated.push(food.name);
  });
  return { total, estimated, unknown };
}

function nutritionNoteFor(estimated, unknown) {
  const parts = [];
  if (estimated.length) parts.push(estimated.join("・") + "はAIが補った成分値で計算");
  if (unknown.length) parts.push(unknown.join("・") + "は成分値が不明のため計算に含めていません");
  return parts.length ? parts.join("。") + "。" : "";
}

// AIの返答(文字列)を検証して、画面に返してよい形に整える。形が崩れていたら例外を投げる。
// 栄養量は、選択されたすべての指標について、すべての品で必ずサーバーが計算して入れる。
function parseDishes(content, req) {
  const cleaned = String(content).replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.dishes) ? parsed.dishes : null);
  if (!items || !items.length) throw new Error("unexpected response shape");

  const metricIds = req.metrics.length ? req.metrics.map((m) => m.id) : ["protein"];

  return items.slice(0, req.count).map((item) => {
    if (!item || typeof item.name !== "string" || !item.name.trim()
        || !Array.isArray(item.ingredients) || !Array.isArray(item.steps)) {
      throw new Error("unexpected item shape");
    }
    const dish = {
      name: item.name.trim().slice(0, 100),
      type: typeof item.type === "string" && item.type.trim() ? item.type.trim().slice(0, 20) : "その他",
      ingredients: cleanList(item.ingredients, 30),
      steps: cleanList(item.steps, 15),
    };
    if (!dish.ingredients.length || !dish.steps.length) throw new Error("empty ingredients or steps");

    const { total, estimated, unknown } = computeNutrition(dish.ingredients, buildCustomMap(item.custom_foods));
    metricIds.forEach((id) => {
      dish[id] = roundTo(total[id], METRICS[id].decimals);
    });
    // 成分表に追加すると精度が上がる食材を、サーバーのログで把握できるようにする
    if (estimated.length || unknown.length) {
      console.log("nutrition: not in table: " + JSON.stringify({ estimated, unknown }));
    }
    const note = nutritionNoteFor(estimated, unknown);
    if (note) dish.nutritionNote = note;
    return dish;
  });
}

export { parseCreateRequest, buildPrompt, maxTokensFor, parseDishes, computeNutrition, parseIngredient };
