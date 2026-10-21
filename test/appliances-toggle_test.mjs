// 「調理家電を使う/使わない」スイッチ(request.useAppliances)のテスト。
// 【重要】実際のAI(xAI・有料)は一切呼びません。通信(fetch)は偽物に差し替え、本物の通信は禁止しています。
//   ・fetch は「偽のxAI」だけ。ほかのURLへの通信、台本にない呼び出しはテストを失敗させる
//   ・AIのAPIキーはダミー。DBはメモリ上の node:sqlite
//   ・本番のプロンプト作成(buildPrompt)と入力チェック(parseCreateRequest)は本物を使い、AIへ送る文面に家電が入る/入らないを確かめる
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { startJob, runJob, getJobState, MAX_AI_CALLS } from "../functions/_lib/recipe-job.js";
import { parseCreateRequest, buildPrompt, buildRetryPrompt } from "../functions/_lib/recipe-prompt.js";
import { findCapacityHits } from "../functions/_lib/appliance-capacity.js";
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

const POT = { name: "レコルト 調理ポット", policy: "optional", note: "", spec: { capacity: "600ml(300ml〜Maxライン)", modes: [], ranges: "", cautions: [] } };
const ing = (name, amount, grams) => ({ name, amount, grams, food: "" });
const soup = {
  name: "かぼちゃ豆乳ポタージュ", appliance: "レコルト 調理ポット",
  ingredientDetails: [ing("かぼちゃ", "150g", 150), ing("無調整豆乳", "250ml", 258), ing("塩", "小さじ1/2", 3)],
  steps: ["ポットに材料を入れる"],
};
const reply = (d) => JSON.stringify([d]);
const BASE = { count: 1, targets: { protein: 78 } };

// ==== A. 入力チェック(parseCreateRequest。AIは関係しない) ====
{
  assert.equal(parseCreateRequest({ ...BASE }).value.useAppliances, undefined);                        // 未指定 = 従来どおり使う
  assert.equal(parseCreateRequest({ ...BASE, useAppliances: true }).value.useAppliances, undefined);   // true も「使う」(印は付けない)
  assert.equal(parseCreateRequest({ ...BASE, useAppliances: null }).value.useAppliances, undefined);
  assert.equal(parseCreateRequest({ ...BASE, useAppliances: false }).value.useAppliances, false);     // 使わない
  for (const bad of ["false", 0, 1, "no", {}, []]) {
    assert.ok(parseCreateRequest({ ...BASE, useAppliances: bad }).error, "boolean 以外は不正: " + JSON.stringify(bad));
  }
  ok("useAppliances: 未指定/true/null は従来どおり、false だけ「使わない」。boolean 以外は400");
}

// ==== B. プロンプト(本物の buildPrompt) ====
{
  const base = parseCreateRequest(BASE).value;
  const withApp = buildPrompt({ ...base, appliances: [POT] });
  const without = buildPrompt({ ...base, appliances: [] });
  assert.match(withApp, /使える調理家電/); assert.match(withApp, /レコルト 調理ポット/);
  assert.doesNotMatch(without, /使える調理家電/); assert.doesNotMatch(without, /レコルト 調理ポット/);
  assert.equal(without, buildPrompt(base), "家電なし = 従来と同一");
  assert.doesNotMatch(buildRetryPrompt({ ...base, appliances: [] }, [soup], { ok: false, worst: 20, results: [] }, [], []), /使える調理家電/);
  ok("プロンプト: 家電ありのときだけ【使える調理家電】が入り、なしのときは従来と同一");
}

// ==== C. ジョブ全体(偽のAI・メモリDB) ====
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
  const state = { loadAppliancesCalls: 0 };
  return {
    state, stream: false,
    parseCreateRequest, buildPrompt, buildRetryPrompt,                   // 本物
    checkTargets: () => ({ ok: true, worst: 0, results: [{ id: "protein", label: "たんぱく質", unit: "g", target: 78, total: 78, min: 70, max: 86, diffPct: 0, ok: true }] }),
    maxTokensFor: () => 4000, parseDishes: (c) => JSON.parse(c), TOLERANCE: 0.1, attachNutrition: async () => {},
    createTrace: (e) => createTrace(e),
    loadAiSettings: async () => ({ model: "grok-test", dailyLimit: 50, hasKey: true, apiKey: "xai-test-dummykey-0000", keyError: false }),
    reserveUsage: async () => ({ ok: true, day: "d" }), refundUsage: async () => {}, isAdminUser: () => false,
    loadExcludedFoods: async () => [], findExcludedHits: () => [], loadPersonalNotes: async () => [],
    loadAppliances: async () => { state.loadAppliancesCalls++; return appliances; }, findCapacityHits,
  };
}
const user = { id: "u1" };
async function runOnce(body, appliances, replies) {
  const env = makeEnv(), deps = makeDeps(appliances); setScript(replies);
  const r = await startJob(env, user, body, deps); assert.equal(r.status, 200, JSON.stringify(r.body));
  await runJob(env, user, r.body.jobId, deps);
  const st = (await getJobState(env, user, r.body.jobId, deps)).body;
  return { st, deps, row: env.db.prepare("SELECT * FROM recipe_jobs WHERE id = ?").get(r.body.jobId) };
}
const promptOf = (call) => call.messages.map((m) => m.content).join("\n");

{ // スイッチ未指定(従来): 家電を読み、AIへの文面に入る。AIは1回
  const { st, deps } = await runOnce({ ...BASE }, [POT], [reply(soup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1); assert.equal(deps.state.loadAppliancesCalls, 1);
  assert.match(promptOf(aiCalls[0]), /使える調理家電/); assert.match(promptOf(aiCalls[0]), /レコルト 調理ポット/);
  ok("未指定(使う): 家電をDBから読み、AIへの依頼に入る(AI呼び出し1回)");
}
{ // useAppliances:true も同じ
  const { st } = await runOnce({ ...BASE, useAppliances: true }, [POT], [reply(soup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1); assert.match(promptOf(aiCalls[0]), /使える調理家電/);
  ok("true(使う): 従来どおり");
}
{ // 使わない: 家電を読まず、AIへの文面にも入らず、保存済みの条件にも残らない
  const { st, deps, row } = await runOnce({ ...BASE, useAppliances: false }, [POT], [reply(soup)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1);
  assert.equal(deps.state.loadAppliancesCalls, 0, "DBから家電を読まない");
  assert.doesNotMatch(promptOf(aiCalls[0]), /使える調理家電/); assert.doesNotMatch(promptOf(aiCalls[0]), /レコルト 調理ポット/);
  assert.doesNotMatch(promptOf(aiCalls[0]), /applianceMl/, "容量の指示も入らない");
  const req = JSON.parse(row.request);
  assert.deepEqual(req.appliances, []); assert.equal(req.useAppliances, false);
  ok("使わない: 家電を読まず、AIへの依頼にも保存した条件にも入らない(AI呼び出し1回)");
}
{ // 使わない + 容量を超えるレシピ: 容量チェックが働かず、作り直しにならない(AIは1回のまま)
  const big = { ...soup, ingredientDetails: [ing("かぼちゃ", "400g", 400), ing("無調整豆乳", "700ml", 720)] };
  const on = await runOnce({ ...BASE }, [POT], [reply(big)]);
  assert.ok(aiCalls.length > 1, "使う場合は容量超過で作り直しになる(比較用)");
  const off = await runOnce({ ...BASE, useAppliances: false }, [POT], [reply(big)]);
  assert.equal(off.st.status, "done"); assert.equal(aiCalls.length, 1); assert.equal(off.st.result.capacityHits, undefined);
  assert.ok(on.st.status === "done");
  ok("使わない: 容量チェックも働かず、作り直しが増えない(AI呼び出し1回)");
}
{ // どの場合も、1ジョブのAI呼び出しは絶対の上限以内。ジョブ開始と状況取得ではAIを呼ばない
  const env = makeEnv(), deps = makeDeps([POT]); setScript([reply(soup)]);
  const r = await startJob(env, user, { ...BASE, useAppliances: false }, deps);
  for (let i = 0; i < 5; i++) await getJobState(env, user, r.body.jobId, deps);
  assert.equal(aiCalls.length, 0);
  const { row } = await runOnce({ ...BASE, useAppliances: false }, [POT], [reply(soup)]);
  assert.ok(row.ai_calls <= MAX_AI_CALLS);
  ok("ジョブ開始・状況取得ではAIを呼ばない(0回)。AI呼び出しは上限(" + MAX_AI_CALLS + "回)以内");
}

console.log("\n" + passed + " 件 PASS(実際のAIへの通信: 0件。偽のAI経由のみ)");
