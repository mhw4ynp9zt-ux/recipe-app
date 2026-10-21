// 「買い足しOK」スイッチ(request.onlyListed。OFF=手持ちの食材だけで作る)のサーバー側テスト。
// 【重要】実際のAI(xAI・有料)は一切呼びません。
//   ・http/https の送信系を遮断し、fetch は「偽のxAI」だけ(ほかのURL・台本にない呼び出しは失敗)
//   ・AIのAPIキーはダミー。DBはメモリ上の node:sqlite
//   ・入力チェック(parseCreateRequest)とプロンプト(buildPrompt / buildRetryPrompt)は本物を使い、AIへ送る文面を確かめる
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { DatabaseSync } from "node:sqlite";
import { startJob, runJob, getJobState, MAX_ATTEMPTS, MAX_AI_CALLS } from "../functions/_lib/recipe-job.js";
import { parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor } from "../functions/_lib/recipe-prompt.js";
import { findCapacityHits } from "../functions/_lib/appliance-capacity.js";
import { createTrace } from "../functions/_lib/debug-trace.js";

const block = (w) => () => { throw new Error("network blocked in tests: " + w); };
for (const [n, m] of [["http", http], ["https", https]]) { m.request = block(n + ".request"); m.get = block(n + ".get"); }
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
const BASE = { count: 1, targets: { protein: 78 } };
const parse = (extra) => parseCreateRequest({ ...BASE, ...extra });
const RULE = "【手持ちの食材だけで作る】";
const dish = (protein) => ({ name: "鶏キャベツ炒め", type: "炒め物", ingredients: [{ name: "鶏むね肉", amount: "200g", grams: 200, food: "" }], steps: ["炒める"], protein });
const reply = (protein) => JSON.stringify([dish(protein)]);

// A. 入力チェック
{
  assert.equal(parse({}).value.onlyListed, undefined);
  assert.equal(parse({ onlyListed: null }).value.onlyListed, undefined);
  assert.equal(parse({ onlyListed: false }).value.onlyListed, undefined);   // false = 従来どおり(印は付けない)
  assert.equal(parse({ onlyListed: true }).value.onlyListed, true);
  for (const bad of ["true", "false", 0, 1, {}, [], "no"]) assert.ok(parse({ onlyListed: bad }).error, "boolean 以外は不正: " + JSON.stringify(bad));
  ok("onlyListed: 未指定/null/false は従来どおり、true だけ有効。boolean 以外は400");
}

// B. プロンプト: 食材の指定があるときだけ入る。ないときは従来と同一
{
  const withIng = parse({ ingredients: "鶏むね肉 キャベツ", onlyListed: true }).value;
  const p = buildPrompt(withIng);
  assert.ok(p.includes(RULE) && p.includes("書かれていない食材は足さない"));
  assert.ok(p.indexOf("【必ず守る条件】") < p.indexOf(RULE) && p.indexOf(RULE) < p.indexOf("・油はごま油"));
  assert.equal(buildPrompt(parse({ ingredients: "鶏むね肉 キャベツ" }).value).includes(RULE), false, "OFFでなければ入らない");
  assert.equal(buildPrompt(parse({ ingredients: "鶏むね肉 キャベツ", onlyListed: false }).value), buildPrompt(parse({ ingredients: "鶏むね肉 キャベツ" }).value), "false = 従来と同一");
  // 食材の指定が無いときは、制限する元がないので入らない(従来と同一)
  assert.equal(buildPrompt(parse({ onlyListed: true }).value), buildPrompt(parse({}).value));
  // 2品: 食材を指定した品があるときだけ。品ごとの文
  const two = parse({ count: 2, dishes: [{ ingredients: "鶏むね肉" }, {}], onlyListed: true }).value;
  const p2 = buildPrompt(two);
  assert.ok(p2.includes(RULE) && p2.includes("「使う食材」が指定された品は"));
  assert.equal(buildPrompt(parse({ count: 2, dishes: [{ mood: "和風" }, {}], onlyListed: true }).value), buildPrompt(parse({ count: 2, dishes: [{ mood: "和風" }, {}] }).value), "どの品にも食材の指定が無ければ入らない");
  assert.ok(p.length < 6000, "プロンプト長 " + p.length);
  ok("プロンプト: 食材の指定があり OFF のときだけ条件が入る。それ以外は従来と同一");
}

// C. 作り直しの依頼文: 食材を足させない
{
  const metrics = [{ id: "protein", label: "たんぱく質", unit: "g", target: 78 }];
  const bad = checkTargets([{ protein: 20 }], metrics);
  const dishes = [{ name: "A", ingredientDetails: [{ name: "鶏肉", grams: 100, contrib: { protein: 20 } }] }];
  const on = buildRetryPrompt(parse({ ingredients: "鶏肉", onlyListed: true }).value, dishes, bad);
  const off = buildRetryPrompt(parse({ ingredients: "鶏肉" }).value, dishes, bad);
  assert.ok(on.includes("書かれていない食材を足したり"));
  assert.equal(on.includes("食材の追加・入れ替えをしてください"), false, "食材の追加を許す文は入らない");
  assert.ok(off.includes("食材の追加・入れ替えをしてください") && !off.includes(RULE), "従来は変わらない");
  ok("作り直しの依頼文: OFFのときは、grams の調整だけで直させ、食材の追加を許さない");
}

// D. ジョブ全体: AIは偽物。OFFでも呼び出し回数の上限は変わらない
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
const makeDeps = () => ({
  stream: false, parseCreateRequest, buildPrompt, buildRetryPrompt, checkTargets, maxTokensFor, TOLERANCE: 0.1,
  parseDishes: (c) => JSON.parse(c), attachNutrition: async (_e, ds) => { ds.forEach((d) => { d.ingredientDetails = d.ingredients; }); },
  createTrace: (e) => createTrace(e),
  loadAiSettings: async () => ({ model: "grok-test", dailyLimit: 50, hasKey: true, apiKey: "xai-test-dummykey-0000", keyError: false }),
  reserveUsage: async () => ({ ok: true, day: "d" }), refundUsage: async () => {}, isAdminUser: () => false,
  loadExcludedFoods: async () => [], findExcludedHits: () => [], loadPersonalNotes: async () => [], loadAppliances: async () => [], findCapacityHits,
});
const user = { id: "u1" };
async function runOnce(body, replies) {
  const env = makeEnv(), deps = makeDeps(); setScript(replies);
  const r = await startJob(env, user, body, deps); assert.equal(r.status, 200, JSON.stringify(r.body));
  await runJob(env, user, r.body.jobId, deps);
  return { st: (await getJobState(env, user, r.body.jobId, deps)).body, row: env.db.prepare("SELECT * FROM recipe_jobs WHERE id = ?").get(r.body.jobId) };
}
const promptOf = (call) => call.messages.map((m) => m.content).join("\n");
{
  const { st, row } = await runOnce({ ...BASE, ingredients: "鶏むね肉 キャベツ", onlyListed: true }, [reply(78)]);
  assert.equal(st.status, "done"); assert.equal(aiCalls.length, 1);
  assert.ok(promptOf(aiCalls[0]).includes(RULE)); assert.equal(JSON.parse(row.request).onlyListed, true);
  ok("OFF: AIへの依頼に条件が入り、AI呼び出しは1回");
}
{
  // 目標に届かない返答が続いても、OFFでも上限(MAX_ATTEMPTS / MAX_AI_CALLS)を超えない。作り直しの依頼文にも「足さない」が入る
  const { st } = await runOnce({ ...BASE, ingredients: "鶏むね肉 キャベツ", onlyListed: true }, [reply(20)]);
  assert.equal(st.status, "done"); assert.equal(st.result.targetCheck.ok, false);
  assert.ok(aiCalls.length <= MAX_ATTEMPTS && aiCalls.length <= MAX_AI_CALLS, "AI呼び出し " + aiCalls.length);
  assert.equal(aiCalls.length, MAX_ATTEMPTS, "従来と同じ回数(上限まで)で止まる");
  assert.ok(promptOf(aiCalls[aiCalls.length - 1]).includes("書かれていない食材を足したり"));
  const on = await runOnce({ ...BASE, ingredients: "鶏むね肉 キャベツ" }, [reply(20)]);
  assert.equal(aiCalls.length, MAX_ATTEMPTS, "ON(従来)でも同じ回数");
  assert.equal(on.st.status, "done");
  assert.equal(MAX_ATTEMPTS, 3); assert.equal(MAX_AI_CALLS, 4); assert.equal(maxTokensFor(1), 1800);
  ok("目標に届かないときも、AI呼び出しの上限は従来と同じ(最大" + MAX_ATTEMPTS + "回)。トークン上限・各定数は変更なし");
}
{
  const env = makeEnv(), deps = makeDeps(); setScript([reply(78)]);
  const r = await startJob(env, user, { ...BASE, onlyListed: "yes" }, deps);
  assert.equal(r.status, 400); assert.equal(aiCalls.length, 0);
  ok("不正な値は400で、AIは呼ばれない");
}
console.log("\n" + passed + " passed(AI呼び出しは偽物のみ)");
