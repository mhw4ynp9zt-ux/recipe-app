// 「買い足しOK」スイッチ(OFF=手持ちの食材だけで作る)の画面テスト(Playwright)。
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
async function openPage(browser, { loggedIn = true, pre = null } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (pre) await page.addInitScript(pre);
  const seen = { external: [], createBodies: [], aiLike: [] };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { seen.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/auth/me") return json(200, { user: loggedIn ? { id: "u1", isAdmin: false } : null });
    if (url.pathname === "/api/user/appliances" && route.request().method() === "GET") return json(200, { appliances: [], max: 5, maxNameLength: 20, maxNoteLength: 100 });
    if (url.pathname === "/api/ai/create-recipe") { seen.createBodies.push(JSON.parse(route.request().postData() || "{}")); return json(500, { error: "テスト用の偽の応答" }); }
    if (/\/(ai|extract)/.test(url.pathname)) seen.aiLike.push(url.pathname);
    return json(200, {});
  });
  await page.goto(base + "/");
  await page.waitForTimeout(600);
  return { page, ctx, seen };
}
const create = async (page, seen) => { const n = seen.createBodies.length; await page.click("#btn-generate"); await page.waitForTimeout(500); assert.equal(seen.createBodies.length, n + 1, "作成要求が1回だけ送られる"); return seen.createBodies[n]; };
const KEY = "recipeRouletteAllowExtraV1";
const checked = (page) => page.$eval("#allow-extra-input", (el) => el.checked);
const desc = (page) => page.$eval("#allow-extra-desc", (el) => el.textContent);

const browser = await chromium.launch();
try {
  { // 初期: スイッチは「買い足しOK」(ON)。何も付けずに送る(従来どおり)
    const { page, ctx, seen } = await openPage(browser);
    assert.equal(await page.locator("#allow-extra-row").count(), 1, "スイッチが1つ出る");
    assert.equal(await checked(page), true);
    assert.match(await desc(page), /買い足す前提/);
    assert.equal(await page.locator("#create-dishes + #allow-extra-row").count(), 1, "食材の入力欄のすぐ下に出る");
    const body = await create(page, seen);
    assert.equal("onlyListed" in body, false, "ONのときは従来どおり何も付けない");
    ok("初期はON(買い足しOK)。何も付けずに送る");

    // OFF: 説明が変わり、onlyListed: true が送られ、記憶される
    await page.click("#allow-extra-row");
    assert.equal(await checked(page), false);
    assert.match(await desc(page), /入力した食材だけ/);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), "0");
    const body2 = await create(page, seen);
    assert.equal(body2.onlyListed, true);
    ok("OFF: 説明が変わり、onlyListed:true を送り、この端末に記憶する");

    // 開き直してもOFFのまま。ONに戻すと記憶が消え、また何も付けない
    await page.reload(); await page.waitForTimeout(600);
    assert.equal(await checked(page), false, "開き直しても同じ");
    await page.click("#allow-extra-row");
    assert.equal(await checked(page), true);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null);
    assert.equal("onlyListed" in (await create(page, seen)), false);
    ok("開き直しても選択が残り、ONに戻すと記憶が消えて何も付けない");
    assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信(AI含む)なし"); assert.deepEqual(seen.aiLike, [], "AIに到達する通信なし");
    await ctx.close();
  }
  { // 食材を入力して OFF: 食材は従来どおり送られ、onlyListed が一緒に付く
    const { page, ctx, seen } = await openPage(browser);
    await page.fill('#create-dish-1-ingredients-list input', "鶏むね肉");
    await page.click("#allow-extra-row");
    const body = await create(page, seen);
    assert.equal(body.onlyListed, true); assert.equal(body.ingredients, "鶏むね肉"); assert.equal(body.dishes[0].ingredients, "鶏むね肉");
    ok("食材を入力してOFF: 食材と onlyListed:true が一緒に送られる");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
  { // 壊れた記憶値は「買い足しOK」(ON)として扱う
    const { page, ctx, seen } = await openPage(browser, { pre: "localStorage.setItem('recipeRouletteAllowExtraV1','abc')" });
    assert.equal(await checked(page), true);
    assert.equal("onlyListed" in (await create(page, seen)), false);
    ok("壊れた記憶値は従来どおり(ON)");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log("\n" + passed + " 件 PASS(実際のAI・想定外の外部への通信: 0件。静的資産は遮断)");
