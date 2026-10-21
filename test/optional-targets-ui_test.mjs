// 「買い足しOK」スイッチのON色と、栄養の目標を選ばなくてもレシピを作れることの画面テスト(Playwright)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る
//   ・ブラウザの全通信を route で横取りし、/api/* は偽の応答、127.0.0.1 以外は遮断して件数を数える → 外部通信は0件を assert
//   ・/api/ai/create-recipe は、送られた中身を記録して偽のジョブIDを返すだけ(AIにも到達しない)。ジョブの結果も、このテストが作る偽のレシピ
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
const STATIC_EXTERNAL = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"]);
const unexpectedExternal = (seen) => seen.external.filter((u) => !STATIC_EXTERNAL.has(new URL(u).hostname));

const FAKE_DISH = { name: "テスト用の炒め物", type: "主菜", ingredients: ["鶏むね肉 100g"], steps: ["焼く"], nutrition: { calories: 300, protein: 25, fat: 8, salt: 1.2, fiber: 2, carbs: 30, veg: 80 }, nutritionCheck: { unmatched: [], missing: [] }, ingredientDetails: [] };

async function openPage(browser, { metricsState } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = { external: [], createBodies: [], aiLike: [] };
  if (metricsState) await page.addInitScript((s) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("recipeRouletteTargetMetricsV1", JSON.stringify(s)); sessionStorage.setItem("seeded", "1"); } }, metricsState);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { seen.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname === "/api/auth/me") return json(200, { user: { id: "u1", isAdmin: false } });
    if (url.pathname === "/api/user/appliances") return json(200, { appliances: [], max: 5, maxNameLength: 20, maxNoteLength: 100 });
    if (url.pathname === "/api/user/excluded-foods") return json(200, { foods: [], max: 30, maxLength: 20 });
    if (url.pathname === "/api/ai/create-recipe") { seen.createBodies.push(JSON.parse(route.request().postData() || "{}")); return json(200, { jobId: "job-fake-1" }); }
    if (url.pathname.startsWith("/api/ai/jobs/")) {
      if (route.request().method() === "GET") return json(200, { status: "done", stage: "done", progress: 100, result: { dishes: [FAKE_DISH], nutritionOk: true, targetCheck: { ok: true, tolerancePct: 10, attempts: 1, results: [] } } });
      return json(200, {});
    }
    if (/\/(ai|extract)/.test(url.pathname)) seen.aiLike.push(url.pathname);
    return json(200, {});
  });
  await page.goto(base + "/");
  await page.waitForTimeout(600);
  return { page, ctx, seen };
}

const browser = await chromium.launch();
try {
  { // 買い足しOK: ONのときは色がつき、OFFのときは付かない
    const { page, ctx, seen } = await openPage(browser);
    const bg = () => page.$eval("#allow-extra-input", (el) => getComputedStyle(el).backgroundColor);
    const rowBg = () => page.$eval("#allow-extra-row", (el) => getComputedStyle(el).backgroundColor);
    assert.equal(await page.isChecked("#allow-extra-input"), true, "初期はON");
    const onBg = await bg(); const onRow = await rowBg();
    assert.equal(onBg, "rgb(242, 179, 170)", "ONのスイッチは、選択中のチップと同じやわらかいピンク: " + onBg);
    assert.equal(onRow, "rgb(242, 179, 170)", "ONのときは行全体にも色がつく: " + onRow);
    await page.click("#allow-extra-row");
    assert.equal(await page.isChecked("#allow-extra-input"), false);
    await page.waitForTimeout(400); // 色の切り替えアニメーション(0.15秒)が終わるのを待つ
    const offBg = await bg(); const offRow = await rowBg();
    assert.notEqual(offBg, onBg, "OFFでは色が変わる"); assert.notEqual(offRow, onRow, "OFFでは行の色も戻る");
    await page.click("#allow-extra-row");
    await page.waitForTimeout(400);
    assert.equal(await bg(), onBg, "もう一度ONにすると色が戻る");
    ok("「買い足しOK」はONのときだけ色がつく(スイッチ・行とも)");
    assert.deepEqual(unexpectedExternal(seen), []); await ctx.close();
  }

  { // 栄養の目標: 最後の1つも外せて、何も選ばなくても作成できる
    const { page, ctx, seen } = await openPage(browser, { metricsState: { protein: true, veg: false, fat: false, salt: false, fiber: false, carbs: false, calories: false } });
    assert.equal(await page.locator(".metric-toggle-btn.active").count(), 1, "最初は1つだけ選択");
    await page.click('.metric-toggle-btn[data-metric="protein"]');
    assert.equal(await page.locator(".metric-toggle-btn.active").count(), 0, "最後の1つも外せる");
    assert.equal(await page.locator("#target-row .target-item").count(), 0, "目標の入力欄は出ない");
    const hint = await page.textContent("#create-target-hint");
    assert.ok(hint.includes("栄養バランスの良い"), "ヒントは目標なしの文言: " + hint);
    ok("栄養の目標を全部外せる(入力欄は消え、ヒントは「栄養バランスの良い」になる)");

    await page.click("#btn-generate");
    await page.waitForTimeout(900);
    assert.equal(seen.createBodies.length, 1, "目標なしでも作成要求は1回送られる");
    assert.deepEqual(seen.createBodies[0].targets, {}, "targets は空: " + JSON.stringify(seen.createBodies[0].targets));
    ok("目標を選ばなくても作成できる(送る targets は空)");

    const text = await page.textContent("body");
    assert.ok(text.includes("テスト用の炒め物"), "偽の結果が表示される");
    assert.ok(!text.includes("目標の±"), "目標が無いのに「目標の±○%以内」とは出さない");
    ok("目標なしの結果に「目標の±○%以内」の表示は出ない");

    await page.reload(); await page.waitForTimeout(500);
    assert.equal(await page.locator(".metric-toggle-btn.active").count(), 0, "再読み込みしても、全部外した状態が記憶される");
    ok("全部外した状態は、再読み込みしても記憶される");
    assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信が0件");
    assert.deepEqual(seen.aiLike, [], "AI系の通信が0件");
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log("\n" + passed + " 件 PASS(実際のAI・外部への通信: 0件。静的資産は遮断)");
