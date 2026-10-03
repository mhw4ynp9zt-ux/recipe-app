import { GENRES, ROLES } from "./taxonomy.js";

// レシピ作成のリクエスト検証・プロンプト組み立て・AIの返答の検証(すべてサーバー側)。
// ブラウザからは「食材・雰囲気・品数・栄養目標」だけを受け取り、プロンプトはここで組み立てます。
// (自由なプロンプトを受け付けると、AIの中継として悪用されてしまうため)
// 栄養量はAIに答えさせず、AIが返した食材と重さをもとに nutrition.js が日本食品標準成分表(D1)から計算します。
//
// 品ごとの指定(2品・3品のとき)
//   ブラウザは dishes: [{ ingredients, mood }, …](品数と同じ数)を送れます。1品目から順に、その品の使いたい食材・料理名/雰囲気/ジャンルです。
//   ・2品以上で、どれかの品に指定があれば req.dishes に入れ、プロンプトは「各品の指定」の形になります(指定の無い品・項目はAIにおまかせ)。
//   ・1品のときは、従来どおり req.ingredients / req.mood にその内容を入れます(プロンプトは従来と同じ)。
//   ・dishes が無い従来のリクエスト(古い画面)は、これまでどおり全品共通の ingredients / mood として扱います。
//
// ユーザーごとの「使わない食材」(設定タブで登録)は、ブラウザからは受け取りません。
// ジョブの開始時にサーバーがDBから読み、req.excluded(名前の配列)としてここへ渡します(recipe-job.js の startJob)。
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

// ==== 栄養目標まわりの設定(許容幅を変えたいときは、ここの2つだけを直す) ====
// TOLERANCE     … 合格ライン。計算した合計が目標からこの幅(±10%)に収まれば合格。外れたら create-recipe.js がAIに作り直させます。
//                 緩めるほど初回で合格しやすく(作り直しが減って速く)なり、厳しくするほど栄養の精度は上がるが遅くなります。
// AIM_TOLERANCE … AIに「ここを狙って」と伝える幅(±3%)。合格ラインより厳しめにしておくことで、
//                 AIの計算が多少ずれても合格ライン(TOLERANCE)に収まりやすくします。判定には使いません。
const TOLERANCE = 0.10;
const AIM_TOLERANCE = 0.03;
const TOLERANCE_EPS = 1e-6; // 10.0000001% のような浮動小数の誤差で不合格にしないための余裕

const ALLOWED_COUNTS = [1, 2, 3];
const MAX_INGREDIENTS_LEN = 500; // 1品あたり(従来の全品共通の入力も同じ)
const MAX_MOOD_LEN = 300;        // 1品あたり(従来の全品共通の入力も同じ)
// 所要時間の指定(分)。js/config.js の TIME_LIMIT_OPTIONS と同じ内容に保つ(テストで一致を確認)
const MAX_MINUTES_OPTIONS = [10, 30, 45, 60];

// ==== 手間度の指定(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり) ====
// js/config.js の EFFORT_OPTIONS の level と同じ内容に保つ(テストで一致を確認)。
// 時間ではなく「作る負担(手順の数・使う器具・包丁で切る食材・洗い物)」で絞る指定。
//   ・品ごとに指定する(dishes[i].effortLevel)。全品共通の effortLevel も受け付ける(古い画面との互換。品ごとの指定が無い品に使う)。
//   ・0(超ラク)・1(ラク)・2(ふつう)は上限の指定。3(しっかり)は「手間をかけた本格的な料理にする」という指定で、上限ではない。
//   ・注意: 0 は「指定なし」とは別の値(未指定・null が指定なし)。0 を偽(falsy)として扱わないこと。
//   ・指定があるときだけ、EFFORT_RULES を【必ず守る条件】に足し、手順の数の指示(EFFORT_STEP_RULES)を差し替える。
//   ・手順の数の基準は、画面側 js/utils.js の EFFORT_STEP_LIMIT(ラク3・ふつう6。超ラクは手順数の上限なし)と合わせる。
//   ・AIの呼び出し回数・作り直しの条件には一切関わらない(判定は画面側で、超えていても作り直さず注意を出すだけ)。
const EFFORT_LEVELS = [0, 1, 2, 3];
const EFFORT_NAMES = { 0: '超ラク', 1: 'ラク', 2: 'ふつう', 3: 'しっかり' };
// 全品が同じ手間度のとき(1行)
const EFFORT_RULES = {
  0: '・【手間度: 超ラク】各品とも、包丁とまな板を使わずに作れる料理にする。食材は、切らずにそのまま使えるもの(カット済み・缶詰・パウチ・豆腐・納豆・卵・冷凍野菜・サラダチキン・海苔・チーズなど)にするか、手でちぎる・キッチンばさみで切るだけで使えるものにする。皮むき・すりおろし・干物や乾物の戻し・漬け込み・裏ごしなど、下ごしらえに手間がかかる工程は入れない。加熱・調理に使う器具は1つまで(電子レンジだけ、火を使わず和えるだけ、も可)。洗い物も少なくする\n',
  1: '・【手間度: ラク】各品とも、とにかく手間と洗い物を少なくする。加熱・調理に使う器具は1つだけ(フライパン・鍋・電子レンジ・スープメーカーのどれか1つ)。包丁で切る食材は2種類まで(カット済みの食材・キッチンばさみ・手でちぎる、を活用してよい)。干物や乾物の戻し・長時間の漬け込み・裏ごしなど、下ごしらえに手間がかかる工程は入れない\n',
  2: '・【手間度: ふつう】各品とも、加熱・調理に使う器具は2つまで。包丁で切る食材は4種類まで。長時間の下ごしらえや凝った工程は入れない\n',
  3: '・【手間度: しっかり】手間をかけた本格的な料理にする。下ごしらえ・煮込み・仕込みなどに時間をかけてよい(ただし、他の条件は守る)\n',
};
// 品ごとに手間度が違うとき、「n品目: ○○」の後ろに付ける、その品の基準
const EFFORT_DISH_RULES = {
  0: '包丁とまな板を使わない(食材は切らずにそのまま使えるもの、または手でちぎる・キッチンばさみで切るだけで使えるもの。カット済み・缶詰・パウチ・豆腐・納豆・卵・冷凍野菜・サラダチキンなど)。皮むき・すりおろし・戻し・漬け込みなど手間のかかる下ごしらえは入れない。加熱・調理の器具は1つまで(電子レンジだけ・火を使わず和えるだけも可)。洗い物も少なくする',
  1: '加熱・調理の器具は1つだけ。包丁で切る食材は2種類まで(カット済み・キッチンばさみ・手でちぎる、を活用してよい)。手間のかかる下ごしらえは入れない',
  2: '加熱・調理の器具は2つまで。包丁で切る食材は4種類まで。長時間の下ごしらえや凝った工程は入れない',
  3: '手間をかけた本格的な料理にする(下ごしらえ・煮込み・仕込みに時間をかけてよい)',
};
// 手順の数の指示。指定なしのときは従来の文(EFFORT_STEP_RULE_DEFAULT)のまま
const EFFORT_STEP_RULE_DEFAULT =
  '・各品の手順は4〜7ステップ程度で具体的に書く。下味・火加減・加熱時間・焼き色・味付けのタイミングなど、美味しく仕上げるコツも手順に入れる\n';
const EFFORT_STEP_RULES = {
  0: '・各品の手順は、楽に作れる範囲で必要なだけにする(数は問わない)。調味料の量・加熱時間・混ぜ方など、美味しく仕上げるコツは手順に入れる\n',
  1: '・各品の手順は3ステップ以内にまとめる。下味・火加減・加熱時間など、美味しく仕上げるコツも、その3ステップの中に入れる\n',
  2: '・各品の手順は5ステップ前後(4〜6ステップ)で具体的に書く。下味・火加減・加熱時間・味付けのタイミングなど、美味しく仕上げるコツも手順に入れる\n',
  3: '・各品の手順は5〜8ステップで具体的に書く。下味・火加減・加熱時間・焼き色・味付けのタイミングなど、美味しく仕上げるコツも手順に入れる\n',
};
// 品ごとに手間度が違うときの、手順の数の指示(その品の手間度に合わせる)
const EFFORT_STEP_RULE_MIXED =
  '・各品の手順の数は、その品の手間度に合わせる(超ラク: 楽に作れる範囲で必要なだけ / ラク: 3ステップ以内 / ふつう: 5ステップ前後 / しっかり: 5〜8ステップ / 手間度の指定なしの品: 4〜7ステップ程度)。下味・火加減・加熱時間・味付けのタイミングなど、美味しく仕上げるコツも手順に入れる\n';

// 品ごとの手間度の配列(長さ=品数。値は 0〜3 または null=指定なし)。どの品にも指定が無ければ null
function effortsOf(req) {
  const n = Number(req.count) || 0;
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = Array.isArray(req.dishes) ? req.dishes[i] : undefined;
    let v = d && EFFORT_LEVELS.includes(d.effortLevel) ? d.effortLevel : null;
    if (v === null && EFFORT_LEVELS.includes(req.effortLevel)) v = req.effortLevel;
    arr.push(v);
  }
  return arr.some((v) => v !== null) ? arr : null;
}

function cleanText(value) {
  // 改行などの制御文字は空白にしてプロンプトを崩されないようにする
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

// 品ごとの指定(body.dishes)を検証して整える。成功: { list: [{ ingredients, mood, effortLevel? }] }(品数と同じ数。effortLevel は 0〜3 のときだけ付く) / 失敗: { error }
// 各品は { ingredients, mood } の文字列(省略・空なら指定なし)。数が品数と合わない、形が違う、長すぎる場合は失敗。
function parseDishSpecs(raw, count) {
  if (!Array.isArray(raw) || raw.length !== count) return { error: "品ごとの指定の数が品数と合いません" };
  const list = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (item === null || item === undefined) { list.push({ ingredients: "", mood: "" }); continue; }
    if (typeof item !== "object" || Array.isArray(item)) return { error: "品ごとの指定の形式が不正です" };
    const out = {};
    for (const [key, max, label] of [["ingredients", MAX_INGREDIENTS_LEN, "食材"], ["mood", MAX_MOOD_LEN, "料理名・雰囲気・ジャンル"]]) {
      const v = item[key];
      if (v !== undefined && v !== null && typeof v !== "string") return { error: "品ごとの指定の形式が不正です" };
      out[key] = typeof v === "string" ? cleanText(v) : "";
      if (out[key].length > max) return { error: `${i + 1}品目の${label}の入力が長すぎます(${max}文字まで)` };
    }
    const ef = item.effortLevel;
    if (ef !== undefined && ef !== null) {
      if (!EFFORT_LEVELS.includes(ef)) return { error: "手間度の指定が不正です" };
      out.effortLevel = ef;
    }
    list.push(out);
  }
  return { list };
}

// 成功: { value: { ingredients, mood, dishes?, count, metrics: [{id,label,unit,target}] } } / 失敗: { error }
// dishes は「2品以上で、どれかの品に指定がある」ときだけ付く(各要素は { ingredients, mood })。
function parseCreateRequest(body) {
  if (!body || typeof body !== "object") return { error: "リクエストが不正です" };

  let ingredients = typeof body.ingredients === "string" ? cleanText(body.ingredients) : "";
  if (ingredients.length > MAX_INGREDIENTS_LEN) {
    return { error: `食材の入力が長すぎます(${MAX_INGREDIENTS_LEN}文字まで)` };
  }

  let mood = typeof body.mood === "string" ? cleanText(body.mood) : "";
  if (mood.length > MAX_MOOD_LEN) {
    return { error: `雰囲気・ジャンルの入力が長すぎます(${MAX_MOOD_LEN}文字まで)` };
  }

  const count = Number(body.count);
  if (!ALLOWED_COUNTS.includes(count)) return { error: "品数が不正です" };

  // 品ごとの指定がある場合は、全品共通の ingredients / mood よりこちらを優先する
  let dishes;
  let dishEffort; // 1品のときの、その品の手間度(0〜3)
  if (body.dishes !== undefined && body.dishes !== null) {
    const r = parseDishSpecs(body.dishes, count);
    if (r.error) return { error: r.error };
    if (count === 1) {
      // 1品だけなら従来の形(プロンプトも従来と同じ)
      ingredients = r.list[0].ingredients;
      mood = r.list[0].mood;
      if (r.list[0].effortLevel !== undefined) dishEffort = r.list[0].effortLevel;
    } else {
      // 2品以上: どれかに指定があれば品ごとの形にする。ingredients / mood は記録用に全品分をつないだ文字列
      ingredients = r.list.map((d) => d.ingredients).filter(Boolean).join(" ");
      mood = r.list.map((d) => d.mood).filter(Boolean).join("、");
      if (r.list.some((d) => d.ingredients || d.mood || d.effortLevel !== undefined)) dishes = r.list;
    }
  }

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

  // 所要時間(全品を同時進行で作り終える上限の分)。無い(null/未指定)なら制限なし。値は選択肢のどれかだけ
  let maxMinutes;
  if (body.maxMinutes !== undefined && body.maxMinutes !== null) {
    if (!MAX_MINUTES_OPTIONS.includes(body.maxMinutes)) return { error: "所要時間の指定が不正です" };
    maxMinutes = body.maxMinutes;
  }

  // 手間度(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり)。全品共通の指定(品ごとの指定が無い品に使う)。無い(null/未指定)なら指定なし。値は選択肢のどれかだけ(数値型のみ)
  let effortLevel = dishEffort;
  if (body.effortLevel !== undefined && body.effortLevel !== null) {
    if (!EFFORT_LEVELS.includes(body.effortLevel)) return { error: "手間度の指定が不正です" };
    if (effortLevel === undefined) effortLevel = body.effortLevel;
  }

  const value = { ingredients, mood, count, metrics };
  if (dishes) value.dishes = dishes;
  if (maxMinutes !== undefined) value.maxMinutes = maxMinutes;
  if (effortLevel !== undefined) value.effortLevel = effortLevel;
  return { value };
}

function fmtNum(n) {
  return String(Math.round(n * 10) / 10);
}

// AIに伝える「狙う範囲」(目標の±AIM_TOLERANCE)。範囲の内側に丸めて(例: 78g → 75.7〜80.3)、AIがこの範囲に入れれば必ず合格になるようにする。
// 合格ライン(TOLERANCE)より狭いので、この範囲に入れば合格は確実。
function displayRange(target) {
  return {
    min: Math.ceil(target * (1 - AIM_TOLERANCE) * 10) / 10,
    max: Math.floor(target * (1 + AIM_TOLERANCE) * 10) / 10,
  };
}

// 計算済みの dishes(attachNutrition 後)の合計が、各目標の許容範囲(±TOLERANCE)に入っているかを調べる。
// 合計は画面のバッジと同じく「各品の値(小数1桁)の足し算を小数1桁に丸めたもの」で比べる。
// 返り値: { ok, worst(目標からの最大のずれ。%), results: [{ id, label, unit, target, total, min, max, diffPct, ok }] }
function checkTargets(dishes, metrics) {
  const results = metrics.map((m) => {
    const sum = dishes.reduce((s, d) => s + (Number(d[m.id]) || 0), 0);
    const total = Math.round(sum * 10) / 10;
    const min = m.target * (1 - TOLERANCE);
    const max = m.target * (1 + TOLERANCE);
    return {
      id: m.id, label: m.label, unit: m.unit, target: m.target,
      total, min, max,
      diffPct: ((total - m.target) / m.target) * 100,
      ok: total >= min - TOLERANCE_EPS && total <= max + TOLERANCE_EPS,
    };
  });
  return {
    ok: results.every((r) => r.ok),
    worst: Math.max(0, ...results.map((r) => Math.abs(r.diffPct))),
    results,
  };
}

// ユーザーが「使わない」と登録した食材の一覧(req.excluded)。無ければ空配列
function excludedOf(req) {
  return Array.isArray(req.excluded) ? req.excluded.filter((x) => typeof x === "string" && x) : [];
}

// 品ごとの指定(req.dishes)。無ければ空配列(=全品共通の ingredients / mood を使う従来の形)
function dishSpecsOf(req) {
  return Array.isArray(req.dishes) && req.dishes.length ? req.dishes : [];
}

// 美味しさを最優先にするための指示(1回目のプロンプトに入る)。
// 栄養の目標・食材の指定・「必ず守る条件」は今までどおり守らせたうえで、その範囲でいちばん美味しい料理を考えさせる。
// 注意: 「使わない食材」という文言は入れない(登録が無いときは、プロンプトにその語が現れないことをテストで確認している)。
const TASTE_SECTION =
  '【美味しさを最優先】\n' +
  '・このレシピでいちばん大切なのは「本当に美味しいこと」です。食べた人が「また作りたい」と思う味を目指してください。\n' +
  '・栄養の目標は、まず美味しい料理を考えてから、材料の grams を増減して合わせる。目標に合わせるために、味が悪くなる食材の組み合わせ・不自然な食材の追加・極端な分量にはしない\n' +
  '・美味しいと広く知られている定番の組み合わせ・味付けをベースにする。奇抜さや珍しさより、確かな美味しさを優先する\n' +
  '・味に、旨味(だし・きのこ・トマト・肉や魚の香ばしさなど)、塩味、香り(香味野菜・薬味・香辛料)、コク、酸味やさっぱり感のバランスを持たせ、ぼんやりした味や、ただ薄いだけの味にしない\n' +
  '・食感に変化をつける(カリッ・とろり・シャキッ・ほくほくなど)。2品以上のときは、主菜・副菜・汁物で味の方向性や食感が重ならないようにする\n' +
  '・調味料は味がしっかり決まる量にする(控えすぎない)。塩分に目標があるときは、その範囲の中で、酸味・香り・旨味・コクを使って満足感を出す\n' +
  '・ただし、食材の指定・栄養の目標・下の【必ず守る条件】は、美味しさのためでも破らない。その範囲で最も美味しい料理にする\n\n';

// 作り直しの依頼文に入れる、美味しさを保つための一文
const TASTE_KEEP =
  '・分量を調整するときも、味のバランスと美味しさを保つ。目標に合わせるためだけに不自然な食材を足したり、味が落ちる極端な分量にしたりしない。\n';

function buildPrompt(req) {
  const { ingredients, mood, count, metrics } = req;
  const excluded = excludedOf(req);
  const dishSpecs = dishSpecsOf(req);

  // AIには合格ライン(TOLERANCE)ではなく、より厳しい狙い(AIM_TOLERANCE)を伝える
  const aimPct = Math.round(AIM_TOLERANCE * 100);
  const targetText = metrics.length
    ? '全' + count + '品の合計で、次の目標になるようにしてください。\n' +
      metrics.map(m => {
        const r = displayRange(m.target);
        return '・' + m.label + ': ' + m.target + m.unit + '(±' + aimPct + '%の範囲 ' + fmtNum(r.min) + '〜' + fmtNum(r.max) + m.unit + ')';
      }).join('\n') + '\n' +
      '各栄養素の合計は、必ず目標値の±' + aimPct + '%以内(上の範囲)に収めてください。\n' +
      '材料の grams を決めるときは、各食材の分量(g)から、食材ごとの栄養量を日本食品標準成分表の値で計算して合計を求め、目標との差が±' + aimPct + '%を超える場合は、分量(grams)を調整してから出力してください。すべての目標が上の範囲に入ることを確かめてから出力すること。'
    : '栄養バランスの良い、一般的な家庭料理にしてください。';
  const countText = count === 1
    ? '1品だけで完結する料理にしてください。'
    : count + '品構成にしてください。実在感のある主菜+副菜の組み合わせにし、内容が偏らないよう彩りや食感に変化をつけてください。';

  const soupRule = count === 1
    ? '・1品だけの構成のため、スープ(種類:「スープ」)は選ばないでください\n'
    : '・スープ(種類:「スープ」)を1品含める場合、その1品に使う野菜と肉・魚介・豆腐などの具材は合計300g以内に収めてください(recorteのスープメーカーを使用しており、1回に調理できる野菜+具材が合計300gまでのため)\n';

  // ユーザーごとに登録された「使わない食材」(設定タブ)。毎回の入力なしで、すべての作成に自動で加わる
  const excludedSection = excluded.length
    ? '【使わない食材(ユーザーが苦手・避けたい食材。絶対に使わない)】\n' + excluded.map((n) => '・' + n).join('\n') + '\n\n'
    : '';
  const excludedRule = excluded.length
    ? '・上の【使わない食材】は、主材料・副材料・調味料・だし・飾りのどれにも一切使わない。「豚肉」のような大きな分類が書かれていたら、ロース・バラ・ひき肉など、その分類に含まれるすべての部位・種類も使わない。使いたい食材や雰囲気の指定と重なる場合も、使わない食材を優先する\n'
    : '';
  // 所要時間の指定(あるときだけ)。AIには「全品を同時進行で」の上限として伝える
  const timeRule = MAX_MINUTES_OPTIONS.includes(req.maxMinutes)
    ? '・全品を同時進行で作って' + req.maxMinutes + '分以内に終わる料理にする(下ごしらえ・加熱を含む)\n'
    : '';
  // 手間度の指定(あるときだけ)。条件の1行と、手順の数の指示(指定なしのときは従来の文のまま)
  //   ・全品が同じ手間度 → 1行の条件(従来と同じ文)/ 品ごとに違う → 品ごとの条件(配列の順番に対応)/ どの品にも指定なし → 条件なし
  const efforts = effortsOf(req);
  let effortRule = '';
  let stepRule = EFFORT_STEP_RULE_DEFAULT;
  if (efforts) {
    if (efforts.every((v) => v === efforts[0])) {
      effortRule = EFFORT_RULES[efforts[0]];
      stepRule = EFFORT_STEP_RULES[efforts[0]];
    } else {
      effortRule = '・手間度は品ごとに次のとおり守る(出力するJSON配列の順番に対応。1番目が1品目)。「手間度の指定なし」の品は自由に決めてよい\n' +
        efforts.map((v, i) => '  ' + (i + 1) + '品目【' + (v === null ? '手間度の指定なし' : EFFORT_NAMES[v]) + '】' + (v === null ? '' : ': ' + EFFORT_DISH_RULES[v]) + '\n').join('');
      stepRule = EFFORT_STEP_RULE_MIXED;
    }
  }

  // 食材・雰囲気の指定。品ごとの指定があるときは「各品の指定」に、無いときは従来の全品共通の2項目にする
  const specSection = dishSpecs.length
    ? '【各品の指定(1品ごとに、指定された食材・料理名・雰囲気・ジャンルを守る)】\n' +
      dishSpecs.map((d, i) =>
        (i + 1) + '品目\n' +
        '・使う食材: ' + (d.ingredients ? d.ingredients : '指定なし(栄養の目標に合う食材をAIが自由に選んでよい)') + '\n' +
        '・料理名・雰囲気・ジャンル: ' + (d.mood ? d.mood : '指定なし(自由に発想してよい)')
      ).join('\n') + '\n\n'
    : '【使う食材】\n' + (ingredients ? ingredients : '指定なし(栄養の目標に合う食材をAIが自由に選んでよい)') + '\n\n';
  const moodSection = dishSpecs.length
    ? ''
    : '【料理の雰囲気・ジャンル・味の方向性】\n' + (mood ? mood : '指定なし(自由に発想してよい)') + '\n\n';
  const genreRule = dishSpecs.length
    ? '・各品の genre は、その品に指定されたジャンルがあれば、それに近い系統を選ぶ(指定がなければ料理に合う系統を選ぶ)\n'
    : '';
  const dishRule = dishSpecs.length
    ? '・【各品の指定】は、出力するJSON配列の順番に対応させる(配列の1番目が1品目、2番目が2品目…)。ある品に「使う食材」の指定があれば、その品の材料に必ず入れる。料理名の指定があれば、その品はその料理(またはごく近い料理)にする。雰囲気・ジャンルの指定は、その品にだけ反映し、他の品には引き継がない。「指定なし」の項目はAIが自由に決めてよい。指定が他の条件(使わない食材・ガスコンロの数・スープの分量など)とぶつかるときは、他の条件を優先したうえで、指定にできるだけ近い形にする\n'
    : '';

  return 'あなたは家庭料理のレシピ考案アシスタントです。以下の条件をもとに、' + count + '品分のレシピを考えて、JSON配列の形式のみで出力してください。前置き・説明・Markdownのコードブロック記号(```)は一切つけないでください。\n\n' +
    specSection +
    excludedSection +
    moodSection +
    TASTE_SECTION +
    '【栄養の目標】\n' + targetText + '\n\n' +
    '【品数】\n' + countText + '\n\n' +
    '【必ず守る条件】\n' +
    excludedRule +
    dishRule +
    genreRule +
    effortRule +
    timeRule +
    '・油はごま油かオリーブオイルのみ使用する(サラダ油などの他の植物油は使わない)\n' +
    '・ハム・ソーセージ・ベーコンなどの加工肉は使わない\n' +
    '・家庭で無理なく作れる、実在感のある料理にする\n' +
    '・材料はすべて、下の形式のオブジェクトで書く(分量・重さ・成分表の食品名を必ず入れる)\n' +
    '・name は「玉ねぎ」「豚ロース薄切り肉」のような普通の食材名にする(メーカー名や切り方は付けない)\n' +
    '・amount は人が読む分量の表記にする(例: "150g"、"1/2個(100g)"、"大さじ1"、"少々")\n' +
    '・grams は、皮・骨・種・ヘタなどを除いて実際に食べる部分(正味)の重さを、g単位の数値で入れる。個数・大さじ・少々・適量も目安のgに換算する(例: 塩少々=0.5、しょうゆ大さじ1=18、砂糖大さじ1=9、油大さじ1=12)。水やお湯は 0 にする\n' +
    '・food は、文部科学省「日本食品標準成分表(八訂)」の食品名の表記に合わせ、スペース区切りで書く。生の食材は末尾に「生」を付ける。ひらがな・カタカナも成分表の表記に合わせる(例: "たまねぎ りん茎 生"、"にんじん 根 皮なし 生"、"ぶた ロース 脂身つき 生"、"にわとり むね 皮なし 生"、"鶏卵 全卵 生"、"こいくちしょうゆ"、"食塩"、"オリーブ油")。水など成分表にないものは空文字にする\n' +
    '・栄養量はこちらで成分表から計算するため、出力しない\n' +
    stepRule +
    '・ガスコンロ(フライパン・鍋など)を使う料理は全品の中で1品までにする(スープ類はスープメーカー使用として対象外)\n' +
    soupRule + '\n' +
    '出力は必ずちょうど' + count + '個の要素を持つ、以下の形式のJSON配列のみとしてください(キーはこの通りに、値は日本語で入れる):\n' +
    '[\n' +
    '  {\n' +
    '    "name": "料理名",\n' +
    '    "type": "鍋・炒め物・丼・サラダ・スープ・プレート・サンド・中華・カレー・パスタ・ご飯もの・煮物・洋食のいずれか、最も近いもの",\n' +
    '    "genre": "' + GENRES.join('・') + 'のいずれか、最も近いもの",\n' +
    '    "role": "' + ROLES.join('・') + 'のいずれか、献立での役割",\n' +
    '    "minutes": 所要時間の分(整数。下ごしらえ・加熱を含む),\n' +
    '    "effortLevel": この品の手間度(整数。0=超ラク:包丁・まな板を使わない / 1=ラク:手順3つ以内・加熱の器具1つ・切る食材2種類まで / 2=ふつう:手順5つ前後・器具2つまで / 3=しっかり:それ以上に手間をかけた料理。実際の手順と器具に合わせて判定する),\n' +
    '    "ingredients": [\n' +
    '      { "name": "食材名", "amount": "分量の表記", "grams": 正味のg(数値), "food": "成分表の食品名" }\n' +
    '    ],\n' +
    '    "steps": ["手順1", "手順2"]\n' +
    '  }\n' +
    ']';
}

// 目標の許容範囲(±TOLERANCE)から外れたとき、または使わない食材が含まれていたときに、AIへ送る「作り直し」の依頼文。
// 会話の続き(1回目のプロンプト → AIの返答 → この依頼文)として送るので、条件の全文は繰り返さない。
// 前回の合計と目標との差(例: 前回563kcalで-6.2%不足)を、増やす/減らすの向きと量つきで伝える。
// やり直しでもAIには、合格ラインではなく狙い(±AIM_TOLERANCE)を伝える。
// dishes は attachNutrition 済み。各食材の ingredientDetails[i].contrib(その食材が各栄養素に寄与した量)があれば内訳に使う。
// hits: 使わない食材として登録されているのに、前回のレシピに含まれていた食材の名前(無ければ空)
function buildRetryPrompt(req, dishes, check, hits = []) {
  const pct = Math.round(TOLERANCE * 100);
  const aimPct = Math.round(AIM_TOLERANCE * 100);
  const off = check.results.filter((r) => !r.ok);
  const excluded = excludedOf(req);

  const hitText = hits.length
    ? '【使ってはいけない食材が含まれていました】\n' + hits.map((n) => '・' + n).join('\n') + '\n' +
      'これらはユーザーが「使わない」と登録した食材です。前回のレシピの料理名・材料(関連する部位・加工品も)から、すべて取り除いてください。\n\n'
    : '';
  const excludedKeep = excluded.length
    ? '・【使わない食材】(' + excluded.join('、') + ')は、作り直しでも絶対に使わないでください。分量を調整するときや食材を入れ替えるときも、これらを加えないこと。\n'
    : '';
  // 品ごとの指定があるときは、作り直しでも守らせる(指定した品の入れ替わり・食材の脱落を防ぐ)
  const dishKeep = dishSpecsOf(req).length
    ? '・【各品の指定】(使う食材・料理名・雰囲気・ジャンル)は最初の依頼のとおりです。品の順番も変えず、指定を守ったまま作り直してください。\n'
    : '';

  // 目標は許容範囲に収まっていて、使わない食材だけを直したいとき
  if (!off.length) {
    return hitText +
      '栄養量を成分表から計算したところ、前回の合計は目標の±' + pct + '%の許容範囲に収まっていました。\n\n' +
      '【やり直しのお願い】\n' +
      '・上の食材を取り除き、別の食材に置き換えて作り直してください。置き換えたあとも、すべての目標が目標値の±' + aimPct + '%以内に入るよう、材料の grams を調整してください。\n' +
      '・料理の方向性はできるだけ保ってください。\n' +
      '・amount の表記も、grams に合わせて直してください。\n' +
      TASTE_KEEP +
      excludedKeep +
      dishKeep +
      '・「必ず守る条件」と出力形式は最初の依頼のとおりです。JSON配列のみを出力し、前置き・コードブロック記号はつけないでください。';
  }

  const summary = check.results.map((r) => {
    const rg = displayRange(r.target);
    const gap = r.total - r.target;
    let state;
    if (r.ok) {
      state = '許容範囲内(OK)。大きく動かさないこと';
    } else if (gap > 0) {
      state = '目標より' + fmtNum(gap) + r.unit + '多すぎる → 約' + fmtNum(gap) + r.unit + '分「減らす」方向に調整';
    } else {
      state = '目標まで' + fmtNum(-gap) + r.unit + '不足 → 約' + fmtNum(-gap) + r.unit + '分「増やす」方向に調整';
    }
    return '・' + r.label + ': 前回の合計は' + r.total + r.unit + '(目標' + r.target + r.unit + 'に対し' +
      (r.diffPct > 0 ? '+' : '') + r.diffPct.toFixed(1) + '%)→ ' + state +
      '(狙う範囲 ' + fmtNum(rg.min) + '〜' + fmtNum(rg.max) + r.unit + ')';
  }).join('\n');

  // 範囲を外れた指標について、料理ごとに「どの食材がどれだけ寄与したか」を示す
  const detail = dishes.map((dish, i) => {
    const lines = dish.ingredientDetails
      .filter((ing) => ing.grams > 0 && ing.contrib)
      .map((ing) => '  - ' + ing.name + ' ' + ing.grams + 'g: ' +
        off.map((r) => r.label + ' ' + fmtNum(ing.contrib[r.id] || 0) + r.unit).join('、'));
    return (i + 1) + '品目「' + dish.name + '」\n' + (lines.length ? lines.join('\n') : '  (内訳なし)');
  }).join('\n');

  // 成分表と照合できず、計算に入っていない食材(あれば food の表記を直させる)
  const unmatched = [...new Set(dishes.flatMap((d) => (d.nutritionCheck && d.nutritionCheck.unmatched) || []))];
  const unmatchedText = unmatched.length
    ? '\n\n【計算に入っていない食材】\n' + unmatched.map((n) => '・' + n).join('\n') +
      '\nこれらは成分表の食品と照合できず、上の合計に含まれていません。food を成分表の表記(例: "たまねぎ りん茎 生")に直し、grams も入れてください。'
    : '';

  return hitText +
    '栄養量をこちらで日本食品標準成分表から計算したところ、目標の±' + pct + '%の許容範囲に収まっていませんでした。\n\n' +
    '【前回の計算結果と、直す向き】\n' + summary + '\n\n' +
    '【範囲を外れた栄養素の、食材ごとの内訳】\n' + detail + unmatchedText + '\n\n' +
    '【やり直しのお願い】\n' +
    '・上の「直す向き」と内訳をもとに、材料の grams を増減して、すべての目標が目標値の±' + aimPct + '%以内(狙う範囲)に入るように作り直してください。目標との差が±' + aimPct + '%を超える場合は、分量を調整してから出力すること。\n' +
    '・ある栄養素の調整は他の栄養素にも影響します。範囲内だった栄養素が外れないよう、全体を計算し直してください。\n' +
    '・料理の方向性はできるだけ保ち、重さの調整で足りないときに限って、食材の追加・入れ替えをしてください。\n' +
    '・amount の表記も、grams に合わせて直してください。\n' +
    TASTE_KEEP +
    excludedKeep +
    dishKeep +
    '・「必ず守る条件」と出力形式は最初の依頼のとおりです。JSON配列のみを出力し、前置き・コードブロック記号はつけないでください。';
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
    // 系統・役割は、選択肢にある値のときだけ付ける(範囲外・欠けた値は項目ごと無し。エラーにはしない)
    if (typeof item.genre === "string" && GENRES.includes(item.genre.trim())) dish.genre = item.genre.trim();
    if (typeof item.role === "string" && ROLES.includes(item.role.trim())) dish.role = item.role.trim();
    // 所要時間(分)は、1〜240の整数のときだけ付ける(欠けた値・範囲外は項目ごと無し。エラーにはしない)
    if (typeof item.minutes === "number" && Number.isInteger(item.minutes) && item.minutes >= 1 && item.minutes <= 240) dish.minutes = item.minutes;
    // 手間度(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり)は、数値の0〜3のときだけ付ける(欠けた値・範囲外は項目ごと無し。エラーにはしない)
    if (typeof item.effortLevel === "number" && EFFORT_LEVELS.includes(item.effortLevel)) dish.effortLevel = item.effortLevel;
    if (!dish.ingredients.length || !dish.steps.length) throw new Error("empty ingredients or steps");
    return dish;
  });
}

export { MAX_MINUTES_OPTIONS, EFFORT_LEVELS, parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor, parseDishes, TOLERANCE, AIM_TOLERANCE };
