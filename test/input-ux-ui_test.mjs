// 入力欄の改善(手間度の説明・今回だけの設定)の画面テスト(Playwright)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る
//   ・ブラウザの全通信を route で横取りし、/api/* は偽の応答、127.0.0.1 以外(unpkg など)は遮断して件数を数える → 外部通信は0件を assert
//   ・ /api/ai/create-recipe は、送られた中身を記録して「エラー」を返すだけ(AIにも到達しない)
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
// ページが読み込む静的な外部資産(フォント・認証ライブラリ)。これらも遮断する(route で abort)。これ以外の外部通信(特にAI)が出たらテスト失敗
const STATIC_EXTERNAL = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"]);
const unexpectedExternal = (seen) => seen.external.filter((u) => !STATIC_EXTERNAL.has(new URL(u).hostname));

async function openPage(browser, { loggedIn = true, appliances = [], foods = [], recent, createOk = false } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = { external: [], createBodies: [], aiLike: [] };
  if (recent) await page.addInitScript((r) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("recipeRouletteRecentIngredientsV1", JSON.stringify(r)); sessionStorage.setItem("seeded", "1"); } }, recent);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { seen.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname === "/api/auth/me") return json(200, { user: loggedIn ? { id: "u1", isAdmin: false } : null });
    if (url.pathname === "/api/user/appliances") return json(200, { appliances, max: 5, maxNameLength: 20, maxNoteLength: 100 });
    if (url.pathname === "/api/user/excluded-foods") return json(200, { foods, max: 30, maxLength: 20 });
    if (url.pathname === "/api/ai/create-recipe") { seen.createBodies.push(JSON.parse(route.request().postData() || "{}")); return createOk ? json(200, { jobId: "job-fake-1" }) : json(500, { error: "テスト用の偽の応答" }); }
    if (url.pathname.startsWith("/api/ai/jobs/")) return json(200, { status: "error", stage: "error", progress: 0, error: "テスト用の偽の応答" });
    if (/\/(ai|extract)/.test(url.pathname)) seen.aiLike.push(url.pathname);
    return json(200, {});
  });
  await page.goto(base + "/");
  await page.waitForTimeout(600);
  return { page, ctx, seen };
}
const create = async (page, seen) => { const n = seen.createBodies.length; await page.click("#btn-generate"); await page.waitForTimeout(500); assert.equal(seen.createBodies.length, n + 1, "作成要求は1回だけ"); return seen.createBodies[n]; };
const IN = "#create-dish-1-ingredients-list .chip-input";
const chipsOf = (page) => page.$$eval("#create-dish-1-ingredients-list .chip", (els) => els.map((e) => e.textContent.trim()));

const browser = await chromium.launch();
try {
  { // 改善4: 手間度の説明が常に全段階出る
    const { page, ctx, seen } = await openPage(browser);
    const n = await page.locator("#effort-desc-1 .effort-desc-item").count();
    assert.equal(n, 4, "全4段階の説明が最初から見える");
    assert.equal(await page.locator("#effort-desc-1 .effort-desc-item.active").count(), 0, "未選択なら強調なし");
    await page.click('#effort-row-1 .effort-btn[data-effort="1"]');
    assert.equal(await page.locator("#effort-desc-1 .effort-desc-item").count(), 4);
    assert.equal(await page.locator("#effort-desc-1 .effort-desc-item.active").count(), 1, "選んだ段階だけ強調");
    ok("改善4: 手間度の説明は全段階を常に表示し、選んだ段階だけ強調");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
  { // 改善7: 今回だけ使わない食材を除外しない
    const { page, ctx, seen } = await openPage(browser, { foods: ["エビ", "そば"], createOk: true });
    assert.equal(await page.isVisible("#appliance-use-panel"), true, "食材登録があれば家電なしでも出る");
    assert.equal(await page.locator(".appliance-use-row").count(), 0);
    assert.equal("useExcludedFoods" in (await create(page, seen)), false, "初期は何も付けない(除外する)");
    await page.click('.excluded-use-btn[data-use="0"]');
    assert.match(await page.textContent(".excluded-use-hint"), /アレルギー/);
    assert.match(await page.textContent("#create-excluded-hint"), /除外しません/);
    assert.equal((await create(page, seen)).useExcludedFoods, false);
    assert.equal(await page.getAttribute('.excluded-use-btn[data-use="1"]', "aria-pressed"), "true", "作成後は「除外する」に戻る");
    assert.equal("useExcludedFoods" in (await create(page, seen)), false);
    await page.click('.excluded-use-btn[data-use="0"]'); await page.reload(); await page.waitForTimeout(600);
    assert.equal(await page.getAttribute('.excluded-use-btn[data-use="1"]', "aria-pressed"), "true", "開き直すと「除外する」(保存しない)");
    ok("改善7: 今回だけ除外しない → false を送る。作成後・開き直しで「除外する」に戻る。登録は変えない");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
  { // 登録なし/ログアウト: パネルなし
    const a = await openPage(browser, { foods: [] });
    assert.equal(await a.page.isVisible("#appliance-use-panel"), false);
    assert.equal("useExcludedFoods" in (await create(a.page, a.seen)), false); await a.ctx.close();
    const b = await openPage(browser, { loggedIn: false, foods: ["エビ"] });
    assert.equal(await b.page.isVisible("#appliance-use-panel"), false); await b.ctx.close();
    ok("食材未登録・ログアウト: 今回だけの設定は出ず、何も付けない");
  }
} finally { await browser.close(); server.close(); }
console.log("\n" + passed + " 件 PASS(外部通信・AIへの通信: 0件)");
