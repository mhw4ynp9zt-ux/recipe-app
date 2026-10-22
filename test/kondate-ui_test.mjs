// 「今日」「週」「設定の目標」の画面テスト(Playwright。iPhone幅)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る。/api/* は、このテストの偽サーバーが答える(AIは存在しない)
//   ・AIにつながる2つのAPI(週プランの実行・写真の推定)は、偽サーバーが呼び出し回数を数える。
//     「確認でやめる → 0回」「確認で使う → 食事ごとに1回ずつ(朝食・昼食・夕食=3回、夕食だけなら1回)」であることを確かめる
//     今月の残り回数より多くは呼ばない・1回失敗したらそこで止める(再試行しない)ことも確かめる
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
  const st = { user, calls: [], aiLike: [], external: [], runCalls: 0, photoCalls: 0, meals: [], plan: null, pantry: [], targets: null, showNumbers: true, seq: 0, checked: [], quota: 12, photoQuota: 40, runSlots: [], failSlot: null, eaten: new Set(), editCalls: [] };
  const json = (route, status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
  const days = () => st.plan.days;
  const gaugeP = (tot) => ({ id: "protein", status: tot >= 65 ? "ok" : "below", total: tot, text: tot >= 65 ? "ちょうど良い" : "まだ伸ばせます", target: { value: 65, kind: "min", unit: "g" }, fill: Math.min(1, tot / 100), mark: 0.6 });
  const balanceFor = (ws) => {
    const out = {};
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      const planned = days().filter((d) => d.date === date && d.kind === "cook" && d.recipe), eaten = planned.filter((d) => st.eaten.has(d.date + ":" + d.slot));
      const sum = (l) => l.reduce((x, d) => x + (d.recipe.nutrition.protein || 0), 0);
      out[date] = { plannedCount: planned.length, eatenCount: eaten.length, eatenMeals: eaten.map((d) => ({ slot: d.slot, name: d.recipe.name })), approxText: null,
        gauges: (planned.length || eaten.length) ? [{ id: "protein", planned: gaugeP(sum(planned)), eaten: gaugeP(sum(eaten)) }] : [], empty: (planned.length || eaten.length) ? null : "この日は、まだ予定も食べた記録もありません。" };
    }
    return { weekStart: ws, showNumbers: st.showNumbers, hasTargets: true, help: "縦の線は、1日の目安の位置です。濃い色は食べた分、薄い色は予定の分です。届かない日があっても大丈夫。栄養は週や月の平均で整います。", days: out };
  };
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
    if (p === "/api/today") return json(route, 200, { day: url.searchParams.get("day"), meals: st.meals, showNumbers: st.showNumbers, quota: { photo: { used: 40 - st.photoQuota, cap: 40, remaining: st.photoQuota } } });
    if (p === "/api/week/review") return json(route, 200, { title: "今週もおつかれさまでした", few: "まだ記録が少ないので、傾向はこれから見えてきます。無理のない範囲で、食べたものを足してみてください。", positives: [], notes: ["栄養は、習慣として少しずつ整えるものです。1日単位の多い少ないは、気にしなくて大丈夫です。"] });
    if (p === "/api/meals" && method === "POST") { const id = "m" + ++st.seq; st.meals.push({ id, day: body.day, slot: body.slot, name: body.name || "鮭の塩焼き", nutrition: body.nutrition || { calories: 300, protein: 25 }, approx: !!body.nutrition || body.via === "photo" }); return json(route, 200, { ok: true, id }); }
    let m;
    if ((m = /^\/api\/meals\/([^/]+)$/.exec(p)) && method === "DELETE") { st.meals = st.meals.filter((x) => x.id !== m[1]); return json(route, 200, { ok: true }); }
    if (p === "/api/meals/photo") { st.photoCalls++; st.photoQuota--; return json(route, 200, { approx: true, note: "写真からの推定です。量は見た目からの目安なので、料理名と量を確認して直してください", dishes: [{ name: "牛丼", nutrition: { calories: 600 }, ingredients: [{ name: "牛肉", grams: 80, matched: true }, { name: "謎のたれ", grams: 20, matched: false }] }] }); }
    if (p === "/api/week" && method === "GET") return json(route, 200, st.plan ? { weekStart: url.searchParams.get("week"), quota: { used: 12 - st.quota, cap: 12, remaining: st.quota }, plan: { id: st.plan.id, status: "done", days: days().map((d) => ({ ...d, eaten: st.eaten.has(d.date + ":" + d.slot) })), pending: days().filter((d) => d.kind === "cook" && !d.recipe).map((d) => d.date + ":" + d.slot) }, balance: balanceFor(url.searchParams.get("week")), summary: { cookedDays: new Set(days().filter((d) => d.recipe).map((d) => d.date)).size, cookedMeals: days().filter((d) => d.recipe).length, outingDays: new Set(days().filter((d) => d.kind === "outing").map((d) => d.date)).size, average: { calories: 600 } }, shopping: shopping() } : { weekStart: url.searchParams.get("week"), plan: null, quota: { used: 12 - st.quota, cap: 12, remaining: st.quota } });
    if (p === "/api/week/plan" && method === "POST") {
      const ws = body.weekStart; const slots = body.slots || ["dinner"]; const out = body.outingMeals || []; const off = body.offMeals || [];
      st.plan = { id: "wp1", days: Array.from({ length: 7 }, (_, i) => addDays(ws, i)).flatMap((date) => slots.map((slot) => { const k = date + ":" + slot; return { date, slot, kind: out.includes(k) ? "outing" : off.includes(k) ? "off" : "cook", recipe: null }; })) };
      return json(route, 200, { ok: true, id: "wp1" });
    }
    if (p === "/api/week/plan/wp1/run") {
      const slot = body && body.slot; st.runCalls++; st.runSlots.push(slot);
      if (st.failSlot && st.failSlot === slot) return json(route, 502, { error: "うまく作れませんでした。もう一度お試しください" });   // 失敗したときは、回数は戻る(残りは減らさない)
      st.quota--;
      let filled = 0; days().forEach((d) => { if (d.slot === slot && d.kind === "cook" && !d.recipe) { filled++; d.recipe = { source: "ai", name: "AIの野菜炒め", minutes: 15, ingredientDetails: [{ name: "キャベツ", grams: 200 }], ingredients: ["キャベツ 200g"], steps: ["炒める"], nutrition: { calories: 450, protein: 20 } }; } });
      return json(route, 200, { ok: true, filled, skipped: [], slot });
    }
    if (p === "/api/week/plan/wp1" && method === "PATCH") {
      if (body.action === "check") { st.checked = body.checked ? st.checked.concat([body.key]) : st.checked.filter((k) => k !== body.key); return json(route, 200, { ok: true }); }
      const slot = body.slot || "dinner"; const d = days().find((x) => x.date === body.date && x.slot === slot);
      if (body.action === "eaten") { const k = body.date + ":" + slot; if (body.eaten) st.eaten.add(k); else st.eaten.delete(k); return json(route, 200, { ok: true, eaten: !!body.eaten }); }
      if (body.action === "edit") {
        st.editCalls.push(body);
        if (!body.draft.name) return json(route, 400, { error: "入力を確認してください", fields: { name: "1〜60文字で入力してください" } });
        const g = body.draft.ingredients.reduce((x, i) => x + i.grams, 0);
        d.recipe = { ...d.recipe, source: "edited", edited: true, name: body.draft.name, ingredientDetails: body.draft.ingredients.map((i) => ({ name: i.name, grams: i.grams })), steps: body.draft.steps.filter(Boolean), nutrition: { calories: g * 2, protein: Math.round(g / 10) } };
        return json(route, 200, { ok: true });
      }
      if (body.action === "swap") { st.eaten.has(body.date + ":" + slot); d.kind = "cook"; d.recipe = { source: "saved", name: "鮭の塩焼き", minutes: 10, ingredientDetails: [{ name: "さけ", grams: 80 }], ingredients: ["さけ 80g"], steps: ["焼く"], nutrition: { calories: 300, protein: 25 } }; return json(route, 200, { ok: true }); }
      if (body.action === "outing" || body.action === "off") { d.kind = body.action; d.recipe = null; st.eaten.delete(body.date + ":" + slot); }
      if (body.action === "cook") { d.kind = "cook"; d.recipe = null; st.eaten.delete(body.date + ":" + slot); }
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
  assert.equal(await page.locator(".k-gauge, .k-bar, .k-next").count(), 0);
  assert.doesNotMatch(await page.locator("#view-today").innerText(), /バランス|次の食事/); ok("今日: 「今日のバランス」と「次の食事のおすすめ」は出ない");
  await page.click('[data-act="add"]');
  await page.click('.k-seg button[data-mode="quick"]');
  await page.fill("#k-qname", "コンビニのおにぎり"); await page.fill("#k-q-protein", "4"); await page.fill("#k-q-calories", "180");
  await page.click('.k-sheet [data-act="save"]');
  await page.waitForSelector(".k-meal");
  let post = st.calls.find((c) => c.method === "POST" && c.path === "/api/meals");
  assert.equal(post.body.name, "コンビニのおにぎり"); assert.deepEqual(post.body.nutrition, { protein: 4, calories: 180 });
  assert.match(await page.locator("#view-today").innerText(), /おおよそ/); assert.match(await page.locator("#view-today").innerText(), /180kcal/); ok("今日: かんたん入力で記録でき、「おおよそ」の印とカロリーが出る");
  await noAvoid(page, "今日"); ok("今日: 画面に「不足」「足りない」などの言葉が出ない");
  await shot(page, "today");
  // 数字を隠す
  await page.click("#tab-settings"); await page.waitForSelector("#t-save"); await page.uncheck("#t-numbers"); await page.click("#t-save");
  await page.waitForFunction(() => document.querySelector("#t-msg") && document.querySelector("#t-msg").textContent === "保存しました");
  await page.click("#tab-today"); await page.waitForSelector(".k-meal");
  assert.doesNotMatch(await page.locator("#view-today").innerText(), /180kcal/); ok("今日: 数字を隠す設定にすると、カロリーの数字が出ない");
  // もう1件記録して、1件消す
  await page.click('[data-act="add"]'); await page.click('.k-seg button[data-mode="quick"]');
  await page.fill("#k-qname", "ヨーグルト"); await page.fill("#k-q-protein", "5");
  await page.click('.k-sheet [data-act="save"]');
  await page.waitForFunction(() => document.querySelectorAll(".k-meal").length === 2);
  await page.locator('[data-act="del"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll(".k-meal").length === 1);
  ok("今日: 記録を足したり消したりできる");

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

  // 週プラン(朝食・昼食・夕食)
  await page.click("#tab-week");
  await page.waitForSelector('[data-act="create"]');
  assert.match(await page.locator("#view-week").innerText(), /今月の残り 12 \/ 12回/); ok("週: 作る前に、AIを使うことと今月の残り回数が書いてある");
  assert.equal(await page.locator('.k-slotbtn[aria-pressed="true"]').count(), 3); ok("週: 朝食・昼食・夕食の3つが、はじめから選ばれている");
  const lastKind = page.locator('[data-act="kind"]').last();
  await lastKind.click(); // 作る → 外食
  assert.match(await lastKind.innerText(), /外食/); ok("週: 食事ごとに「作る/外食/作らない」を切り替えられる");
  await page.click('[data-act="create"]');
  await page.waitForSelector(".k-quota[data-ai-confirm]");
  assert.equal(st.runCalls, 0); ok("週: 「献立を考える」を押しても、確認が出るまでAIは呼ばれない(枠づくりは無料)");
  const confirmText = await page.locator(".k-sheet").innerText();
  assert.match(confirmText, /朝食・昼食・夕食/); assert.match(confirmText, /最大3回/); ok("週: 確認に、今回使う回数(最大3回)と、今月の残りが書いてある");
  await page.click('.k-sheet [data-act="cancel"]');
  await page.waitForSelector('[data-act="run"]');
  assert.equal(st.runCalls, 0); ok("週: 確認で「やめる」を選ぶと、AIにつながるAPIは0回。枠は残り「考える」ボタンが出る");
  await page.click('[data-act="run"]');
  await page.waitForSelector(".k-quota[data-ai-confirm]");
  assert.equal(st.runCalls, 0);
  await page.click('.k-sheet [data-act="ok"]');
  await page.waitForFunction(() => !document.querySelector('[data-act="run"]') && document.querySelectorAll(".k-name-btn").length > 0);
  assert.equal(st.runCalls, 3); assert.deepEqual(st.runSlots, ["breakfast", "lunch", "dinner"]); ok("週: 確認で「考えてもらう」を選ぶと、AIにつながるAPIは食事ごとに1回ずつ、ちょうど3回(朝→昼→夕)");
  const full = await page.$$eval(".k-daybtn", (els) => els.findIndex((e) => e.querySelector(".k-dots").textContent.includes("○○○")));
  assert.ok(full >= 0); await page.locator(".k-daybtn").nth(full).click();
  const wk = await page.locator("#view-week").innerText();
  assert.match(wk, /AIの提案/); assert.match(wk, /朝食/); assert.match(wk, /昼食/); assert.match(wk, /夕食/); ok("週: 日付を選ぶと、その日の朝食・昼食・夕食の料理(AIの提案の表示)が出る");
  await page.locator(".k-daybtn").nth(6).click();
  assert.match(await page.locator("#view-week").innerText(), /外食の予定/); ok("週: 外食の食事には、外食の案内が出る");
  await noAvoid(page, "週");
  await shot(page, "week");
  // 日付の帯・その日のバランス(予定と食べた)
  assert.equal(await page.locator(".k-daybtn").count(), 7); assert.equal(await page.locator('.k-daybtn[aria-pressed="true"]').count(), 1); ok("週: 日付の帯(月〜日の7日)があり、1日が選ばれている");
  const idx = await page.$$eval(".k-daybtn", (els) => els.findIndex((e) => e.querySelector(".k-dots").textContent.includes("○")));
  assert.ok(idx >= 0); await page.locator(".k-daybtn").nth(idx).click();
  assert.equal(await page.locator('.k-daybtn[aria-pressed="true"]').count(), 1); assert.match(await page.locator(".k-daybal").innerText(), /のバランス/);
  assert.ok(await page.locator(".k-daybal .k-gauge").count() > 0 && await page.locator(".k-daybal .k-bar-plan").count() > 0); assert.match(await page.locator(".k-daybal").innerText(), /予定/);
  assert.match(await page.locator(".k-daybal").innerText(), /まだ食べた記録がありません/); ok("週: 日付をタップすると、その日のバランス(予定のゲージ)が出る。食べた記録がないときは案内が出る");
  await noAvoid(page, "週のバランス");
  const selDate = await page.locator('.k-daybtn[aria-pressed="true"]').getAttribute("aria-label");
  // 食べた
  const eatBtn = page.locator('[data-act="eaten"][data-eaten="true"]').first();
  const eatAt = { date: await eatBtn.getAttribute("data-date"), slot: await eatBtn.getAttribute("data-slot") };
  await eatBtn.click();
  await page.waitForFunction(() => document.querySelector('[data-act="eaten"][data-eaten="false"]'));
  const eatPatch = st.calls.filter((c) => c.method === "PATCH").pop().body;
  assert.deepEqual({ a: eatPatch.action, d: eatPatch.date, s: eatPatch.slot, e: eatPatch.eaten }, { a: "eaten", d: eatAt.date, s: eatAt.slot, e: true });
  assert.match(await page.locator("#view-week").innerText(), /食べた ✓/); assert.match(await page.locator(".k-daybal").innerText(), /食べた: /);
  assert.ok((await page.locator(".k-daybtn").nth(idx).locator(".k-dots").innerText()).includes("●")); assert.equal(st.runCalls, 3); ok("週: 「食べた」を押すと、食べた印が付き、その日のバランスと日付の帯(●)に反映される(AIは使わない)");
  await page.locator('[data-act="eaten"][data-eaten="false"]').first().click();
  await page.waitForFunction(() => !document.querySelector('[data-act="eaten"][data-eaten="false"]'));
  assert.equal(st.eaten.size, 0); ok("週: 「食べた ✓(取り消す)」で取り消せる");
  // 変更する(説明つきの選択肢)
  await page.locator('[data-act="change"]').first().click();
  const cs = await page.locator(".k-sheet").innerText();
  assert.match(cs, /保存したレシピから選ぶ/); assert.match(cs, /外食にする/); assert.match(cs, /作る食事に戻す|作らない食事にする/); ok("週: 「変更する」で、保存レシピ・外食・作らない・決め直しが、説明つきで選べる");
  await page.click('.k-choice[data-do="swap"]');
  await page.waitForSelector(".k-pickrow"); await page.click(".k-pickrow >> nth=0");
  await page.waitForFunction(() => document.querySelector(".k-name-btn") && [...document.querySelectorAll(".k-name-btn")].some((b) => b.textContent === "鮭の塩焼き"));
  assert.equal(st.runCalls, 3); ok("週: 作成後でも、保存したレシピに差し替えられる(AIは使わない)");
  await page.locator('[data-act="change"]').first().click();
  await page.click('.k-choice[data-do="outing"]');
  await page.waitForFunction(() => /外食の予定/.test(document.querySelector("#view-week").innerText));
  assert.equal(st.runCalls, 3); ok("週: 作成後でも、外食に変えられる(AIは使わない)");
  // レシピの詳細・編集・再計算
  await page.locator('[data-act="detail"]', { hasText: "AIの野菜炒め" }).first().click();
  const dt = await page.locator(".k-sheet").innerText();
  assert.match(dt, /材料/); assert.match(dt, /キャベツ/); assert.match(dt, /作り方/); assert.match(dt, /炒める/); assert.match(dt, /450kcal/); ok("週: レシピをタップすると、材料・作り方・栄養の詳細が見られる");
  await page.click('.k-sheet [data-act="edit"]');
  await page.waitForSelector("#k-e-name");
  await page.fill('.k-edit-row [data-f="grams"] >> nth=0', ""); await page.click('.k-sheet [data-act="save-edit"]');
  assert.match(await page.locator("#k-e-err").innerText(), /グラム/); assert.equal(st.editCalls.length, 0); ok("週: グラムが空のままでは保存できず、サーバーにも送らない");
  await page.fill("#k-e-name", "野菜炒め(多め)"); await page.fill('.k-edit-row [data-f="grams"] >> nth=0', "400"); await page.click('.k-sheet [data-act="save-edit"]');
  await page.waitForFunction(() => document.querySelector(".k-detail") && /800kcal/.test(document.querySelector(".k-detail").innerText));
  assert.equal(st.editCalls.length, 1); assert.equal(st.editCalls[0].draft.name, "野菜炒め(多め)"); assert.equal(st.editCalls[0].draft.ingredients[0].grams, 400);
  assert.match(await page.locator(".k-detail").innerText(), /野菜炒め\(多め\)/); assert.equal(st.runCalls, 3); ok("週: 編集して保存すると、サーバーで栄養が再計算され(450→800kcal)、詳細に反映される(AIは使わない)");
  await page.click('.k-sheet [data-act="close"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".k-tag")].some((x) => x.textContent === "編集済み")); ok("週: 編集した料理には「編集済み」の印が付く");
  await shot(page, "week-day");
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

  assert.equal(st.runCalls, 3); assert.equal(st.photoCalls, 1);
  assert.deepEqual(st.aiLike, []); assert.deepEqual(unexpectedExternal(api), []);
  assert.deepEqual(errors, []);
  ok("AI系の通信(/api/ai など)は0件・外部通信は0件・ページのエラーは0件");
  await ctx.close();

  // ---- 週プランの回数の決まり(別のページで) ----
  // 偽サーバーの呼び出し回数が期待に届くまで待つ(1食ごとに画面が更新されるので、画面の変化だけでは終わりが分からない)
  const settle = async (w, runs) => { for (let i = 0; i < 100 && w.api.st.runCalls < runs; i++) await w.page.waitForTimeout(50); await w.page.waitForTimeout(500); };
  const weekFlow = async (setup, pick) => {
    const w = await newPage({ id: "u2", isAdmin: false });
    setup(w.api.st);
    await w.page.click("#tab-week"); await w.page.waitForSelector('[data-act="create"]');
    if (pick) await pick(w.page);
    return w;
  };
  // 夕食だけ選ぶ → ちょうど1回
  {
    const w = await weekFlow(() => {}, async (pg) => { await pg.click('.k-slotbtn[data-slot="breakfast"]'); await pg.click('.k-slotbtn[data-slot="lunch"]'); });
    assert.equal(await w.page.locator('[data-act="kind"]').count(), 7); assert.match(await w.page.locator("#view-week").innerText(), /最大1回/);
    await w.page.click('[data-act="create"]'); await w.page.waitForSelector(".k-quota[data-ai-confirm]");
    assert.match(await w.page.locator(".k-sheet").innerText(), /最大1回/);
    await w.page.click('.k-sheet [data-act="ok"]'); await w.page.waitForSelector(".k-name-btn");
    assert.equal(w.api.st.runCalls, 1); assert.deepEqual(w.api.st.runSlots, ["dinner"]);
    assert.deepEqual(w.api.st.calls.find((c) => c.path === "/api/week/plan").body.slots, ["dinner"]);
    ok("週: 夕食だけ選ぶと、AIにつながるAPIはちょうど1回(夕食)");
    await w.page.click('.k-slotbtn[data-slot="dinner"]').catch(() => {});
    assert.deepEqual(w.errors, []); await w.ctx.close();
  }
  // 最後の1つは外せない
  {
    const w = await weekFlow(() => {}, async (pg) => { await pg.click('.k-slotbtn[data-slot="breakfast"]'); await pg.click('.k-slotbtn[data-slot="lunch"]'); await pg.click('.k-slotbtn[data-slot="dinner"]'); });
    assert.equal(await w.page.locator('.k-slotbtn[aria-pressed="true"]').count(), 1); assert.equal(w.api.st.runCalls, 0);
    ok("週: 食事は1つ以上選ぶ(最後の1つは外せない)"); await w.ctx.close();
  }
  // 今月の残りが2回 → 2回まで(3回目は呼ばない)
  {
    const w = await weekFlow((s2) => { s2.quota = 2; });
    await w.page.click('[data-act="create"]'); await w.page.waitForSelector(".k-quota[data-ai-confirm]");
    const t2 = await w.page.locator(".k-sheet").innerText();
    assert.match(t2, /朝食・昼食/); assert.match(t2, /最大2回/); assert.match(t2, /残り: 2/);
    await w.page.click('.k-sheet [data-act="ok"]'); await settle(w, 2);
    assert.equal(w.api.st.runCalls, 2); assert.deepEqual(w.api.st.runSlots, ["breakfast", "lunch"]);
    ok("週: 今月の残りが2回のときは、AIにつながるAPIは2回まで(夕食は呼ばない)");
    await w.page.waitForSelector('[data-act="run"]'); assert.match(await w.page.locator('[data-act="run"]').innerText(), /決まっていない/);
    await w.ctx.close();
  }
  // 残り0回 → 確認の「使う」は押せず、AIは0回
  {
    const w = await weekFlow((s2) => { s2.quota = 0; });
    await w.page.click('[data-act="create"]'); await w.page.waitForSelector(".k-quota[data-ai-confirm]");
    assert.equal(await w.page.locator('.k-sheet [data-act="ok"]').isDisabled(), true);
    await w.page.click('.k-sheet [data-act="cancel"]'); await w.page.waitForTimeout(300);
    assert.equal(w.api.st.runCalls, 0); ok("週: 今月の残りが0回のときは、「考えてもらう」が押せず、AIにつながるAPIは0回"); await w.ctx.close();
  }
  // 途中で失敗 → そこで止める(再試行しない)
  {
    const w = await weekFlow((s2) => { s2.failSlot = "lunch"; });
    await w.page.click('[data-act="create"]'); await w.page.waitForSelector(".k-quota[data-ai-confirm]");
    await w.page.click('.k-sheet [data-act="ok"]'); await settle(w, 2);
    assert.equal(w.api.st.runCalls, 2); assert.deepEqual(w.api.st.runSlots, ["breakfast", "lunch"]);
    assert.equal(w.api.st.quota, 11, "失敗した回の回数は戻る(朝食の1回だけ使われている)");
    ok("週: 昼食でうまくいかなかったら、そこで止まり(夕食は呼ばない・再試行しない)、できた朝食は残る");
    assert.deepEqual(w.api.st.aiLike, []); assert.deepEqual(unexpectedExternal(w.api), []); assert.deepEqual(w.errors, []); await w.ctx.close();
  }
  console.log("\n" + passed + " 件OK");
} finally {
  await browser.close(); server.close();
}
