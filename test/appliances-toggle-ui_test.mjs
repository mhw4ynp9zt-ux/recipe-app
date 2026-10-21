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

const HOT = { name: "ホットクック", policy: "optional", note: "", spec: { capacity: "1.6L", modes: [], ranges: "", cautions: [] } };
const btn = (name, use) => `.appliance-use-btn[data-name="${name}"][data-use="${use}"]`;
const pressed = (page, name, use) => page.getAttribute(btn(name, use), "aria-pressed");

const browser = await chromium.launch();
try {
  { // 2台登録・ログイン中: 家電ごとに行が出る。初期はすべて「使う」で、何も付けずに送る
    const { page, ctx, seen } = await openPage(browser, { loggedIn: true, appliances: [POT, HOT] });
    assert.equal(await visible(page), true, "スイッチが出る");
    assert.equal(await page.locator(".appliance-use-row").count(), 2);
    assert.equal(await pressed(page, POT.name, 1), "true"); assert.equal(await pressed(page, HOT.name, 1), "true");
    const body = await create(page, seen);
    assert.equal("excludeAppliances" in body, false, "すべて「使う」のときは従来どおり何も付けない");
    assert.equal("useAppliances" in body, false);
    ok("2台登録: 家電ごとの行が出て、初期はすべて「使う」。何も付けずに送る");

    await page.click(btn(POT.name, 0));
    assert.equal(await pressed(page, POT.name, 0), "true"); assert.equal(await pressed(page, HOT.name, 1), "true", "もう1台は「使う」のまま");
    const body2 = await create(page, seen);
    assert.deepEqual(body2.excludeAppliances, [POT.name]);
    assert.equal(JSON.stringify(body2).includes("ホットクック"), false); assert.equal("useAppliances" in body2, false);
    ok("1台だけ「使わない」: その家電の名前だけが excludeAppliances で送られる(家電の中身は送らない)");

    await page.click(btn(HOT.name, 0));
    assert.deepEqual((await create(page, seen)).excludeAppliances.sort(), [HOT.name, POT.name].sort());
    await page.click(btn(POT.name, 1)); await page.click(btn(HOT.name, 1));
    assert.equal("excludeAppliances" in (await create(page, seen)), false);
    ok("2台とも「使わない」→「使う」に戻すと、また何も付けない");

    await page.click(btn(HOT.name, 0));
    await page.reload(); await page.waitForTimeout(600);
    assert.equal(await pressed(page, HOT.name, 0), "true"); assert.equal(await pressed(page, POT.name, 1), "true");
    ok("選択は家電ごとにこの端末へ記憶され、開き直しても同じ");
    assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信(AI含む)なし"); assert.deepEqual(seen.aiLike, [], "AIに到達する通信なし");
    await ctx.close();
  }
  { // 記憶していた名前の家電が、いまは登録に無い → 送らない(古い名前を送らない)
    const { page, ctx, seen } = await openPage(browser, { loggedIn: true, appliances: [POT] });
    await page.evaluate(() => localStorage.setItem("recipeRouletteExcludedAppliancesV1", JSON.stringify(["削除した家電"])));
    await page.reload(); await page.waitForTimeout(600);
    assert.equal("excludeAppliances" in (await create(page, seen)), false);
    ok("登録に無い名前の「使わない」は送らない");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
  { // 登録なし: スイッチは出ず、何も付けない
    const { page, ctx, seen } = await openPage(browser, { loggedIn: true, appliances: [] });
    assert.equal(await visible(page), false);
    const body = await create(page, seen);
    assert.equal("excludeAppliances" in body, false);
    ok("家電が未登録: スイッチは出ず、何も付けない");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }
  { // ログアウト中: スイッチは出ない
    const { page, ctx, seen } = await openPage(browser, { loggedIn: false, appliances: [POT] });
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
