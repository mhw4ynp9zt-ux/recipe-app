// 「使わない食材を今回だけ外す」スイッチ(request.useExcludedFoods)のテスト。
// 【重要】実際のAI(xAI・有料)は一切呼びません。fetch は偽のxAIだけ。APIキーはダミー、DBはメモリ上の node:sqlite。
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { startJob, runJob, getJobState, MAX_AI_CALLS, MAX_ATTEMPTS } from "../functions/_lib/recipe-job.js";
import { parseCreateRequest, buildPrompt, buildRetryPrompt } from "../functions/_lib/recipe-prompt.js";
import { createTrace } from "../functions/_lib/debug-trace.js";

const aiCalls = [];
let script = [];
globalThis.fetch = async (url, opts = {}) => {
  assert.equal(String(url), "https://api.x.ai/v1/chat/completions", "xAI以外への通信は禁止: " + url);
  aiCalls.push(JSON.parse(opts.body));
  const step = script[aiCalls.length - 1] ?? script[script.length - 1];
  if (!step) throw new Error("台本がありません(想定外のAI呼び出し)");
  return new Response(JSON.stringify({ choices: [{ message: { content: step } }] }), { status: 200, headers: { "content-type": "application/json" } });
};
let passed = 0;
const ok = (n) => { passed++; console.log("  ✓ " + n); };
const setScript = (s) => { aiCalls.length = 0; script = s; };

const ing = (name, amount, grams) => ({ name, amount, grams, food: "" });
const dish = { name: "鶏むねの塩焼き", ingredientDetails: [ing("鶏むね肉", "200g", 200), ing("塩", "小さじ1/2", 3)], steps: ["焼く"] };
const reply = JSON.stringify([dish]);
const BASE = { count: 1, targets: { protein: 78 } };

{ // A. 入力チェック
  assert.equal(parseCreateRequest({ ...BASE }).value.useExcludedFoods, undefined);
  assert.equal(parseCreateRequest({ ...BASE, useExcludedFoods: true }).value.useExcludedFoods, undefined);
  assert.equal(parseCreateRequest({ ...BASE, useExcludedFoods: null }).value.useExcludedFoods, undefined);
  assert.equal(parseCreateRequest({ ...BASE, useExcludedFoods: false }).value.useExcludedFoods, false);
  for (const bad of ["false", 0, 1, {}, []]) assert.ok(parseCreateRequest({ ...BASE, useExcludedFoods: bad }).error, JSON.stringify(bad));
  ok("入力チェック: 未指定/true/null は従来どおり、false だけ「外す」。boolean 以外は400");
}

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
function makeDeps() {
  const state = { loadExcludedCalls: 0 };
  return {
    state, stream: false, parseCreateRequest, buildPrompt, buildRetryPrompt,
    checkTargets: () => ({ ok: true, worst: 0, results: [{ id: "protein", label: "たんぱく質", unit: "g", target: 78, total: 78, min: 70, max: 86, diffPct: 0, ok: true }] }),
    maxTokensFor: () => 4000, parseDishes: (c) => JSON.parse(c), TOLERANCE: 0.1, attachNutrition: async () => {},
    createTrace: (e) => createTrace(e),
    loadAiSettings: async () => ({ model: "grok-test", dailyLimit: 50, hasKey: true, apiKey: "xai-test-dummykey-0000", keyError: false }),
    reserveUsage: async () => ({ ok: true, day: "d" }), refundUsage: async () => {}, isAdminUser: () => false,
    loadExcludedFoods: async () => { state.loadExcludedCalls++; return ["エビ"]; },
    findExcludedHits: () => [], loadPersonalNotes: async () => [], loadAppliances: async () => [], findCapacityHits: () => [],
  };
}
const user = { id: "u1" };
async function runOnce(body) {
  const env = makeEnv(), deps = makeDeps(); setScript([reply]);
  const r = await startJob(env, user, body, deps); assert.equal(r.status, 200, JSON.stringify(r.body));
  await runJob(env, user, r.body.jobId, deps);
  const st = (await getJobState(env, user, r.body.jobId, deps)).body;
  return { st, deps, row: env.db.prepare("SELECT * FROM recipe_jobs WHERE id = ?").get(r.body.jobId) };
}
const promptOf = (c) => c.messages.map((m) => m.content).join("\n");

{
  const { st, deps } = await runOnce({ ...BASE });
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1); assert.equal(deps.state.loadExcludedCalls, 1);
  assert.match(promptOf(aiCalls[0]), /使わない食材/); assert.match(promptOf(aiCalls[0]), /エビ/);
  ok("未指定: 登録済みの使わない食材を読み、AIへの依頼に入る(AI1回)");
}
{
  const { st, deps, row } = await runOnce({ ...BASE, useExcludedFoods: false });
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1);
  assert.equal(deps.state.loadExcludedCalls, 0, "DBから読まない");
  assert.doesNotMatch(promptOf(aiCalls[0]), /使わない食材/); assert.doesNotMatch(promptOf(aiCalls[0]), /エビ/);
  assert.deepEqual(JSON.parse(row.request).excluded, []);
  ok("外す(false): 読まず、AIへの依頼にも保存条件にも入らない(AI1回)");
}
{
  const env = makeEnv(), deps = makeDeps(); setScript([reply]);
  const r = await startJob(env, user, { ...BASE, useExcludedFoods: false }, deps);
  for (let i = 0; i < 5; i++) await getJobState(env, user, r.body.jobId, deps);
  assert.equal(aiCalls.length, 0, "開始・状況取得ではAIを呼ばない");
  const { row } = await runOnce({ ...BASE, useExcludedFoods: false });
  assert.ok(row.ai_calls <= MAX_AI_CALLS);
  assert.equal(MAX_ATTEMPTS, 3); assert.equal(MAX_AI_CALLS, 4);
  ok("開始・状況取得でAI 0回。上限は変更なし(MAX_ATTEMPTS=3, MAX_AI_CALLS=4)");
}
console.log("\n" + passed + " 件 PASS(実際のAIへの通信: 0件)");
