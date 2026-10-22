// 「今日」「週」「設定の目標」の画面テスト(Playwright。iPhone幅)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る。/api/* は、このテストの偽サーバーが答える(AIは存在しない)
//   ・AIにつながる2つのAPI(週プランの実行・写真の推定)は、偽サーバーが呼び出し回数を数える。
//     「確認でやめる → 0回」「確認で使う → ちょうど1回」であることを確かめる
//   ・AI系(/api/ai/ ・ /api/admin/ai ・ x.ai)と、127.0.0.1 以外への通信は、0件であることを assert する
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOT_DIR = process.env.SHOT_DIR || "";
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(root, p === "/" ? "index.html" : p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓ " + name); };
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const AVOID = ["不足", "足りない", "足りません", "未達", "失敗", "サボ", "ダメ", "危険です", "オーバー", "超過", "守れ"];

const todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekStart = (d) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));

// ---- 偽のサーバー ----
function makeFakeApi({ user }) {
  const st = { user, calls: [], aiLike: [], external: [], runCalls: 0, photoCalls: 0, meals: [], plan: null, pantry: [], targets: null, showNumbers: true, seq: 0, checked: [], quota: 12, photoQuota: 40 };
  const json = (route, status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
  const gauge = (id, total, value, kind, text, status, fill) => ({ id, status, total, text, target: { value, kind, unit: id === "calories" ? "kcal" : "g" }, fill, mark: 0.6 });
  const balance = () => {
    const sum = st.meals.reduce((s, m) => s + (m.nutrition.protein || 0), 0);
    return { hasMeals: st.meals.length > 0, approx: st.meals.some((m) => m.approx), approxText: st.meals.some((m) => m.approx) ? "おおよその値を含みます" : null, showNumbers: st.showNumbers,
      gauges: [gauge("protein", sum, 65, "min", sum >= 65 ? "ちょうど良い" : "まだ伸ばせます", sum >= 65 ? "ok" : "below", Math.min(1, sum / 100))],
      help: "縦の線は、1日の目安の位置です。届かない日があっても大丈夫。栄養は週や月の平均で整います。", empty: st.meals.length ? null : "まだ記録がありません。食べたものを足すと、ここにバランスが出ます。" };
  };
  const days = () => st.plan.days;
  const shopping = () => {
    const items = []; for (const d of days()) if (d.recipe) d.recipe.ingredientDetails.forEach((i) => { if (!items.find((x) => x.name === i.name)) items.push({ key: i.name, name: i.name, amount: i.grams + "g", uses: [d.date], checked: st.checked.includes(i.name) }); });
    return { sections: items.length ? [{ id: "veg", label: "野菜・きのこ・海藻", items }] : [], have: [] };
  };
  const handler = async (route) => {
    const url = new URL(route.request().url()); const method = route.request().method();
    if (url.hostname !== "127.0.0.1") { st.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (/^\/api\/(ai|admin\/ai)|\/extract/.test(url.pathname)) { st.aiLike.push(url.pathname); return json(route, 500, { error: "AIは呼べません" }); }
    const body = (() => { try { return JSON.parse(route.request().postData() || "null"); } catch (e) { return null; } })();
    const p = url.pathname;
    if (method !== "GET") st.calls.push({ method, path: p, body });
    if (p === "/api/auth/me") return json(route, 200, { user: st.user });
    if (!st.user) return json(route, 401, { error: "ログインが必要です" });
    if (p === "/api/recipes" && method === "GET") return json(route, 200, { recipes: [{ id: "r1", name: "鮭の塩焼き", nutrition: { calories: 300, protein: 25 } }] });
    if (p === "/api/recipes" && method === "POST") return json(route, 200, { ok: true });
    if (p === "/api/user/targets" && method === "GET") return json(route, 200, st.targets || { profile: { sex: null, age: null, activity: "normal", purpose: "maintain", heightCm: null, weightKg: null, special: false }, overrides: {}, showNumbers: st.showNumbers, effective: {}, notices: [], standard: null, configured: false, source: { title: "日本人の食事摂取基準(2025年版)", publisher: "厚生労働省", url: "https://example.invalid/" } });
    if (p === "/api/user/targets" && method === "PUT") {
      st.showNumbers = body.showNumbers; st.targets = { ...body, mode: "standard", standard: { items: { protein: { value: 65 } } }, notices: ["自分で設定した値は、一般的な基準とは異なります。"], configured: true,
        effective: { calories: { value: 2000, kind: "aim", source: "standard" }, protein: { value: body.overrides.protein || 65, kind: "min", source: body.overrides.protein ? "self" : "standard" } }, source: { title: "日本人の食事摂取基準(2025年版)", publisher: "厚生労働省", url: "https://example.invalid/" } };
      return json(route, 200, st.targets);
    }
    if (p === "/api/today") return json(route, 200, { day: url.searchParams.get("day"), meals: st.meals, balance: balance(), next: st.meals.length ? { title: "次の食事で、ちょうど整います", picks: [{ recipeId: "r1", name: "鮭の塩焼き" }] } : null, quota: { photo: { used: 40 - st.photoQuota, cap: 40, remaining: st.photoQuota } }, hasTargets: true });
    if (p === "/api/week/review") return json(route, 200, { title: "今週もおつかれさまでした", few: "まだ記録が少ないので、傾向はこれから見えてきます。無理のない範囲で、食べたものを足してみてください。", positives: [], notes: ["栄養は、習慣として少しずつ整えるものです。1日単位の多い少ないは、気にしなくて大丈夫です。"] });
    if (p === "/api/meals" && method === "POST") { const id = "m" + ++st.seq; st.meals.push({ id, day: body.day, slot: body.slot, name: body.name || "鮭の塩焼き", nutrition: body.nutrition || { calories: 300, protein: 25 }, approx: !!body.nutrition || body.via === "photo" }); return json(route, 200, { ok: true, id }); }
    let m;
    if ((m = /^\/api\/meals\/([^/]+)$/.exec(p)) && method === "DELETE") { st.meals = st.meals.filter((x) => x.id !== m[1]); return json(route, 200, { ok: true }); }
    if (p === "/api/meals/photo") { st.photoCalls++; st.photoQuota--; return json(route, 200, { approx: true, note: "写真からの推定です。量は見た目からの目安なので、料理名と量を確認して直してください", dishes: [{ name: "牛丼", nutrition: { calories: 600 }, ingredients: [{ name: "牛肉", grams: 80, matched: true }, { name: "謎のたれ", grams: 20, matched: false }] }] }); }
    if (p === "/api/week" && method === "GET") return json(route, 200, st.plan ? { weekStart: url.searchParams.get("week"), quota: { used: 12 - st.quota, cap: 12, remaining: st.quota }, plan: { id: st.plan.id, status: "done", days: days(), pending: days().filter((d) => d.kind === "cook" && !d.recipe).map((d) => d.date) }, summary: { cookedDays: days().filter((d) => d.recipe).length, outingDays: days().filter((d) => d.kind === "outing").length, average: { calories: 600 } }, shopping: shopping() } : { weekStart: url.searchParams.get("week"), plan: null, quota: { used: 12 - st.quota, cap: 12, remaining: st.quota } });
    if (p === "/api/week/plan" && method === "POST") {
      const ws = body.weekStart; const today = todayJst();
      st.plan = { id: "wp1", days: Array.from({ length: 7 }, (_, i) => { const date = addDays(ws, i); return { date, kind: (body.outingDays || []).includes(date) ? "outing" : (body.offDays || []).includes(date) ? "off" : "cook", recipe: null }; }) };
      return json(route, 200, { ok: true, id: "wp1" });
    }
    if (p === "/api/week/plan/wp1/run") { st.runCalls++; st.quota--; days().forEach((d) => { if (d.kind === "cook" && !d.recipe) d.recipe = { source: "ai", name: "AIの野菜炒め", minutes: 15, ingredientDetails: [{ name: "キャベツ", grams: 200 }], ingredients: ["キャベツ 200g"], steps: ["炒める"], nutrition: { calories: 450, protein: 20 } }; }); return json(route, 200, { ok: true, filled: 1, skipped: [] }); }
    if (p === "/api/week/plan/wp1" && method === "PATCH") {
      if (body.action === "check") { st.checked = body.checked ? st.checked.concat([body.key]) : st.checked.filter((k) => k !== body.key); return json(route, 200, { ok: true }); }
      const d = days().find((x) => x.date === body.date); if (body.action === "outing") { d.kind = "outing"; d.recipe = null; } if (body.action === "cook") { d.kind = "cook"; d.recipe = null; }
      return json(route, 200, { ok: true });
    }
    if (p === "/api/week/plan/wp1" && method === "DELETE") { st.plan = null; return json(route, 200, { ok: true }); }
    if (p === "/api/user/pantry") { if (method === "PUT") st.pantry = body.items; return json(route, 200, { items: st.pantry }); }
    return json(route, 404, { error: "想定外のAPI: " + p });
  };
  return { st, handler };
}

const STATIC_EXTERNAL = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"]);
const unexpectedExternal = (api) => api.st.external.filter((u) => !STATIC_EXTERNAL.has(new URL(u).hostname));
const browser = await chromium.launch();
async function newPage(user) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const api = makeFakeApi({ user });
  await page.route("**/*", api.handler);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => { errors.push("想定外のダイアログ: " + d.message()); d.dismiss(); });
  await page.goto(base + "/");
  await page.waitForTimeout(300);
  return { ctx, page, api, errors };
}
const shot = async (page, name) => { if (SHOT_DIR) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), fullPage: true }); } };
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const noAvoid = async (page, where) => { const t = await bodyText(page); for (const w of AVOID) assert.ok(!t.includes(w), `${where}: 画面に避けたい言葉「${w}」が出ています`); };

try {
  // ---- 未ログイン ----
  {
    const { ctx, page, api, errors } = await newPage(null);
    assert.equal(await page.locator(".view-tab").count(), 5); ok("タブは5つ(作る・今日・週・保存済み・設定)");
    await page.click("#tab-today");
    assert.match(await page.locator("#view-today").innerText(), /ログインが必要/); ok("(未ログイン)今日: ログインの案内が出る");
    await page.click("#tab-week");
    assert.match(await page.locator("#view-week").innerText(), /ログインが必要/); ok("(未ログイン)週: ログインの案内が出る");
    await page.click("#tab-settings");
    assert.match(await page.locator("#targets-box").innerText(), /ログインが必要/); ok("(未ログイン)設定の目標: ログインの案内が出る");
    assert.equal(api.st.runCalls + api.st.photoCalls, 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ---- ログイン中 ----
  const { ctx, page, api, errors } = await newPage({ id: "u1", isAdmin: false });
  const st = api.st;

  // 目標
  await page.click("#tab-settings");
  await page.waitForSelector("#t-save");
  assert.match(await page.locator("#targets-box").innerText(), /医療行為ではありません/); ok("設定の目標: 「一般的な目安・医療行為ではない」の注意が出る");
  assert.match(await page.locator("#targets-box a").first().getAttribute("href"), /^https:/); ok("設定の目標: 出典(厚生労働省)へのリンクがある");
  await page.selectOption("#t-sex", "female"); await page.fill("#t-age", "30"); await page.selectOption("#t-activity", "normal");
  await page.locator(".k-self summary").click();
  await page.fill("#t-o-protein", "70");
  await page.click("#t-save");
  await page.waitForFunction(() => document.querySelector("#t-msg") && document.querySelector("#t-msg").textContent === "保存しました");
  let put = st.calls.find((c) => c.method === "PUT" && c.path === "/api/user/targets");
  assert.deepEqual(put.body.profile, { sex: "female", age: 30, activity: "normal", purpose: "maintain", heightCm: null, weightKg: null }); assert.deepEqual(put.body.overrides, { protein: 70 });
  assert.match(await page.locator(".k-eff").innerText(), /自分で設定/); ok("設定の目標: 入力が送られ、自分で設定した項目に「自分で設定」が付く");
  await page.check("#t-special");
  assert.ok(await page.locator("#t-auto").isHidden()); ok("設定の目標: 「当てはまる」を選ぶと、自動の入力欄は隠れ、手入力の案内が出る");
  await page.uncheck("#t-special");
  await shot(page, "targets");

  // 今日
  await page.click("#tab-today");
  await page.waitForSelector(".k-empty");
  assert.match(await page.locator("#view-today").innerText(), /まだ記録がありません/); ok("今日: 記録がないときは、責めない案内が出る");
  await page.click('[data-act="add"]');
  await page.click('.k-seg button[data-mode="quick"]');
  await page.fill("#k-qname", "コンビニのおにぎり"); await page.fill("#k-q-protein", "4"); await page.fill("#k-q-calories", "180");
  await page.click('.k-sheet [data-act="save"]');
  await page.waitForSelector(".k-gauge");
  let post = st.calls.find((c) => c.method === "POST" && c.path === "/api/meals");
  assert.equal(post.body.name, "コンビニのおにぎり"); assert.deepEqual(post.body.nutrition, { protein: 4, calories: 180 });
  assert.match(await page.locator("#view-today").innerText(), /まだ伸ばせます/);
  assert.match(await page.locator("#view-today").innerText(), /おおよそ/); ok("今日: かんたん入力で記録でき、バランスは「まだ伸ばせます」「おおよそ」で出る");
  assert.ok(await page.locator(".k-gauge-num").count() > 0); 
  await noAvoid(page, "今日"); ok("今日: 画面に「不足」「足りない」などの言葉が出ない");
  await shot(page, "today");
  // 数字を隠す
  await page.click("#tab-settings"); await page.waitForSelector("#t-save"); await page.uncheck("#t-numbers"); await page.click("#t-save");
  await page.waitForFunction(() => document.querySelector("#t-msg") && document.querySelector("#t-msg").textContent === "保存しました");
  await page.click("#tab-today"); await page.waitForSelector(".k-gauge");
  assert.equal(await page.locator(".k-gauge-num").count(), 0); assert.match(await page.locator("#view-today").innerText(), /バランス良好/); ok("今日: 数字を隠す設定にすると、バーと言葉だけになる");
  // 次の食事 → 食べた
  await page.click('[data-act="log-pick"]');
  await page.waitForFunction(() => document.querySelectorAll(".k-meal").length === 2);
  ok("今日: 次の食事のおすすめから「食べた」で記録できる");
  // 記録を消す
  await page.locator('[data-act="del"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll(".k-meal").length === 1);
  ok("今日: 記録を消せる");

  // 写真(確認でやめる → 0回)
  const pickPhoto = async () => {
    await page.click('[data-act="add"]'); await page.click('.k-seg button[data-mode="photo"]');
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('.k-sheet [data-act="photo"]')]);
    await chooser.setFiles({ name: "dish.png", mimeType: "image/png", buffer: Buffer.from(PNG_B64, "base64") });
    await page.waitForSelector(".k-quota[data-ai-confirm]");
  };
  await pickPhoto();
  assert.match(await page.locator(".k-quota").innerText(), /40/); ok("写真: 送る前に、今月の残り回数の確認が出る");
  assert.equal(st.photoCalls, 0);
  await page.click('.k-sheet [data-act="cancel"]');
  await page.waitForTimeout(400);
  assert.equal(st.photoCalls, 0); ok("写真: 確認で「やめる」を選ぶと、AIにつながるAPIは0回");
  await pickPhoto();
  await page.click('.k-sheet [data-act="ok"]');
  await page.waitForSelector(".k-dish");
  assert.equal(st.photoCalls, 1); ok("写真: 確認で「推定する」を選ぶと、AIにつながるAPIはちょうど1回");
  assert.match(await page.locator(".k-sheet").innerText(), /成分表にない/);
  await shot(page, "photo-review");
  await page.fill('.k-dish [data-f="grams"] >> nth=0', "100");
  await page.click('.k-sheet [data-act="save"]');
  await page.waitForFunction(() => !document.querySelector(".k-dish"));
  const pm = st.calls.filter((c) => c.path === "/api/meals").pop();
  assert.equal(pm.body.via, "photo"); assert.equal(pm.body.ingredients[0].grams, 100); assert.equal(st.photoCalls, 1);
  ok("写真: 推定結果を直してから記録でき、記録のときはAIを呼ばない(「おおよそ」で保存)");

  // 週プラン
  await page.click("#tab-week");
  await page.waitForSelector('[data-act="create"]');
  assert.match(await page.locator("#view-week").innerText(), /今月の残り 12 \/ 12回/); ok("週: 作る前に、AIを使うことと今月の残り回数が書いてある");
  const firstKind = page.locator('[data-act="kind"]').last();
  await firstKind.click(); // 作る → 外食
  assert.match(await firstKind.innerText(), /外食/); ok("週: 日ごとに「作る/外食/作らない」を切り替えられる");
  await page.click('[data-act="create"]');
  await page.waitForSelector(".k-quota[data-ai-confirm]");
  assert.equal(st.runCalls, 0); ok("週: 「夕食を考える」を押しても、確認が出るまでAIは呼ばれない(枠づくりは無料)");
  await page.click('.k-sheet [data-act="cancel"]');
  await page.waitForSelector('[data-act="run"]');
  assert.equal(st.runCalls, 0); ok("週: 確認で「やめる」を選ぶと、AIにつながるAPIは0回。枠は残り「考える」ボタンが出る");
  await page.click('[data-act="run"]');
  await page.waitForSelector(".k-quota[data-ai-confirm]");
  assert.equal(st.runCalls, 0);
  await page.click('.k-sheet [data-act="ok"]');
  await page.waitForSelector(".k-day-name");
  assert.equal(st.runCalls, 1); ok("週: 確認で「考えてもらう」を選ぶと、AIにつながるAPIはちょうど1回");
  assert.match(await page.locator("#view-week").innerText(), /AIの提案/);
  assert.match(await page.locator("#view-week").innerText(), /外食の予定/); ok("週: 各日の料理(AIの提案の表示)と、外食の日の案内が出る");
  await noAvoid(page, "週");
  await shot(page, "week");
  // 外食にする(AI不使用)
  await page.locator('[data-act="day"][data-do="outing"]').first().click();
  await page.waitForTimeout(300);
  assert.equal(st.runCalls, 1); ok("週: 「外食にする」はAIを使わない");
  // 買い物
  await page.click('[data-pane="shop"]');
  await page.waitForSelector(".k-shop");
  assert.match(await page.locator("#view-week").innerText(), /キャベツ/);
  await page.locator('.k-shop input[type="checkbox"]').first().check();
  await page.waitForTimeout(200);
  assert.ok(st.calls.some((c) => c.body && c.body.action === "check" && c.body.checked === true)); ok("買い物: 同じ食材がまとまり、チェックが保存される");
  await page.fill("#k-pantry-in", "しょうゆ"); await page.click('[data-act="pantry-add"]');
  await page.waitForTimeout(300);
  assert.deepEqual(st.pantry, ["しょうゆ"]); ok("買い物: 家にある食材を登録できる");
  await shot(page, "shopping");

  assert.equal(st.runCalls, 1); assert.equal(st.photoCalls, 1);
  assert.deepEqual(st.aiLike, []); assert.deepEqual(unexpectedExternal(api), []);
  assert.deepEqual(errors, []);
  ok("AI系の通信(/api/ai など)は0件・外部通信は0件・ページのエラーは0件");
  await ctx.close();
  console.log("\n" + passed + " 件OK");
} finally {
  await browser.close(); server.close();
}
