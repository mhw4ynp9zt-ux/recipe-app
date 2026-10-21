// 保存済み一覧のカードに、検索条件に関わらず7つの栄養素を常に表示する画面テスト(Playwright)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る
//   ・ブラウザの全通信を route で横取りし、/api/* は偽の応答、127.0.0.1 以外は遮断して件数を数える → 外部通信・AI系通信は0件を assert
//   ・未ログインで、この端末(localStorage)に偽のレシピを入れて表示するだけ(サーバー・AIには保存も生成もしない)
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

const LABELS = ["たんぱく質", "野菜", "脂質", "塩分", "食物繊維", "糖質", "カロリー"];
const FULL = { calories: 793, protein: 59.3, fat: 19.6, salt: 4.9, fiber: 8.8, carbs: 87.3, veg: 110 };
// 検索条件が「たんぱく質」だけだった頃の保存データ(最上位に protein だけ。全指標は nutrition に入っている)
const proteinOnly = { id: "t-1", category: "created", type: "パン", name: "テスト用パン", ingredients: ["小麦粉 100g"], steps: ["焼く"], protein: 20.4, nutrition: { ...FULL, protein: 20.4 } };
// 全指標が最上位にある保存データ(nutrition なし)
const topLevelAll = { id: "t-2", category: "created", type: "パスタ", name: "テスト用パスタ", ingredients: ["パスタ 100g"], steps: ["茹でる"], ...FULL };
// 古い保存データ(たんぱく質と野菜しか持たない)。0 は「値あり」として表示される
const legacy = { id: "t-3", category: "created", type: "スープ", name: "テスト用スープ", ingredients: ["水 100g"], steps: ["煮る"], protein: 0, veg: 120 };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = { external: [], aiLike: [], writes: [] };
  await page.addInitScript((list) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("recipeRouletteSavedV1", JSON.stringify(list)); sessionStorage.setItem("seeded", "1"); } }, [proteinOnly, topLevelAll, legacy]);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") { seen.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (route.request().method() !== "GET") seen.writes.push(url.pathname);
    if (/\/(ai|extract)/.test(url.pathname)) seen.aiLike.push(url.pathname);
    const json = (status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (url.pathname === "/api/auth/me") return json(200, { user: null });
    return json(200, {});
  });
  await page.goto(base + "/");
  await page.waitForTimeout(600);
  await page.evaluate(() => { const t = document.querySelector('[data-tab="saved"], #tab-saved'); if (t) t.click(); });
  await page.waitForTimeout(300);

  const macro = async (name) => page.$$eval(".saved-card", (cards, n) => {
    const c = cards.find((x) => x.querySelector("h2").textContent.trim() === n);
    return c ? c.querySelector(".saved-macro").textContent.trim() : null;
  }, name);

  const a = await macro("テスト用パン");
  assert.ok(a, "カードが表示される");
  LABELS.forEach((l) => assert.ok(a.includes(l), "「" + l + "」が表示される: " + a));
  assert.ok(a.includes("たんぱく質 20.4g") && a.includes("カロリー 793kcal") && a.includes("塩分 4.9g"), "nutrition の値が出る: " + a);
  ok("検索条件がたんぱく質だけだった保存データでも、7指標すべてが出る");

  const b = await macro("テスト用パスタ");
  LABELS.forEach((l) => assert.ok(b.includes(l)));
  assert.ok(b.includes("糖質 87.3g") && b.includes("野菜 110g"));
  ok("最上位に全指標がある保存データでも、7指標すべてが出る");

  const c = await macro("テスト用スープ");
  LABELS.forEach((l) => assert.ok(c.includes(l)));
  assert.ok(c.includes("たんぱく質 0g") && c.includes("野菜 120g") && c.includes("脂質 ー"), "0は値あり、値が無い指標は「ー」: " + c);
  ok("値を持たない古い保存データでも、7指標の項目は常に出る(無い値は「ー」、0は0g)");

  // 検索・条件クリアで絞り込んでも7指標のまま
  await page.fill("#saved-search-input", "パン");
  await page.waitForTimeout(200);
  const d = await macro("テスト用パン");
  LABELS.forEach((l) => assert.ok(d.includes(l)));
  ok("検索で絞り込んでも7指標のまま");

  assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信が0件");
  assert.deepEqual(seen.aiLike, [], "AI系の通信が0件");
  assert.deepEqual(seen.writes, [], "サーバーへの書き込みが0件");
  ok("外部通信・AI系通信・サーバー書き込みはすべて0件");
  await ctx.close();
} finally { await browser.close(); server.close(); }
console.log("\n" + passed + " 件 PASS(外部通信・AIへの通信: 0件)");
