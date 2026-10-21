// 【課金事故の防止】写真・共有・取り込みの機能が、有料のAI(xAI)に触れないことを、ソースの構造から確かめるテスト。
// 1) 新機能のサーバー側ファイルから import をたどり、AIを呼ぶファイルに届かないこと
// 2) 新機能のファイル(サーバー・画面とも)に、AIのURL・キー・利用回数の処理が書かれていないこと
// 3) 画面側の新機能が、/api/ai/ ・ /api/admin/ai ・ x.ai を呼んでいないこと
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root, makeRunner } from "./_support.mjs";

const t = makeRunner("課金ゼロの構造チェック");
const rel = (f) => path.relative(root, f);
const read = (f) => fs.readFileSync(f, "utf8");

// AIを呼ぶ・AIの設定や利用回数を扱うファイル(新機能から届いてはいけない)
const AI_FILES = ["functions/_lib/recipe-job.js", "functions/_lib/recipe-job-deps.js", "functions/_lib/manual-extract.js", "functions/_lib/app-settings.js",
  "functions/_lib/recipe-prompt.js", "functions/_lib/crypto.js", "functions/api/ai/create-recipe.js", "functions/api/admin/ai-test.js", "functions/api/admin/ai-settings.js"]
  .map((f) => path.join(root, f));
// 念のため、中身でも判定する(ファイル名を変えて呼ばれた場合に備える)
const AI_PATTERNS = [/api\.x\.ai/i, /chat\/completions/i, /\bgrok/i, /XAI_/i, /reserveUsage|refundUsage|loadAiSettings/, /Authorization["']?\s*:\s*[`"']?Bearer/i, /\/api\/ai\//, /\/api\/admin\/ai/];

const NEW_SERVER = [
  "functions/_lib/photo.js", "functions/_lib/share.js", "functions/_lib/recipe-import.js",
  "functions/api/recipes/[id]/photo.js", "functions/api/recipes/[id]/share.js",
  "functions/api/shared/[token].js", "functions/api/shared/[token]/photo.js",
  "functions/api/recipes/import.js", "functions/api/recipes/import-url.js", "functions/api/recipes/import-text.js",
  // 既存だが今回変更したもの(AIに触れていないこと)
  "functions/api/recipes.js", "functions/api/recipes/[id].js", "functions/_lib/recipe-edit.js",
].map((f) => path.join(root, f));
const NEW_CLIENT = ["js/photo.js", "js/recipe-share.js", "js/recipe-import.js"].map((f) => path.join(root, f));

function localImports(file) {
  const src = read(file);
  const out = [];
  const re = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2];
    if (spec.startsWith(".")) out.push(path.resolve(path.dirname(file), spec));
  }
  return out;
}

// 1) import の到達先
const seen = new Set();
const queue = [...NEW_SERVER];
while (queue.length) {
  const f = queue.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  assert.ok(fs.existsSync(f), "ファイルがありません: " + rel(f));
  assert.ok(!AI_FILES.includes(f), "新機能のimportがAI関連のファイルに届いています: " + rel(f));
  localImports(f).forEach((d) => queue.push(d));
}
t.ok(`新機能のサーバー側(${NEW_SERVER.length}ファイル+その import 先 ${seen.size}ファイル)は、AI関連のファイルに1つも届かない`);

// 2) 書かれている中身
[...seen, ...NEW_CLIENT].forEach((f) => {
  if (!fs.existsSync(f)) return; // 画面側のファイルは作成後に検査される
  const src = read(f);
  AI_PATTERNS.forEach((re) => assert.ok(!re.test(src), `${rel(f)} にAI関連の記述があります: ${re}`));
});
t.ok("新機能のファイルに、AIのURL・キー・利用回数・AI用APIの呼び出しが書かれていない");

// 3) 画面側が呼ぶAPI
const allowedApi = /\/api\/(recipes|shared)\b/;
NEW_CLIENT.forEach((f) => {
  if (!fs.existsSync(f)) return;
  const calls = [...read(f).matchAll(/fetch\(\s*([`'"])(.*?)\1/g)].map((m) => m[2]);
  calls.forEach((c) => assert.ok(allowedApi.test(c) || !c.includes("/api/"), `${rel(f)} が想定外のAPIを呼んでいます: ${c}`));
});
t.ok("画面側の新機能が呼ぶAPIは /api/recipes と /api/shared だけ");

// 4) 新機能のAPIが認証・Origin確認の入口を通っていること(誰でもサーバー経由で外部へ出られないように)
const mustAuth = ["functions/api/recipes/import-url.js", "functions/api/recipes/import-text.js", "functions/api/recipes/import.js"];
mustAuth.forEach((f) => {
  const src = read(path.join(root, f));
  assert.ok(/getSessionUser/.test(src) && /checkOrigin/.test(src), f + " は認証とOrigin確認が必要です");
});
t.ok("取り込み系のAPIは、ログインとOrigin確認を必ず通る");

// 5) 外部へ出るfetchは「利用者が指定したページの取得」1か所だけ
const callers = [...seen].filter((f) => /(^|[^.\w])fetch(Impl)?\(/.test(read(f)));
assert.deepEqual(callers.map(rel), ["functions/_lib/recipe-import.js"], "fetch を呼んでいるのは recipe-import.js だけのはず: " + callers.map(rel));
t.ok("サーバー側で fetch を呼ぶのは、取り込みのページ取得(recipe-import.js)だけ");

t.done();
