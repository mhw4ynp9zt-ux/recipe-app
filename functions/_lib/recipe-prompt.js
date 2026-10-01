// レシピ作成のリクエスト検証・プロンプト組み立て・AIの返答の検証(すべてサーバー側)。
// ブラウザからは「食材・雰囲気・品数・栄養目標」だけを受け取り、プロンプトはここで組み立てます。
// (自由なプロンプトを受け付けると、AIの中継として悪用されてしまうため)
// 栄養量はAIに答えさせず、AIが返した食材と重さをもとに nutrition.js が日本食品標準成分表(D1)から計算します。
//
// 注意: METRICS は js/config.js の NUTRIENT_METRICS(id・label・unit)と同じ内容に保ってください。
// max は入力できる目標値の上限です。

const METRICS = {
  protein:  { label: "たんぱく質", unit: "g",    max: 500 },
  veg:      { label: "野菜",       unit: "g",    max: 3000 },
  fat:      { label: "脂質",       unit: "g",    max: 500 },
  salt:     { label: "塩分",       unit: "g",    max: 50 },
  fiber:    { label: "食物繊維",   unit: "g",    max: 200 },
  carbs:    { label: "糖質",       unit: "g",    max: 1000 },
  calories: { label: "カロリー",   unit: "kcal", max: 6000 },
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

  return 'あなたは家庭料理のレシピ考案アシスタントです。以下の条件をもとに、' + count + '品分のレシピを考えて、JSON配列の形式のみで出力してください。前置き・説明・Markdownのコードブロック記号(```)は一切つけないでください。\n\n' +
    '【使う食材】\n' + ingredients + '\n\n' +
    '【料理の雰囲気・ジャンル・味の方向性】\n' + (mood ? mood : '指定なし(食材から自由に発想してよい)') + '\n\n' +
    '【栄養の目標】\n' + targetText + '\n\n' +
    '【品数】\n' + countText + '\n\n' +
    '【必ず守る条件】\n' +
    '・油はごま油かオリーブオイルのみ使用する(サラダ油などの他の植物油は使わない)\n' +
    '・ハム・ソーセージ・ベーコンなどの加工肉は使わない\n' +
    '・家庭で無理なく作れる、実在感のある料理にする\n' +
    '・材料はすべて、下の形式のオブジェクトで書く(分量・重さ・成分表の食品名を必ず入れる)\n' +
    '・name は「玉ねぎ」「豚ロース薄切り肉」のような普通の食材名にする(メーカー名や切り方は付けない)\n' +
    '・amount は人が読む分量の表記にする(例: "150g"、"1/2個(100g)"、"大さじ1"、"少々")\n' +
    '・grams は、皮・骨・種・ヘタなどを除いて実際に食べる部分(正味)の重さを、g単位の数値で入れる。個数・大さじ・少々・適量も目安のgに換算する(例: 塩少々=0.5、しょうゆ大さじ1=18、砂糖大さじ1=9、油大さじ1=12)。水やお湯は 0 にする\n' +
    '・food は、文部科学省「日本食品標準成分表(八訂)」の食品名の表記に合わせ、スペース区切りで書く。生の食材は末尾に「生」を付ける。ひらがな・カタカナも成分表の表記に合わせる(例: "たまねぎ りん茎 生"、"にんじん 根 皮なし 生"、"ぶた ロース 脂身つき 生"、"にわとり むね 皮なし 生"、"鶏卵 全卵 生"、"こいくちしょうゆ"、"食塩"、"オリーブ油")。水など成分表にないものは空文字にする\n' +
    '・栄養量はこちらで成分表から計算するため、出力しない\n' +
    '・各品の手順は3〜6ステップ程度で具体的に書く\n' +
    '・ガスコンロ(フライパン・鍋など)を使う料理は全品の中で1品までにする(スープ類はスープメーカー使用として対象外)\n' +
    soupRule + '\n' +
    '出力は必ずちょうど' + count + '個の要素を持つ、以下の形式のJSON配列のみとしてください(キーはこの通りに、値は日本語で入れる):\n' +
    '[\n' +
    '  {\n' +
    '    "name": "料理名",\n' +
    '    "type": "鍋・炒め物・丼・サラダ・スープ・プレート・サンド・中華・カレー・パスタ・ご飯もの・煮物・洋食のいずれか、最も近いもの",\n' +
    '    "ingredients": [\n' +
    '      { "name": "食材名", "amount": "分量の表記", "grams": 正味のg(数値), "food": "成分表の食品名" }\n' +
    '    ],\n' +
    '    "steps": ["手順1", "手順2"]\n' +
    '  }\n' +
    ']';
}

// 1回のリクエストで使う出力トークン数の上限(品数が多いほど増やす)。
// 材料1つが {name, amount, grams, food} の4項目になったぶん、従来(700 + 800 × 品数)より余裕を持たせている。
function maxTokensFor(count) {
  return Math.min(5000, 800 + 1000 * count);
}

function cleanList(list, maxItems) {
  return list
    .filter((x) => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, maxItems);
}

const MAX_GRAMS = 5000;

// 重さ(g)。grams が数値ならそれを、無ければ amount の中の「○g」から拾う。どちらも無ければ null。
function gramsFrom(grams, amount) {
  if (grams !== null && grams !== undefined && grams !== "") {
    const g = Number(grams);
    if (Number.isFinite(g) && g >= 0 && g <= MAX_GRAMS) return g;
  }
  const m = String(amount || "").match(/([0-9]+(?:\.[0-9]+)?)\s*g/);
  if (m) {
    const g = Number(m[1]);
    if (g >= 0 && g <= MAX_GRAMS) return g;
  }
  return null;
}

function cleanField(value, maxLen) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return cleanText(value).slice(0, maxLen);
}

// 材料1つ分を { name, amount, grams, food, display } に整える。形が違えば null。
// (旧形式の「食材名 分量」という文字列も受け付ける。その場合は食品名が無いので、食材名から探すことになる)
function parseIngredient(x) {
  if (typeof x === "string" || typeof x === "number") {
    const text = cleanField(x, 300);
    return text ? { name: text, amount: "", grams: gramsFrom(null, text), food: "", display: text } : null;
  }
  if (!x || typeof x !== "object") return null;
  const name = cleanField(x.name, 100);
  if (!name) return null;
  const amount = cleanField(x.amount, 100);
  const grams = gramsFrom(x.grams, amount);
  const food = cleanField(x.food, 100);
  const display = amount ? name + " " + amount : (grams > 0 ? name + " " + grams + "g" : name);
  return { name, amount, grams, food, display };
}

// AIの返答(文字列)を検証して、画面に返してよい形に整える。形が崩れていたら例外を投げる。
// 返す各品: { name, type, ingredients: [表示用の文字列], ingredientDetails: [{name, amount, grams, food}], steps }
// ingredients は従来どおり「食材名 分量」の文字列(画面・保存済みレシピの表示がそのまま使える)。
function parseDishes(content, req) {
  const cleaned = String(content).replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.dishes) ? parsed.dishes : null);
  if (!items || !items.length) throw new Error("unexpected response shape");

  return items.slice(0, req.count).map((item) => {
    if (!item || typeof item.name !== "string" || !item.name.trim()
        || !Array.isArray(item.ingredients) || !Array.isArray(item.steps)) {
      throw new Error("unexpected item shape");
    }
    const details = item.ingredients.map(parseIngredient).filter(Boolean).slice(0, 30);
    const dish = {
      name: item.name.trim().slice(0, 100),
      type: typeof item.type === "string" && item.type.trim() ? item.type.trim().slice(0, 20) : "その他",
      ingredients: details.map((d) => d.display),
      ingredientDetails: details.map(({ name, amount, grams, food }) => ({ name, amount, grams, food })),
      steps: cleanList(item.steps, 15),
    };
    if (!dish.ingredients.length || !dish.steps.length) throw new Error("empty ingredients or steps");
    return dish;
  });
}

export { parseCreateRequest, buildPrompt, maxTokensFor, parseDishes };
