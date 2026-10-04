// AIレシピ作成を「ジョブ」として進める処理(開始・状況取得・実行)。
//
// 目的
//   ・画面を離れても(アプリ切替・ロック)、戻ったときに続きの進捗・結果を受け取れるようにする
//   ・進捗をパーセントで返す(AIの出力量から実測 + 段階ごとの区切り)
//
// 流れ
//   1. startJob   … 入力を検証し、1日の利用回数を確保してジョブを作る(ここではAIを呼ばない)
//   2. runJob     … ジョブを実行する。AIを呼び(ストリーミング)、栄養計算し、目標に収まらなければ作り直す
//   3. getJobState… 状況を返す(読むだけ。AIは呼ばない=何回呼ばれても費用は発生しない)
//
// 費用(AIの呼び出し)を増やさないための決まり
//   ・AIを呼ぶのは runJob だけ。呼ぶ「前」に ai_calls を加算して保存する(途中で止まっても数え漏れない)
//   ・1つのジョブでAIを呼べる回数は MAX_AI_CALLS まで(通信が切れて引き継いだ場合も含めた絶対の上限)
//   ・同じジョブを同時に動かさない(lease_until による排他。取れなかったリクエストは何もせず状況だけ返す)
//   ・実行中のジョブがあるユーザーが新しく作ろうとしたら、新しいジョブは作らず実行中のものを返す
//   ・利用回数は、ユーザーの操作1回=1回(作り直しや引き継ぎは数え直さない)。失敗したら戻す
//
// ユーザーごとの「使わない食材」(設定タブで登録)
//   ・startJob がDBから読み(読むだけ。AIは呼ばない)、ジョブの条件(request.excluded)に入れる。AIへの指示は buildPrompt が作る
//   ・AIが指示を守らず、使わない食材をレシピに入れてしまったら、目標を外れたときと同じ「作り直し」の対象にする。
//     作り直しの回数・AI呼び出しの上限(MAX_ATTEMPTS / MAX_AI_CALLS)は変わらない(=費用の上限も変わらない)
//   ・上限まで作り直しても残ったときは、result.excludedHits で画面に知らせる
//
// ユーザーごとの「個人的な要望」(設定タブで登録。調理環境・好み)
//   ・startJob がDBから読み(読むだけ。AIは呼ばない)、ジョブの条件(request.personalNotes)に入れる。画面から送られた値は使わない
//   ・AIへの指示は buildPrompt / buildRetryPrompt が作る。守れたかどうかはコードで判定できないため、作り直しの条件には使わない
//     (=AIの呼び出し回数は、要望の有無で変わらない。MAX_ATTEMPTS / MAX_AI_CALLS も変わらない)
//
// ユーザーごとの「使っている調理家電」(設定タブで登録。名前・できる操作・使い方の方針・補足)
//   ・startJob がDBから読み(読むだけ。AIは呼ばない)、ジョブの条件(request.appliances)に入れる。画面から送られた値は使わない
//   ・AIへの指示は buildPrompt / buildRetryPrompt が作る。守れたかどうかはコードで判定できないため、作り直しの条件には使わない
//     (=AIの呼び出し回数は、家電の有無で変わらない。MAX_ATTEMPTS / MAX_AI_CALLS も変わらない)
//
// 依存(AI設定・プロンプト・栄養計算など)は deps で受け取る。本番は recipe-job-deps.js の defaultDeps、
// テストでは偽物を渡して、実際のAI(有料)を呼ばずに動かせる。

export const MAX_ATTEMPTS = 3;                  // 目標に収まらないとき、最大で何回作るか(最初の1回を含む)
export const MAX_AI_CALLS = MAX_ATTEMPTS + 1;   // 1ジョブでAIを呼べる絶対の上限(引き継ぎで1回無駄になっても超えない)
const AI_URL = "https://api.x.ai/v1/chat/completions";
// AIの1回の呼び出しの上限。考える時間が長いモデル(reasoning)は、返答を書き始める前に1分近く考えることがある。
// 途中で打ち切ると、それまでの分の料金だけかかって結果が得られないため、従来(60秒)より少し長めにする。
const AI_TIMEOUT_MS = 90000;
const RETRY_START_LIMIT_MS = 50000;     // 処理を始めてからこれを過ぎていたら、作り直しはせず今ある最良の結果を返す
const HEARTBEAT_MS = 8000;              // 実行中の印(lease)と進捗をD1へ書く間隔(D1のクエリ数を抑えるため間隔は長め)
const LEASE_MS = 25000;                 // この時間更新が無ければ「止まった」とみなし、別のリクエストが引き継げる
const RESUME_WINDOW_MS = 15 * 60 * 1000; // この時間内の実行中ジョブがあれば、新規作成ではなくそれを返す
const JOB_KEEP_MS = 24 * 60 * 60 * 1000; // ジョブは1日で削除する
const EXPECTED_CHARS_PER_DISH = 1300;   // AIの返答の長さの見込み(1品あたり。進捗%の目安。作り直しは前回の実測値を使う)
const MAX_TRACE_EVENTS = 120;

// 進捗%の割り当て。AIが返答を書いている間は from→to を出力量に応じて進め、
// 栄養計算と目標チェックが済んだ時点で done まで進む。作り直しが入った場合は次の区間へ。
// 100%になるのは完成したときだけ。
const PLAN = [
  { from: 3, to: 72, done: 80 },
  { from: 80, to: 90, done: 94 },
  { from: 94, to: 98, done: 99 },
];
const planFor = (attempt) => PLAN[Math.min(Math.max(attempt, 1), PLAN.length) - 1];

const parse = (text, fallback = null) => {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (e) { return fallback; }
};

// ==== DBの操作 ====

async function run(env, sql, ...args) {
  const res = await env.DB.prepare(sql).bind(...args).run();
  return (res && res.meta && res.meta.changes) || 0;
}

async function loadJob(env, id) {
  return env.DB.prepare("SELECT * FROM recipe_jobs WHERE id = ?").bind(id).first();
}

async function loadOwnJob(env, id, userId) {
  const job = await loadJob(env, id);
  return job && job.user_id === userId ? job : null;
}

// 状況の取得(1秒ごとに呼ばれる)用。作り直し用の会話(messages)・途中の結果(best)・条件(request)は大きいので読まない
async function loadJobForState(env, id, userId) {
  const job = await env.DB.prepare(
    `SELECT id, user_id, status, stage, progress, attempt, lease_until, created_at, active_ms, error, result, trace
     FROM recipe_jobs WHERE id = ?`
  ).bind(id).first();
  return job && job.user_id === userId ? job : null;
}

async function acquireLease(env, id, now) {
  const changes = await run(env,
    "UPDATE recipe_jobs SET lease_until = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_until < ?",
    now + LEASE_MS, now, id, now);
  return changes > 0;
}

// ==== 画面に返す状況 ====

function publicState(job, { isAdmin = false, now = Date.now() } = {}) {
  const state = {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.status === "done" ? 100 : Math.min(job.progress, 99),
    attempt: job.attempt,
    // 実行中なのに誰も処理していない(通信が切れた・画面を離れた)。画面側が続きを動かす合図
    stalled: job.status === "running" && job.lease_until < now,
  };
  const events = isAdmin ? parse(job.trace, []) : [];
  const hasProblems = events.some((ev) => ev && ev.level !== "info");
  const makeDebug = () => ({
    startedAt: new Date(job.created_at).toISOString(),
    elapsedMs: job.active_ms,
    level: hasProblems ? "warn" : "info",
    events,
  });
  if (job.status === "done") {
    const result = parse(job.result, {});
    // 管理者には、問題があったとき・作り直しが入ったときだけ詳細を付ける(一般ユーザーには一切返さない)
    if (isAdmin && (hasProblems || (result.targetCheck && result.targetCheck.attempts > 1))) result.debug = makeDebug();
    state.result = result;
  } else if (job.status === "error") {
    const err = parse(job.error, {});
    state.error = err.message || "レシピの作成に失敗しました。もう一度お試しください";
    state.httpStatus = err.status || 502;
    if (isAdmin && events.length) state.debug = makeDebug();
  }
  return state;
}

// ==== ジョブの開始 ====

// body が null(JSONとして読めなかった)の場合は 400。返り値: { status, body }
async function startJob(env, user, body, deps, now = Date.now()) {
  const isAdmin = deps.isAdminUser(env, user);
  const trace = deps.createTrace(isAdmin);
  const fail = (message, status) => {
    const out = { error: message };
    if (trace.enabled) out.debug = trace.dump();
    return { status, body: out };
  };

  if (body === null || body === undefined) {
    trace.add("request_json_error", {}, "error");
    return fail("リクエストが不正です", 400);
  }
  // 入力チェックは回数を消費する前に行う(不正な入力で1日の枠を減らさない)
  const parsed = deps.parseCreateRequest(body);
  if (parsed.error) {
    trace.add("request_invalid", { message: parsed.error }, "error");
    return fail(parsed.error, 400);
  }
  const req = parsed.value;

  // 古いジョブを掃除する
  await run(env, "DELETE FROM recipe_jobs WHERE created_at < ?", now - JOB_KEEP_MS);

  // 実行中のジョブがあれば、新しく作らずそれを返す(二重タップや再読み込みでAIを重ねて呼ばないため)
  const running = await env.DB.prepare(
    "SELECT * FROM recipe_jobs WHERE user_id = ? AND status = 'running' AND created_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(user.id, now - RESUME_WINDOW_MS).first();
  if (running) {
    return { status: 200, body: { jobId: running.id, resumed: true, status: "running", progress: running.progress } };
  }

  // ユーザーごとに登録された「使わない食材」を読む(DBを読むだけ。AIは呼ばない)。
  // 画面からは受け取らない(本人の登録内容だけが使われる)。読めなかったときは、除外が効かないまま作らないよう、
  // 利用回数を消費する前に失敗にする。
  try {
    req.excluded = deps.loadExcludedFoods ? await deps.loadExcludedFoods(env, user.id) : [];
  } catch (e) {
    console.error("loadExcludedFoods failed: " + (e && e.message));
    trace.error("load_excluded_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }

  // ユーザーごとに登録された「個人的な要望」(調理環境・好み)を読む(DBを読むだけ。AIは呼ばない)。
  // 「使わない食材」と同じく、画面からは受け取らず(本人の登録内容だけが使われる)、読めなかったときは、
  // 要望が効かないまま作らないよう、利用回数を消費する前に失敗にする。
  try {
    req.personalNotes = deps.loadPersonalNotes ? await deps.loadPersonalNotes(env, user.id) : [];
  } catch (e) {
    console.error("loadPersonalNotes failed: " + (e && e.message));
    trace.error("load_personal_notes_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }

  // ユーザーごとに登録された「使っている調理家電」を読む(DBを読むだけ。AIは呼ばない)。
  // 「個人的な要望」と同じく、画面からは受け取らず(本人の登録内容だけが使われる)、読めなかったときは、
  // 家電が効かないまま作らないよう、利用回数を消費する前に失敗にする。
  try {
    req.appliances = deps.loadAppliances ? await deps.loadAppliances(env, user.id) : [];
  } catch (e) {
    console.error("loadAppliances failed: " + (e && e.message));
    trace.error("load_appliances_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }

  let ai;
  try {
    ai = await deps.loadAiSettings(env, { decrypt: true });
  } catch (e) {
    console.error("loadAiSettings failed: " + (e && e.message));
    trace.error("load_settings_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }
  if (ai.apiKey) trace.addSecret(ai.apiKey);
  trace.add("start", {
    model: ai.model, hasKey: ai.hasKey, keyError: ai.keyError, dailyLimit: ai.dailyLimit,
    count: req.count,
    targets: req.metrics.map((m) => m.id + "=" + m.target + m.unit),
    ingredientsChars: req.ingredients.length, moodChars: req.mood.length,
    excludedCount: req.excluded.length,
    personalNotesCount: req.personalNotes.length,
    appliancesCount: req.appliances.length,
  });
  if (!ai.apiKey) {
    trace.add("no_api_key", { reason: ai.keyError ? "保存済みのAPIキーを復号できません(SETTINGS_ENC_KEYが変わった可能性)" : "APIキーが未設定です" }, "error");
    return fail("AI機能がまだ設定されていません。管理者に連絡してください", 503);
  }

  let reservation;
  try {
    reservation = await deps.reserveUsage(env, ai.dailyLimit);
  } catch (e) {
    console.error("reserveUsage failed: " + (e && e.message));
    trace.error("reserve_usage_failed", e);
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }
  if (!reservation.ok) {
    trace.add("daily_limit", { dailyLimit: ai.dailyLimit }, "error");
    return fail("本日のAI利用回数の上限に達しました。明日またお試しください", 429);
  }

  const id = crypto.randomUUID();
  try {
    await run(env,
      `INSERT INTO recipe_jobs (id, user_id, status, stage, progress, request, trace, usage_day, created_at, updated_at)
       VALUES (?, ?, 'running', 'queued', 0, ?, ?, ?, ?, ?)`,
      id, user.id, JSON.stringify(req), isAdmin ? JSON.stringify(trace.dump().events) : null, reservation.day, now, now);
  } catch (e) {
    await deps.refundUsage(env, reservation.day); // ジョブを作れなかったので、確保した1回分を戻す
    console.error("createJob failed: " + (e && e.message));
    trace.error("create_job_failed", e, { refunded: true });
    return fail("サーバーでエラーが発生しました。もう一度お試しください", 500);
  }
  return { status: 200, body: { jobId: id, resumed: false, status: "running", progress: 0 } };
}

// ==== 状況の取得(読むだけ。AIは呼ばない) ====

async function getJobState(env, user, jobId, deps, now = Date.now()) {
  const job = await loadJobForState(env, jobId, user.id);
  if (!job) return { status: 404, body: { error: "作成中のレシピが見つかりません" } };
  return { status: 200, body: publicState(job, { isAdmin: deps.isAdminUser(env, user), now }) };
}

// ==== AIの呼び出し(ストリーミング) ====

// 成功: { content } / HTTPエラー: { status, body } / 通信失敗・タイムアウト・空の返答は例外
// onChars(これまでに受け取った文字数) を受け取るたびに呼ぶ(進捗%の計算用。ストリーミングのときだけ)
// deps.stream が true のときだけストリーミングで受け取る。既定は従来どおり(stream指定なし・一度に受け取る)。
//   ストリーミングにすると、使っているAIによっては完成まで従来より時間がかかることがあったため、既定では使わない。
// stats(原因調査用): { chars: 受け取った文字数, firstChunkMs: 最初の文字が届くまでの時間, status: HTTPステータス }
async function callAi(ai, messages, count, deps, onChars, stats = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.aiTimeoutMs || AI_TIMEOUT_MS);
  try {
    const doFetch = deps.fetch || globalThis.fetch;
    const res = await doFetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + ai.apiKey },
      body: JSON.stringify({ model: ai.model, max_tokens: deps.maxTokensFor(count), ...(deps.stream === true ? { stream: true } : {}), messages }),
      signal: controller.signal,
    });
    stats.status = res.status;
    stats.headersMs = Date.now() - startedAt;
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch (e) { /* 本文が読めなくても status は返す */ }
      return { status: res.status, body };
    }

    const type = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
    if (deps.stream !== true || !res.body || !type.includes("text/event-stream")) {
      // 通常(一度に受け取る)。ストリーミングを頼んだのに返ってこなかった場合も、ここで受け取る
      const data = await res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error("no text content in response");
      onChars(content.length);
      return { content };
    }

    let content = "";
    const handleLine = (raw) => {
      const line = raw.trim();
      if (!line.startsWith("data:")) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      let chunk;
      try { chunk = JSON.parse(payload); } catch (e) { return; }
      if (chunk.error) throw new Error("stream error: " + (chunk.error.message || JSON.stringify(chunk.error)));
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
      if (typeof delta === "string" && delta) {
        if (!content) stats.firstChunkMs = Date.now() - startedAt;
        content += delta;
        stats.chars = content.length;
        onChars(content.length);
      }
    };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    }
    if (buf) handleLine(buf);
    if (!content) throw new Error("no text content in response");
    return { content };
  } finally {
    clearTimeout(timer);
  }
}

// ==== ジョブの実行 ====

// 結果を確定して完成にする。best: { dishes, nutritionOk, check, hits }
// hits: 使わない食材として登録されているのに、レシピに残ってしまった食材の名前(無ければ空。古いジョブでは未定義)
async function finishJob(env, deps, job, { best, attempts, trace, stepStart, now }) {
  const result = { dishes: best.dishes, nutritionOk: best.nutritionOk };
  if (best.check) {
    result.targetCheck = {
      ok: best.check.ok,
      tolerancePct: Math.round(deps.TOLERANCE * 100),
      attempts,
      results: best.check.results.map(({ id, target, total, min, max, diffPct, ok }) => ({
        id, target, total, min, max, diffPct: Math.round(diffPct * 10) / 10, ok,
      })),
    };
  }
  if (best.hits && best.hits.length) result.excludedHits = best.hits;
  await run(env,
    `UPDATE recipe_jobs SET status = 'done', stage = 'done', progress = 100, result = ?, trace = ?, attempt = ?,
       active_ms = ?, lease_until = 0, updated_at = ? WHERE id = ? AND status = 'running'`,
    JSON.stringify(result), mergedTrace(job, trace, stepStart), attempts, job.active_ms + (now() - stepStart), now(), job.id);
}

// 失敗にする。refund: true なら確保していた利用回数を戻す(二重に戻さないよう、状態が変わったときだけ)
async function failJob(env, deps, job, { message, status, refund, trace, stepStart, now }) {
  trace.add("create_recipe_failed", { message, status, refunded: !!refund }, "error");
  const changes = await run(env,
    `UPDATE recipe_jobs SET status = 'error', stage = 'error', error = ?, trace = ?, active_ms = ?,
       lease_until = 0, updated_at = ? WHERE id = ? AND status = 'running'`,
    JSON.stringify({ message, status }), mergedTrace(job, trace, stepStart), job.active_ms + (now() - stepStart), now(), job.id);
  if (changes > 0 && refund) await deps.refundUsage(env, job.usage_day);
}

// これまでの記録(ジョブ全体の経過時間で並べる)に、このステップの記録を足して文字列にする(管理者のみ)
function mergedTrace(job, trace, stepStart) {
  const dump = trace.dump();
  if (!dump) return null;
  const offset = stepStart - job.created_at;
  const events = (parse(job.trace, []) || []).concat(dump.events.map((ev) => ({ ...ev, t: ev.t + offset })));
  return JSON.stringify(events.slice(0, MAX_TRACE_EVENTS));
}

// 2つの結果のうち、どちらが「より良いか」。使わない食材が残っている数が少ない方を優先し、同じなら目標に近い方。
const hitCount = (b) => (b && b.hits ? b.hits.length : 0);
const isBetter = (a, b) => (hitCount(a) !== hitCount(b) ? hitCount(a) < hitCount(b) : a.check.worst < b.check.worst);

// 1回分(AI呼び出し→栄養計算→目標チェック)。返り値: "continue"(作り直しへ進む) / "end"(完成か失敗で終わった)
// job はメモリ上の最新の状態(呼び出し側が更新して持ち回る)
async function runAttempt(env, deps, job, live, { isAdmin, now }) {
  const req = parse(job.request);
  const n = job.attempt + 1;
  const plan = planFor(n);
  const stepStart = now();
  const trace = deps.createTrace(isAdmin);
  const ctx = { trace, stepStart, now };
  let best = parse(job.best);

  const finish = (b, attempts) => finishJob(env, deps, job, { best: b, attempts, ...ctx });
  const fail = (message, status, refund) => failJob(env, deps, job, { message, status, refund, ...ctx });

  // 費用の上限: これ以上AIは呼ばない
  if (job.ai_calls >= MAX_AI_CALLS) {
    trace.add("ai_call_limit", { aiCalls: job.ai_calls, max: MAX_AI_CALLS }, "warn");
    if (best) { await finish(best, job.attempt); return "end"; }
    await fail("レシピの作成に失敗しました。もう一度お試しください", 502, true);
    return "end";
  }

  const ai = await deps.loadAiSettings(env, { decrypt: true });
  if (ai.apiKey) trace.addSecret(ai.apiKey);
  if (!ai.apiKey) {
    trace.add("no_api_key", {}, "error");
    if (best) { await finish(best, job.attempt); return "end"; }
    await fail("AI機能がまだ設定されていません。管理者に連絡してください", 503, true);
    return "end";
  }

  const messages = parse(job.messages) || [{ role: "user", content: deps.buildPrompt(req) }];
  const expected = job.expected_chars || EXPECTED_CHARS_PER_DISH * req.count;

  // AIを呼ぶ「前」に回数を加算して保存する(途中でリクエストが止まっても数え漏れないように)
  job.ai_calls += 1;
  live.stage = "ai";
  live.progress = Math.max(live.progress, plan.from);
  await run(env,
    "UPDATE recipe_jobs SET ai_calls = ?, stage = 'ai', progress = MAX(progress, ?), updated_at = ? WHERE id = ? AND status = 'running'",
    job.ai_calls, plan.from, now(), job.id);
  trace.add("ai_call", { attempt: n, aiCalls: job.ai_calls });

  let content;
  let dishes;
  const stats = { chars: 0 };
  const aiStartedAt = now();
  live.plan = plan;
  live.aiStartedAt = aiStartedAt;
  live.chars = 0;
  try {
    const r = await callAi(ai, messages, req.count, deps, (chars) => {
      live.chars = chars;
      const frac = Math.min(0.97, chars / expected);
      live.progress = Math.max(live.progress, Math.round(plan.from + (plan.to - plan.from) * frac));
    }, stats);
    if (r.status) {
      trace.add("ai_http_error", { attempt: n, status: r.status, body: r.body, stats }, best ? "warn" : "error");
      if (best) { await finish(best, job.attempt); return "end"; } // 作り直しの途中で失敗したら、ここまでの最良の結果を返す
      console.error("xAI request failed: status " + r.status);
      if (r.status === 401 || r.status === 403) await fail("AIの設定に問題があります。管理者に連絡してください", 503, true);
      else await fail("レシピの作成に失敗しました。もう一度お試しください", 502, true);
      return "end";
    }
    content = r.content;
    trace.add("ai_response", { attempt: n, chars: content.length, stats, elapsedMs: now() - live.aiStartedAt });
    dishes = deps.parseDishes(content, req);
  } catch (e) {
    // 通信失敗・タイムアウト・空の返答・返答の形式不正
    // stats: 返答がどこまで届いていたか(最初の文字が来る前に時間切れか、途中までは来ていたか)を原因調査用に残す
    trace.error("ai_or_parse_error", e, { attempt: n, rawContent: content, stats, elapsedMs: now() - live.aiStartedAt }, best ? "warn" : "error");
    if (best) {
      console.error("retry " + n + " failed: " + (e && e.message));
      await finish(best, job.attempt);
      return "end";
    }
    console.error("create-recipe failed: " + (e && e.message));
    await fail("レシピの作成に失敗しました。もう一度お試しください", 502, true);
    return "end";
  }

  // 使わない食材が入っていないか確認する(AIは呼ばない。名前の照合だけ)
  const excluded = Array.isArray(req.excluded) ? req.excluded : [];
  const hits = excluded.length && deps.findExcludedHits ? deps.findExcludedHits(dishes, excluded) : [];

  // 栄養量は成分表から計算する。失敗してもAIのレシピ自体は返す(利用回数も戻さない)。
  const aiEndedAt = now();
  live.stage = "nutrition";
  live.progress = Math.max(live.progress, plan.to);
  let nutritionOk = true;
  try {
    await deps.attachNutrition(env, dishes, req.metrics.map((m) => m.id));
  } catch (e) {
    nutritionOk = false;
    console.error("nutrition failed: " + (e && e.message));
    trace.error("nutrition_error", e, { attempt: n });
  }
  if (!nutritionOk) {
    // 計算できないので、目標に収まったか確かめようがない。作り直しはしない
    if (!best) best = { dishes, nutritionOk: false, check: null, hits };
    await finish(best, n);
    return "end";
  }

  const check = deps.checkTargets(dishes, req.metrics);
  const ok = check.ok && hits.length === 0; // 目標に収まり、かつ使わない食材も入っていない
  const activeMs = job.active_ms + (now() - stepStart);
  // 所要時間の内訳(遅いと感じたときの原因調査用)。全体が45秒を超えたら warn にして、管理者のログに必ず残す
  trace.add("timing", {
    attempt: n, preAiMs: aiStartedAt - stepStart, aiMs: aiEndedAt - aiStartedAt, nutritionMs: now() - aiEndedAt,
    firstChunkMs: stats.firstChunkMs, headersMs: stats.headersMs, stream: deps.stream === true, totalActiveMs: activeMs,
  }, activeMs > 45000 ? "warn" : "info");
  // このあと作り直しに進めるか(上限回数・待ち時間・AI呼び出しの絶対上限)
  const canRetry = n < MAX_ATTEMPTS && activeMs <= RETRY_START_LIMIT_MS && job.ai_calls < MAX_AI_CALLS;
  const retrying = !ok && canRetry;
  trace.add("target_check", {
    attempt: n, ok: check.ok, worstPct: Math.round(check.worst * 10) / 10,
    results: check.results.map((r) => r.id + ": 目標" + r.target + " / 合計" + r.total + " (" + (r.diffPct > 0 ? "+" : "") + r.diffPct.toFixed(1) + "%)" + (r.ok ? "" : " NG")),
    unmatched: [...new Set(dishes.flatMap((d) => (d.nutritionCheck && d.nutritionCheck.unmatched) || []))],
    ...(hits.length ? { excludedHits: hits } : {}),
    ...(retrying ? { retrying: true } : {}),
  }, ok || retrying ? "info" : "warn");
  const candidate = { dishes, nutritionOk: true, check, hits };
  if (!best || isBetter(candidate, best)) best = candidate;
  if (ok) { await finish(best, n); return "end"; }
  if (!canRetry) {
    trace.add("retry_stopped", {
      reason: n >= MAX_ATTEMPTS ? "作り直しの上限(" + MAX_ATTEMPTS + "回)に達した"
        : job.ai_calls >= MAX_AI_CALLS ? "AI呼び出しの上限(" + MAX_AI_CALLS + "回)に達した" : "待ち時間の上限を超えた",
      elapsedMs: activeMs,
    }, "warn");
    await finish(best, n);
    return "end";
  }

  // 作り直しへ: 前回の合計と目標との差・食材ごとの内訳(使わない食材が入っていたら、その名前も)を伝える会話を作って保存する
  messages.push({ role: "assistant", content });
  messages.push({ role: "user", content: deps.buildRetryPrompt(req, dishes, check, hits) });
  const nextPlan = planFor(n + 1);
  Object.assign(job, {
    attempt: n, messages: JSON.stringify(messages), best: JSON.stringify(best), expected_chars: content.length,
    active_ms: activeMs, trace: mergedTrace(job, trace, stepStart),
  });
  live.stage = "retry";
  live.progress = Math.max(live.progress, plan.done);
  await run(env,
    `UPDATE recipe_jobs SET attempt = ?, messages = ?, best = ?, expected_chars = ?, active_ms = ?, trace = ?,
       stage = 'retry', progress = MAX(progress, ?), updated_at = ? WHERE id = ? AND status = 'running'`,
    job.attempt, job.messages, job.best, job.expected_chars, job.active_ms, job.trace, plan.done, now(), job.id);
  live.progress = Math.max(live.progress, nextPlan.from);
  return "continue";
}

// ジョブを最後まで(完成か失敗まで)動かす。同時に動かせるのは1つだけ。
// 返り値: 実際に動かしたら true / 他で実行中・終了済みで何もしなかったら false
async function runJob(env, user, jobId, deps, { now = Date.now, heartbeatMs = HEARTBEAT_MS } = {}) {
  let job = await loadOwnJob(env, jobId, user.id);
  if (!job || job.status !== "running") return false;
  if (!(await acquireLease(env, jobId, now()))) return false;

  const isAdmin = deps.isAdminUser(env, user);
  const live = { stage: job.stage, progress: job.progress };
  // 実行中の印を延ばし、進捗をD1へ書く。リクエストが止まるとこれも止まり、lease が切れて別のリクエストが引き継げる
  let beating = false;
  const timer = setInterval(async () => {
    if (beating) return;
    beating = true;
    try {
      // 返答を書き始める前(モデルが考えている間)は文字数で測れないので、時間に応じて少しだけ進める(区間の25%まで)
      if (live.stage === "ai" && live.chars === 0 && live.plan) {
        const t = Math.min(1, (now() - live.aiStartedAt) / 60000);
        live.progress = Math.max(live.progress, Math.round(live.plan.from + (live.plan.to - live.plan.from) * 0.25 * t));
      }
      await run(env,
        "UPDATE recipe_jobs SET progress = MAX(progress, ?), stage = ?, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'running'",
        live.progress, live.stage, now() + LEASE_MS, now(), jobId);
    } catch (e) { /* 次の間隔でまた書く */ }
    beating = false;
  }, heartbeatMs);

  try {
    for (;;) {
      const outcome = await runAttempt(env, deps, job, live, { isAdmin, now });
      if (outcome !== "continue") break;
    }
  } catch (e) {
    // 想定外のエラー(DBの障害など)。AIの結果が無ければ失敗にして利用回数を戻す
    console.error("runJob failed: " + (e && e.message));
    const trace = deps.createTrace(isAdmin);
    trace.error("run_job_failed", e);
    try {
      const fresh = await loadJob(env, jobId);
      if (fresh && fresh.status === "running") {
        const best = parse(fresh.best);
        const ctx = { trace, stepStart: now(), now };
        if (best) await finishJob(env, deps, fresh, { best, attempts: fresh.attempt, ...ctx });
        else await failJob(env, deps, fresh, { message: "サーバーでエラーが発生しました。もう一度お試しください", status: 500, refund: true, ...ctx });
      }
    } catch (e2) { /* 記録できなくても、lease が切れれば画面側が気づく */ }
  } finally {
    clearInterval(timer);
    // まだ実行中のままなら(想定外)、すぐ引き継げるよう印を外す
    try { await run(env, "UPDATE recipe_jobs SET lease_until = 0 WHERE id = ? AND status = 'running'", jobId); } catch (e) { /* 無視 */ }
  }
  return true;
}

// POST /api/ai/jobs/[id] の本体: 実行して、終わったときの状況を返す
async function runJobRequest(env, user, jobId, deps, { waitUntil, ...runOptions } = {}) {
  const job = await loadOwnJob(env, jobId, user.id);
  if (!job) return { status: 404, body: { error: "作成中のレシピが見つかりません" } };
  // 画面との通信が切れても処理が止まらないよう、完了まで waitUntil に預ける(本番のみ)
  const work = runJob(env, user, jobId, deps, runOptions);
  if (typeof waitUntil === "function") waitUntil(work.catch(() => {}));
  await work;
  return getJobState(env, user, jobId, deps);
}

export { startJob, getJobState, runJob, runJobRequest, publicState, planFor, PLAN, HEARTBEAT_MS, LEASE_MS };
