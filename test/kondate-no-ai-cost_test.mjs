// 【課金事故の防止】今日/週プラン/買い物/目標の機能が、有料のAI(xAI)に触れる場所を、ソースの構造から確かめるテスト。
// 1) AIに届いてよいのは「週プランの実行」「写真の推定」の2つのAPIだけ(ほかのファイルからは import をたどってもAIに届かない)
// 2) AIの接続(URL・キー)が書かれているのは kondate-ai.js だけで、通信の呼び出し箇所は1か所(再試行の繰り返しなし)
// 3) AIを呼ぶ箇所(callAi / callVision)は、それぞれ1か所だけ
// 4) 2つのAPIは POST だけで、ログインとOrigin確認を必ず通る
// 5) 画面側は x.ai を呼ばず、AIにつながるAPIは「実行ボタン」の2つだけ
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

t.done();
