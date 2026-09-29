// レシピ作成のリクエスト検証・プロンプト組み立て・AIの返答の検証(すべてサーバー側)。
// ブラウザからは「食材・雰囲気・品数・栄養目標」だけを受け取り、プロンプトはここで組み立てます。
// (自由なプロンプトを受け付けると、AIの中継として悪用されてしまうため)
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

  const nutrientFieldsText = metrics.length
    ? metrics.map((m, i) => '    "' + m.id + '": この1品のおおよその' + m.label + '量(' + m.unit + '、整数)' + (i < metrics.length - 1 ? ',' : '')).join('\n')
    : '    "protein": この1品のおおよそのたんぱく質量(g、整数)';

  return 'あなたは家庭料理のレシピ考案アシスタントです。以下の条件をもとに、' + count + '品分のレシピを考えて、JSON配列の形式のみで出力してください。前置き・説明・Markdownのコードブロック記号(```)は一切つけないでください。\n\n' +
    '【使う食材】\n' + ingredients + '\n\n' +
    '【料理の雰囲気・ジャンル・味の方向性】\n' + (mood ? mood : '指定なし(食材から自由に発想してよい)') + '\n\n' +
    '【栄養の目標】\n' + targetText + '\n\n' +
    '【品数】\n' + countText + '\n\n' +
    '【必ず守る条件】\n' +
    '・油はごま油かオリーブオイルのみ使用する(サラダ油などの他の植物油は使わない)\n' +
    '・ハム・ソーセージ・ベーコンなどの加工肉は使わない\n' +
    '・家庭で無理なく作れる、実在感のある料理にする\n' +
    '・材料には分量(g、個数、大さじなど)を必ず併記する\n' +
    '・各品の手順は3〜6ステップ程度で具体的に書く\n' +
    '・ガスコンロ(フライパン・鍋など)を使う料理は全品の中で1品までにする(スープ類はスープメーカー使用として対象外)\n' +
    soupRule + '\n' +
    '出力は必ずちょうど' + count + '個の要素を持つ、以下の形式のJSON配列のみとしてください(キーはこの通りに、値は日本語で入れる):\n' +
    '[\n' +
    '  {\n' +
    '    "name": "料理名",\n' +
    '    "type": "鍋・炒め物・丼・サラダ・スープ・プレート・サンド・中華・カレー・パスタ・ご飯もの・煮物・洋食のいずれか、最も近いもの",\n' +
    '    "ingredients": ["食材名 分量", "食材名 分量"],\n' +
    '    "steps": ["手順1", "手順2"],\n' +
    nutrientFieldsText + '\n' +
    '  }\n' +
    ']';
}

// 1回のリクエストで使う出力トークン数の上限(品数が多いほど増やす。1品のときは従来と同じ1500)
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

// AIの返答(文字列)を検証して、画面に返してよい形に整える。形が崩れていたら例外を投げる。
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
    metricIds.forEach((id) => {
      if (item[id] != null) dish[id] = Math.round(Number(item[id]) || 0);
    });
    return dish;
  });
}

export { parseCreateRequest, buildPrompt, maxTokensFor, parseDishes };
