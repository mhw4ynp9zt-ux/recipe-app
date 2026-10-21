// 家電の容量チェック(functions/_lib/appliance-capacity.js と、recipe-job.js / recipe-prompt.js への組み込み)のテスト。
// 【重要】実際のAI(xAI・有料)は一切呼びません。通信(fetch)は偽物に差し替え、本物の通信は禁止しています。
//   ・fetch は「偽のxAI」だけ。ほかのURLへの通信、台本にない呼び出しはテストを失敗させる
//   ・AIのAPIキーはダミー。DBはメモリ上の node:sqlite
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { startJob, getJobState, runJob, MAX_AI_CALLS, MAX_ATTEMPTS } from "../functions/_lib/recipe-job.js";
import { parseCapacityMl, dishVolumeMl, findCapacityHits, capacityLimits, scaledTargets } from "../functions/_lib/appliance-capacity.js";
import { buildPrompt, buildRetryPrompt, parseDishes } from "../functions/_lib/recipe-prompt.js";
import { createTrace } from "../functions/_lib/debug-trace.js";

// ---- 偽のAI(これ以外の通信は禁止) ----
const aiCalls = [];
let script = [];
const setScript = (s) => { aiCalls.length = 0; script = s; };
globalThis.fetch = async (url, opts = {}) => {
  assert.equal(String(url), "https://api.x.ai/v1/chat/completions", "xAI以外への通信は禁止: " + url);
  aiCalls.push(JSON.parse(opts.body));
  const step = script[aiCalls.length - 1] ?? script[script.length - 1];
  if (!step) throw new Error("台本がありません(想定外のAI呼び出し)");
  return new Response(JSON.stringify({ choices: [{ message: { content: step } }] }), { status: 200, headers: { "content-type": "application/json" } });
};

let passed = 0;
const ok = (name) => { passed++; console.log("  ✓ " + name); };

// ---- 材料・料理のダミー ----
const ing = (name, amount, grams) => ({ name, amount, grams, food: "" });
// スクショの「きのこたっぷり彩りポタージュ」(野菜670g+豆乳250ml+油・塩…=約1.1kg)
const bigSoup = {
  name: "きのこたっぷり彩りポタージュ",
  appliance: "レコルト 調理ポット",
  ingredientDetails: [
    ing("しめじ", "120g", 120), ing("えのき", "80g", 80), ing("にんじん", "200g", 200), ing("ブロッコリー", "250g", 250),
    ing("玉ねぎ", "1個(180g)", 180), ing("かぼちゃ", "150g", 150), ing("無調整豆乳", "250ml", 258), ing("オリーブ油", "小さじ2", 8), ing("塩", "小さじ1", 6),
  ],
  steps: ["レコルト調理ポットに、玉ねぎ・にんじん…"],
};
// 容量に収まる小さめのスープ(約500ml)
const smallSoup = {
  name: "かぼちゃ豆乳ポタージュ",
  appliance: "レコルト 調理ポット",
  ingredientDetails: [ing("かぼちゃ", "150g", 150), ing("玉ねぎ", "1/2個(90g)", 90), ing("無調整豆乳", "250ml", 258), ing("塩", "小さじ1/2", 3)],
  steps: ["ポットに材料を入れる"],
};
const POT = { name: "レコルト 調理ポット", policy: "optional", note: "", spec: { capacity: "600ml(300ml〜Maxライン)", modes: [], ranges: "", cautions: [] } };

// ==== A. 容量の読み取りと量の計算(AIは関係しない) ====
{
  assert.equal(parseCapacityMl("600ml(300ml〜Maxライン)"), 600);
  assert.equal(parseCapacityMl("600ｍｌ"), 600);          // 全角
  assert.equal(parseCapacityMl("1.5L"), 1500);
  assert.equal(parseCapacityMl("0.8リットル"), 800);
  assert.equal(parseCapacityMl("Maxラインまで"), null);   // 数値が読めない
  assert.equal(parseCapacityMl(""), null);
  assert.equal(parseCapacityMl(undefined), null);
  ok("容量の文字列から最大(ml)を読み取る(600ml/全角/L/リットル。読めなければ null)");
}
{
  const v = dishVolumeMl(bigSoup);
  assert.ok(v > 1000 && v < 1300, "実際 " + v);
  assert.ok(dishVolumeMl(smallSoup) <= 600, "実際 " + dishVolumeMl(smallSoup));
  assert.equal(dishVolumeMl({ ingredientDetails: [ing("水", "水300ml", 0), ing("だし", "カップ1", 0), ing("塩", "少々", 0.5)] }), 300 + 200 + 0.5);
  assert.equal(dishVolumeMl({}), 0);
  ok("材料の量の数え方: ml・カップ優先、無ければ grams(水は amount から)。スクショのスープは約" + Math.round(v) + "ml");
}
{
  const hits = findCapacityHits([bigSoup, smallSoup], [POT]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].dish, "きのこたっぷり彩りポタージュ"); assert.equal(hits[0].maxMl, 600); assert.equal(hits[0].dishIndex, 0);
  assert.deepEqual(findCapacityHits([smallSoup], [POT]), []);
  // 家電を使わない品(appliance: null で、手順にも家電の名前が無い)は、材料が多くても対象外
  assert.deepEqual(findCapacityHits([{ ...bigSoup, appliance: null, steps: ["鍋で煮る"] }], [POT]), []);
  // AIが appliance を null にしても、手順にその家電の名前があれば「使う」とみなす(確認をすり抜けさせない)
  assert.equal(findCapacityHits([{ ...bigSoup, appliance: null }], [POT]).length, 1);
  // AIの書いた家電名が登録名とずれていても(別の家電名・誤記)、手順に登録名があれば対象
  assert.equal(findCapacityHits([{ ...bigSoup, appliance: "スープメーカー" }], [POT]).length, 1);
  // 容量が読めない・specが無い家電は調べない
  assert.deepEqual(findCapacityHits([bigSoup], [{ ...POT, spec: { ...POT.spec, capacity: "Maxラインまで" } }]), []);
  assert.deepEqual(findCapacityHits([bigSoup], [{ name: "レコルト 調理ポット", policy: "optional", note: "" }]), []);
  assert.deepEqual(findCapacityHits([bigSoup], []), []);
  // appliance 欄が無い返答は、品名・手順に家電の名前が書かれているかで判断する
  const noKey = { ...bigSoup }; delete noKey.appliance;
  assert.equal(findCapacityHits([noKey], [POT]).length, 1);
  const noKeyNoMention = { ...noKey, steps: ["鍋で煮る"] };
  assert.deepEqual(findCapacityHits([noKeyNoMention], [POT]), []);
  ok("容量超過の品だけを見つける(収まる品・家電を使わない品・容量が読めない家電は対象外)");
}
{
  assert.deepEqual(capacityLimits([POT, { name: "炊飯器" }]), [{ name: "レコルト 調理ポット", maxMl: 600 }]);
  ok("容量が読み取れる家電だけを、プロンプト用に一覧にする");
}

{ // 実際に容量オーバーのまま画面に出た、2回目のレシピ(野菜850g+豆乳180ml)。AIが appliance を null にしても検出できる
  const shot = { name: "彩り野菜の豆乳ポタージュ", appliance: null, steps: ["レコルト 調理ポットにすべての野菜、豆乳…を入れ、合計量が600ml以下であることを確認する"],
    ingredientDetails: [ing("にんじん", "200g(約1.5本)", 200), ing("玉ねぎ", "1個(180g)", 180), ing("しめじ", "120g(約1パック)", 120), ing("ブロッコリー", "200g(約3/4株)", 200),
      ing("ほうれん草", "150g(約3/4束)", 150), ing("豆乳(無調整)", "180ml", 186), ing("鶏ガラスープの素", "小さじ1", 3), ing("塩", "小さじ1/4", 1.5), ing("ごま油", "小さじ1", 4)] };
  const h = findCapacityHits([shot], [POT]);
  assert.equal(h.length, 1); assert.ok(h[0].volumeMl > 1000 && h[0].maxMl === 600);
  ok("実際に出た容量オーバーのレシピ(約" + h[0].volumeMl + "ml)を、appliance が null でも検出する");
}

{ // 2回目のスクショ: 野菜440g+豆乳220ml+調味料。水80mlは手順にだけ書かれている → 水も数える
  const d = { name: "かぼちゃのポタージュ", appliance: "レコルト 調理ポット",
    steps: ["かぼちゃ…は一口大に切る", "レコルト 調理ポットにすべての野菜と水80ml(合計容量594ml以内)を入れ、POTAGE&PASTEモードで25分調理する。"],
    ingredientDetails: [ing("かぼちゃ", "150g", 150), ing("にんじん", "120g(約3/4本)", 120), ing("ブロッコリー", "100g(約1/3株)", 100), ing("玉ねぎ", "1/2個(70g)", 70),
      ing("無調整豆乳", "220ml", 227), ing("コンソメ", "小さじ1", 3), ing("オリーブ油", "小さじ1", 4), ing("塩", "小さじ1/3", 2)] };
  const v = dishVolumeMl(d);
  assert.ok(v > 740 && v < 760, "実際 " + v);
  assert.equal(findCapacityHits([d], [POT]).length, 1);
  // 材料欄に水があれば、手順の水は二重に数えない
  const withWater = { ...d, ingredientDetails: [...d.ingredientDetails, ing("水", "80ml", 0)] };
  assert.equal(dishVolumeMl(withWater), v);
  // 材料を減らして収まれば対象外(水を数えても)
  const ok2 = { ...d, ingredientDetails: [ing("かぼちゃ", "100g", 100), ing("玉ねぎ", "50g", 50), ing("無調整豆乳", "200ml", 206)] };
  assert.deepEqual(findCapacityHits([ok2], [POT]), []);
  ok("手順にだけ書かれた水・お湯・だしも、容量に数える(材料欄にあれば二重に数えない)。2回目のスクショのレシピは約" + Math.round(v) + "ml");
}

{ // 縮めた量の目安: 全部を目安の量にすると、容量(最大の92%)以下に収まる
  const d = { name: "かぼちゃのポタージュ", appliance: "レコルト 調理ポット",
    steps: ["レコルト 調理ポットにすべての野菜と水80mlを入れる"],
    ingredientDetails: [ing("かぼちゃ", "150g", 150), ing("にんじん", "120g", 120), ing("ブロッコリー", "100g", 100), ing("玉ねぎ", "1/2個(70g)", 70),
      ing("無調整豆乳", "220ml", 227), ing("コンソメ", "小さじ1", 3), ing("オリーブ油", "小さじ1", 4), ing("塩", "小さじ1/3", 2)] };
  const t = scaledTargets(d, 600);
  assert.ok(t.length >= 6);
  assert.deepEqual(t.find((x) => x.name === "無調整豆乳").unit, "ml"); assert.deepEqual(t.find((x) => x.name === "かぼちゃ").unit, "g");
  assert.ok(t.some((x) => /^水/.test(x.name) && x.unit === "ml"), "手順だけの水も含む");
  assert.ok(!t.some((x) => x.name === "塩" || x.name === "コンソメ"), "小さじ程度の調味料は触らない");
  const shrunk = { ...d, steps: [], ingredientDetails: [...t.filter((x) => !/^水/.test(x.name)).map((x) => ing(x.name, x.value + x.unit, x.value)), ing("コンソメ", "小さじ1", 3), ing("塩", "小さじ1/3", 2)] };
  assert.ok(dishVolumeMl(shrunk) <= 600, "実際 " + dishVolumeMl(shrunk));
  assert.deepEqual(scaledTargets(shrunk, 600), []);
  assert.deepEqual(scaledTargets({ ...d, ingredientDetails: [ing("かぼちゃ", "100g", 100)], steps: [] }, 600), []);
  ok("縮めた量の目安: 各材料の量をコードで計算(その量にすると約" + Math.round(dishVolumeMl(shrunk)) + "ml=最大600ml以内)。収まる品には出さない");
}

// ==== B. プロンプトと返答の解析(AIは呼ばない) ====
const baseReq = { ingredients: "", mood: "", count: 1, metrics: [{ id: "protein", label: "たんぱく質", unit: "g", target: 78 }] };
{
  const p = buildPrompt({ ...baseReq, appliances: [POT] });
  assert.match(p, /最大600mlまで/); assert.match(p, /液体は、必ず材料にも書く/); assert.match(p, /栄養の目標よりも優先して守る/); assert.match(p, /"appliance"/); assert.match(p, /"applianceMl"/);
  const p0 = buildPrompt({ ...baseReq, appliances: [] });
  assert.doesNotMatch(p0, /"appliance"/); assert.doesNotMatch(p0, /最大\d+mlまで/);
  const pNoCap = buildPrompt({ ...baseReq, appliances: [{ ...POT, spec: { ...POT.spec, capacity: "" } }] });
  assert.doesNotMatch(pNoCap, /"appliance"/);
  ok("プロンプト: 容量が読める家電があるときだけ、最大mlの指示と appliance 欄が入る(家電なしは従来どおり)");
}
{
  const body = [{ name: "A", type: "スープ", ingredients: [{ name: "水", amount: "300ml", grams: 0, food: "" }], steps: ["煮る"], appliance: "レコルト 調理ポット" },
                { name: "B", type: "炒め物", ingredients: [{ name: "鶏肉", amount: "100g", grams: 100, food: "" }], steps: ["焼く"], appliance: null },
                { name: "C", type: "炒め物", ingredients: [{ name: "鶏肉", amount: "100g", grams: 100, food: "" }], steps: ["焼く"] }];
  body[0].applianceMl = 1039;
  const dishes = parseDishes(JSON.stringify(body), { count: 3 });
  assert.equal(dishes[0].appliance, "レコルト 調理ポット"); assert.equal(dishes[1].appliance, null); assert.equal("appliance" in dishes[2], false);
  assert.equal(dishes[0].applianceMl, 1039); assert.equal("applianceMl" in dishes[1], false);
  ok("返答の解析: appliance は文字列/null で保持し、欄が無ければ付けない");
}
{
  const check = { ok: true, worst: 0, results: [{ id: "protein", label: "たんぱく質", unit: "g", target: 78, total: 78, min: 70, max: 86, diffPct: 0, ok: true }] };
  const hits = findCapacityHits([bigSoup], [POT]);
  const r = buildRetryPrompt({ ...baseReq, appliances: [POT] }, [bigSoup], check, [], hits);
  assert.match(r, /家電の容量を超えていました/); assert.match(r, /最大600ml/); assert.match(r, /きのこたっぷり彩りポタージュ/);
  assert.match(r, /栄養の目標よりも優先します/); assert.match(r, /他の品の材料の grams を増減/);
  assert.match(r, /縮めた量の目安/); assert.match(r, /ブロッコリー \d+g/); assert.match(r, /あと約6\d\dml減らす/); assert.match(r, /量の多い材料: .*ブロッコリー 250ml相当/);
  const r0 = buildRetryPrompt({ ...baseReq, appliances: [POT] }, [bigSoup], check, [], []);
  assert.doesNotMatch(r0, /家電の容量を超えていました/);
  ok("作り直しの依頼文: 容量超過の品名・量・最大が入る(超過なしなら入らない)");
}

{ // 縮めたあとの栄養の見込み: ログのケース(野菜が620g→縮めると減って目標600gに届かない)
  const d = { name: "ポタージュ", appliance: "レコルト 調理ポット", steps: ["レコルト 調理ポットで煮る"],
    ingredientDetails: [{ ...ing("かぼちゃ", "300g", 300), contrib: { veg: 300, protein: 3 } }, { ...ing("にんじん", "250g", 250), contrib: { veg: 250, protein: 2 } },
      { ...ing("無調整豆乳", "300ml", 310), contrib: { veg: 0, protein: 10 } }, { ...ing("塩", "小さじ1", 6), contrib: { veg: 0, protein: 0 } }] };
  const chicken = { name: "鶏むね肉の蒸し物", ingredientDetails: [{ ...ing("鶏むね肉", "250g", 250), contrib: { veg: 0, protein: 58 } }, { ...ing("ねぎ", "80g", 80), contrib: { veg: 70, protein: 1 } }] };
  const hits = findCapacityHits([chicken, d], [POT]);
  assert.equal(hits.length, 1); assert.equal(hits[0].dishIndex, 1); assert.ok(hits[0].factor > 0 && hits[0].factor < 1);
  const check = { ok: false, worst: 0, results: [
    { id: "veg", label: "野菜", unit: "g", target: 600, total: 620, diffPct: 3.3, ok: true },
    { id: "protein", label: "たんぱく質", unit: "g", target: 78, total: 74, diffPct: -5, ok: true }] };
  const r = buildRetryPrompt({ ...baseReq, appliances: [POT] }, [chicken, d], check, [], hits);
  assert.match(r, /縮めたあとの栄養の見込み/); assert.match(r, /野菜: 今620g → 縮めると約4\d\d(\.\d)?g\(目標600gに対し、約1\d\d(\.\d)?g不足\)/);
  assert.match(r, /その家電を使わない他の品の材料で、約1\d\d(\.\d)?g分「増やす」方向に調整/);
  assert.match(r, /たんぱく質: 今74g → 縮めると約6\d(\.\d)?g/);
  // 縮める材料の栄養への寄与が小さい(contrib が無い・0)なら、見込みの節は出ない
  const noContrib = { ...d, ingredientDetails: d.ingredientDetails.map(({ contrib, ...x }) => x) };
  assert.doesNotMatch(buildRetryPrompt({ ...baseReq, appliances: [POT] }, [chicken, noContrib], check, [], findCapacityHits([chicken, noContrib], [POT])), /縮めたあとの栄養の見込み/);
  ok("縮めたあとの栄養の見込み: 野菜が目標に届かなくなる分を計算し、他の品で増やすよう具体的な量で伝える(寄与のデータが無ければ出さない)");
}

// ==== C. ジョブ全体(偽のAI・メモリDB)。AI呼び出し回数を数える ====
function makeEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE recipe_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0, request TEXT NOT NULL, messages TEXT, best TEXT, result TEXT, error TEXT, trace TEXT,
    attempt INTEGER NOT NULL DEFAULT 0, ai_calls INTEGER NOT NULL DEFAULT 0, expected_chars INTEGER, active_ms INTEGER NOT NULL DEFAULT 0,
    usage_day TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  const wrap = (sql, args = []) => ({
    bind: (...a) => wrap(sql, a),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { db, DB: { prepare: (sql) => wrap(sql) } };
}
function makeDeps(appliances) {
  const retryPrompts = [];
  return {
    retryPrompts, stream: false,
    parseCreateRequest: (b) => ({ value: { ingredients: "", mood: "", count: 1, metrics: [{ id: "protein", label: "たんぱく質", unit: "g", target: 78 }] } }),
    buildPrompt: () => "PROMPT",
    buildRetryPrompt: (req, dishes, check, hits = [], capHits = []) => { const t = "RETRY cap=" + capHits.length; retryPrompts.push(t); return t; },
    checkTargets: () => ({ ok: true, worst: 0, results: [{ id: "protein", label: "たんぱく質", unit: "g", target: 78, total: 78, min: 70, max: 86, diffPct: 0, ok: true }] }), // 栄養はいつも合格(容量だけを見る)
    maxTokensFor: () => 4000, parseDishes: (c) => JSON.parse(c), TOLERANCE: 0.1, attachNutrition: async () => {},
    createTrace: (e) => createTrace(e),
    loadAiSettings: async () => ({ model: "grok-test", dailyLimit: 50, hasKey: true, apiKey: "xai-test-dummykey-0000", keyError: false }),
    reserveUsage: async () => ({ ok: true, day: "d" }), refundUsage: async () => {}, isAdminUser: () => false,
    loadExcludedFoods: async () => [], findExcludedHits: () => [], loadPersonalNotes: async () => [],
    loadAppliances: async () => appliances, findCapacityHits,
  };
}
const user = { id: "u1" };
async function runOnce(appliances, replies) {
  const env = makeEnv(), deps = makeDeps(appliances); setScript(replies);
  const r = await startJob(env, user, { count: 1 }, deps); assert.equal(r.status, 200, JSON.stringify(r.body));
  await runJob(env, user, r.body.jobId, deps);
  const st = (await getJobState(env, user, r.body.jobId, deps)).body;
  return { st, deps, row: env.db.prepare("SELECT * FROM recipe_jobs WHERE id = ?").get(r.body.jobId) };
}
const reply = (d) => JSON.stringify([d]);

{ // 1回目が容量超過 → 作り直し → 2回目で収まって完成。AIは2回だけ
  const { st, deps } = await runOnce([POT], [reply(bigSoup), reply(smallSoup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 2);
  assert.equal(st.result.dishes[0].name, "かぼちゃ豆乳ポタージュ"); assert.equal(st.result.capacityHits, undefined);
  assert.deepEqual(deps.retryPrompts, ["RETRY cap=1"]);
  ok("容量超過 → 1回作り直して完成(AI呼び出し2回)");
}
{ // いつも容量超過 → 作り直しの上限で止まる。AIの呼び出しは上限以内、最後は超過の印つきで返す
  const { st, row } = await runOnce([POT], [reply(bigSoup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, MAX_ATTEMPTS); assert.ok(aiCalls.length <= MAX_AI_CALLS);
  assert.equal(row.ai_calls, MAX_ATTEMPTS);
  assert.equal(st.result.capacityHits.length, 1); assert.equal(st.result.capacityHits[0].maxMl, 600);
  ok("ずっと容量超過でも、AI呼び出しは作り直しの上限(" + MAX_ATTEMPTS + "回)で止まる(絶対の上限 " + MAX_AI_CALLS + "回以内)。超過の印つきで返す");
}
{ // 家電を登録していないユーザー: 容量チェックは働かず、AIは1回
  const { st } = await runOnce([], [reply(bigSoup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1); assert.equal(st.result.capacityHits, undefined);
  ok("家電なしのユーザーは、従来どおりAI呼び出し1回(費用は増えない)");
}
{ // 容量に収まるレシピは、作り直しなし
  const { st } = await runOnce([POT], [reply(smallSoup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1);
  ok("容量に収まるレシピは、AI呼び出し1回で完成");
}
{ // 状況の取得(画面の更新)ではAIを呼ばない
  const env = makeEnv(), deps = makeDeps([POT]); setScript([reply(smallSoup)]);
  const r = await startJob(env, user, { count: 1 }, deps);
  for (let i = 0; i < 5; i++) await getJobState(env, user, r.body.jobId, deps);
  assert.equal(aiCalls.length, 0);
  ok("ジョブ開始と状況取得ではAIを呼ばない(AI呼び出し0回)");
}

console.log("\n" + passed + " 件 PASS(実際のAIへの通信: 0件。偽のAI経由 " + "のみ)");
