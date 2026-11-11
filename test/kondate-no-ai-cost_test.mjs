// 【課金事故の防止】今日/週プラン/買い物/目標の機能が、有料のAI(xAI)に触れる場所を、ソースの構造から確かめるテスト。
// 1) AIに届いてよいのは「週プランの実行」「写真の推定」の2つのAPIだけ(ほかのファイルからは import をたどってもAIに届かない)
// 2) AIの接続(URL・キー)が書かれているのは kondate-ai.js だけで、通信の呼び出し箇所は1か所(再試行の繰り返しなし)
// 3) AIを呼ぶ箇所(callAi / callVision)は、それぞれ1か所だけ
// 4) 2つのAPIは POST だけで、ログインとOrigin確認を必ず通る
// 5) 画面側は x.ai を呼ばず、AIにつながるAPIは「実行ボタン」の2つだけ
// 6) 朝食・昼食・夕食: 1回の実行で頼むのは1つの食事だけ。画面は確認のあと、食事ごとに1回ずつ(最大3回)・残り回数まで・失敗したら止める
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, makeRunner } from "./_support.mjs";

const t = makeRunner("課金ゼロの構造チェック(今日・週プラン・買い物・目標)");
const rel = (f) => path.relative(root, f);
const abs = (f) => path.join(root, f);
const read = (f) => fs.readFileSync(f, "utf8");

const AI_FILES = ["functions/_lib/recipe-job.js", "functions/_lib/recipe-job-deps.js", "functions/_lib/manual-extract.js", "functions/_lib/app-settings.js",
  "functions/_lib/recipe-prompt.js", "functions/_lib/crypto.js", "functions/_lib/kondate-ai.js", "functions/api/ai/create-recipe.js", "functions/api/admin/ai-test.js", "functions/api/admin/ai-settings.js"].map(abs);
const AI_PATTERNS = [/api\.x\.ai/i, /chat\/completions/i, /\bgrok/i, /XAI_/i, /reserveUsage|refundUsage|loadAiSettings/, /Authorization["']?\s*:\s*[`"']?Bearer/i, /\/api\/ai\//, /\/api\/admin\/ai/, /makeAiDeps|kondate-ai/];

// AIに届いてはいけないサーバー側(入口のAPI)
const NO_AI_ENTRY = [
  "functions/api/user/targets.js", "functions/api/user/pantry.js", "functions/api/meals.js", "functions/api/meals/[id].js",
  "functions/api/today.js", "functions/api/week.js", "functions/api/week/review.js", "functions/api/week/plan.js", "functions/api/week/plan/[id].js",
].map(abs);
// AIに届いてよい入口(この2つだけ)
const AI_ENTRY = ["functions/api/week/plan/[id]/run.js", "functions/api/meals/photo.js"].map(abs);
const NEW_LIB = ["dri2025", "kondate-messages", "targets", "meals", "balance", "shopping", "week-plan", "kondate-usage", "kondate-handlers"].map((n) => abs(`functions/_lib/${n}.js`));

function localImports(file) {
  const out = []; const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g; let m; const src = read(file);
  while ((m = re.exec(src))) { const s = m[1] || m[2]; if (s.startsWith(".")) out.push(path.resolve(path.dirname(file), s)); }
  return out;
}

// 1) 到達先
const seen = new Set(); const queue = [...NO_AI_ENTRY, ...NEW_LIB];
while (queue.length) {
  const f = queue.pop(); if (seen.has(f)) continue; seen.add(f);
  assert.ok(fs.existsSync(f), "ファイルがありません: " + rel(f));
  assert.ok(!AI_FILES.includes(f), "AI関連のファイルに届いています: " + rel(f));
  localImports(f).forEach((d) => queue.push(d));
}
t.ok(`AIに届かない側(${NO_AI_ENTRY.length}個のAPI+${NEW_LIB.length}個のlib+その import 先 ${seen.size}ファイル)は、AI関連のファイルに1つも届かない`);
[...seen].forEach((f) => { const src = read(f); AI_PATTERNS.forEach((re) => assert.ok(!re.test(src), `${rel(f)} にAI関連の記述があります: ${re}`)); });
t.ok("その中に、AIのURL・キー・利用回数・AI用APIの呼び出しは書かれていない");

// kondate-ai.js をimportしているファイルは、2つの入口だけ
const all = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) all.push(p); } })(abs("functions"));
const importers = all.filter((f) => localImports(f).some((i) => i === abs("functions/_lib/kondate-ai.js")));
assert.deepEqual(importers.map(rel).sort(), AI_ENTRY.map(rel).sort(), "kondate-ai.js を使ってよいのは2つの入口だけ");
t.ok("kondate-ai.js(AIへの接続)を使っているのは、「週プランの実行」と「写真の推定」の2つのAPIだけ");

// 2) kondate-ai.js の中
const ai = read(abs("functions/_lib/kondate-ai.js"));
assert.equal((ai.match(/doFetch\(/g) || []).length, 1, "通信の呼び出しは1か所");
assert.ok(!/\b(for|while)\s*\(/.test(ai.replace(/\/\/.*$/gm, "")), "繰り返し(再試行)がない");
assert.ok(!/retry|リトライ/i.test(ai.replace(/\/\/.*$/gm, "")), "再試行の仕組みがない");
assert.ok(/AbortController/.test(ai), "タイムアウトがある");
t.ok("AIへの通信の呼び出しは1か所だけで、繰り返し(再試行)がなく、タイムアウトがある");

// 3) 呼び出し箇所
const count = (f, re) => (read(abs(f)).match(re) || []).length;
assert.equal(count("functions/_lib/week-plan.js", /deps\.callAi\(/g), 1);
assert.equal(count("functions/_lib/kondate-handlers.js", /deps\.callVision\(/g), 1);
assert.equal(count("functions/_lib/kondate-handlers.js", /deps\.callAi\(/g), 0);
t.ok("AIを呼ぶ箇所は、週プランに1か所(callAi)・写真に1か所(callVision)だけ");

// 4) 2つの入口
AI_ENTRY.forEach((f) => {
  const src = read(f);
  assert.ok(/getSessionUser/.test(src) && /checkOrigin/.test(src), rel(f) + " はログインとOrigin確認が必要です");
  assert.ok(/export async function onRequestPost\b/.test(src), rel(f) + " は POST");
  assert.ok(!/onRequest(Get|Put|Patch|Delete|Options)?\b(?!Post)/.test(src.replace(/onRequestPost/g, "")), rel(f) + " に POST 以外の入口があります");
});
t.ok("AIにつながる2つのAPIは、POSTだけで、ログインとOrigin確認を必ず通る");
const create = read(abs("functions/api/week/plan.js"));
assert.ok(!/run|callAi/.test(create.replace(/\/\/.*$/gm, "").replace(/onRequestPost|runs/g, "")), "プランの作成APIは実行をしない");
t.ok("プランの枠を作るAPIは、AIを呼ばない");

// 5) 画面側
const CLIENT = ["js/today.js", "js/week.js", "js/shopping.js", "js/targets.js", "js/meal-photo.js"].map(abs).filter((f) => fs.existsSync(f));
const AI_CALLS = [/\/api\/week\/plan\/[^`'"]*\/run/, /\/api\/meals\/photo/];
CLIENT.forEach((f) => {
  const src = read(f);
  assert.ok(!/x\.ai|api\.x\.ai|chat\/completions|\/api\/ai\/|\/api\/admin\/ai/i.test(src), rel(f) + " がAIを直接呼んでいます");
});
t.ok(`画面側(${CLIENT.length}ファイル)は、AIのURLを直接呼ばない`);
const callers = CLIENT.filter((f) => AI_CALLS.some((re) => re.test(read(f)))).map((f) => rel(f)).sort();
assert.ok(callers.every((c) => ["js/meal-photo.js", "js/week.js"].includes(c)), "AIにつながるAPIを呼んでよい画面は、週プランと写真だけ: " + callers);
t.ok("AIにつながるAPIを呼ぶ画面は、「週プラン」と「写真」だけ");
// 実行ボタンは、利用者のタップ(クリック)の中からだけ呼ぶ(画面を開いただけ・自動更新では呼ばない)
CLIENT.forEach((f) => {
  const src = read(f);
  if (!AI_CALLS.some((re) => re.test(src))) return;
  assert.ok(/data-ai-confirm|confirmAi\(/.test(src), rel(f) + ": AIを使う前の確認(回数の表示)がありません");
});
t.ok("AIを使う画面には、実行前の確認(今月の残り回数の表示)がある");

// 6) 朝食・昼食・夕食
const plan = read(abs("functions/_lib/week-plan.js"));
const runBody = plan.slice(plan.indexOf("export async function runPlan"));
assert.ok(!/\b(while)\s*\(/.test(runBody.replace(/\/\/.*$/gm, "")), "実行の中に、繰り返し(while)がない");
assert.ok(!/for\s*\([^)]*\)[^;{]*\{[^}]*deps\.callAi\(/.test(runBody), "AIを呼ぶ箇所が、繰り返しの中にない");
assert.equal((runBody.match(/deps\.callAi\(/g) || []).length, 1);
assert.ok(/MAX_FILL_PER_RUN\s*=\s*7/.test(plan), "1回に頼む日数は7日まで(=1つの食事の1週間ぶん)");
t.ok("サーバーの実行は、1回で1つの食事(最大7日ぶん)だけをAI1回で頼む。繰り返しの中でAIを呼ばない");
const week = read(abs("js/week.js"));
const runCalls = week.match(/\/run'/g) || [];
assert.equal(runCalls.length, 1, "画面から実行APIを呼ぶ箇所は1か所");
const iConfirm = week.indexOf("await K.confirmAi("), iRun = week.indexOf("/run'");
assert.ok(iConfirm > 0 && iRun > iConfirm, "実行APIは、確認(confirmAi)のあとにだけ呼ぶ");
assert.ok(/MAX_AI_RUNS\s*=\s*3/.test(week), "1回の「考える」でAIを呼ぶのは最大3回(食事の数)");
assert.ok(/Math\.min\(MAX_AI_RUNS,\s*Math\.max\(0,\s*remaining\)\)/.test(week), "今月の残り回数より多くは呼ばない");
const loop = week.slice(week.indexOf("for(let i = 0; i < runnable.length"), week.indexOf("return good;"));
assert.ok(/break;/.test(loop), "うまくいかなかったら、そこで止める");
assert.ok(!/\bwhile\s*\(/.test(week) && !/setInterval|setTimeout\([^)]*run/.test(week), "自動で繰り返し呼ぶ仕組みがない(タイマー・while)");
const runApi = read(abs("functions/api/week/plan/[id]/run.js"));
assert.ok(/slot/.test(runApi) && !/\bfor\s*\(|\bwhile\s*\(/.test(runApi.replace(/\/\/.*$/gm, "")), "実行APIは、1つの食事だけを渡し、繰り返しがない");
t.ok("画面は、確認のあとにだけ、食事ごとに1回ずつ(最大3回)・今月の残り回数まで呼び、失敗したらそこで止まる(自動の繰り返しなし)");

t.done();
