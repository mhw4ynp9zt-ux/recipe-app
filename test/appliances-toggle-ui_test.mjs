// 「調理家電を使う/使わない」スイッチの画面テスト(Playwright)。
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
const POT = { name: "レコルト 調理ポット", policy: "optional", note: "", spec: { capacity: "600ml", modes: [{ name: "ポタージュ", desc: "" }], ranges: "", cautions: [] } };

async function openPage(browser, { loggedIn, appliances }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = { external: [], createBodies: [], aiLike: [] };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { seen.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/auth/me") return json(200, { user: loggedIn ? { id: "u1", isAdmin: false } : null });
    if (url.pathname === "/api/user/appliances" && route.request().method() === "GET") return json(200, { appliances, max: 5, maxNameLength: 20, maxNoteLength: 100 });
    if (url.pathname === "/api/ai/create-recipe") { seen.createBodies.push(JSON.parse(route.request().postData() || "{}")); return json(500, { error: "テスト用の偽の応答" }); }
    if (/\/(ai|extract)/.test(url.pathname)) seen.aiLike.push(url.pathname);
    return json(200, {});
  });
  await page.goto(base + "/");
  await page.waitForTimeout(600);
  return { page, ctx, seen };
}
const visible = (page) => page.evaluate(() => { const el = document.getElementById("appliance-use-panel"); return !!el && !el.hidden; });
const create = async (page, seen) => { const n = seen.createBodies.length; await page.click("#btn-generate"); await page.waitForTimeout(500); assert.equal(seen.createBodies.length, n + 1, "作成要求が1回だけ送られる"); return seen.createBodies[n]; };

const browser = await chromium.launch();
try {
  { // 登録あり・ログイン中: スイッチが出る。初期は「使う」で、何も付けずに送る
    const { page, ctx, seen } = await openPage(browser, { loggedIn: true, appliances: [POT] });
    assert.equal(await visible(page), true, "スイッチが出る");
    assert.equal(await page.getAttribute('.appliance-use-btn[data-use="1"]', "aria-pressed"), "true");
    const body = await create(page, seen);
    assert.equal("useAppliances" in body, false, "「使う」のときは従来どおり何も付けない");
    ok("登録あり・ログイン中: スイッチが出る(初期は「使う」)。「使う」のとき従来どおりの要求");

    await page.click('.appliance-use-btn[data-use="0"]');
    assert.equal(await page.getAttribute('.appliance-use-btn[data-use="0"]', "aria-pressed"), "true");
    const body2 = await create(page, seen);
    assert.equal(body2.useAppliances, false);
    assert.equal(JSON.stringify(body2).includes("レコルト"), false, "家電の中身は送らない");
    ok("「使わない」を選ぶと useAppliances:false だけが送られる(家電の中身は送らない)");

    await page.reload(); await page.waitForTimeout(600);
    assert.equal(await page.getAttribute('.appliance-use-btn[data-use="0"]', "aria-pressed"), "true");
    ok("選択はこの端末に記憶され、開き直しても「使わない」のまま");
    assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信(AI含む)なし"); assert.deepEqual(seen.aiLike, [], "AIに到達する通信なし");
    await ctx.close();
  }
  { // 登録なし: スイッチは出ず、何も付けない
    const { page, ctx, seen } = await openPage(browser, { loggedIn: true, appliances: [] });
    assert.equal(await visible(page), false);
    const body = await create(page, seen);
    assert.equal("useAppliances" in body, false);
    ok("家電が未登録: スイッチは出ず、何も付けない");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
  { // ログアウト中: スイッチは出ない(以前「使わない」を選んでいても何も付けない)
    const { page, ctx, seen } = await openPage(browser, { loggedIn: false, appliances: [POT] });
    await page.evaluate(() => localStorage.setItem("recipeRouletteUseAppliancesV1", "0"));
    await page.reload(); await page.waitForTimeout(600);
    assert.equal(await visible(page), false);
    assert.equal(seen.createBodies.length, 0);
    ok("ログアウト中: スイッチは出ない");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log("\n" + passed + " 件 PASS(実際のAI・想定外の外部への通信: 0件。静的資産は遮断)");
