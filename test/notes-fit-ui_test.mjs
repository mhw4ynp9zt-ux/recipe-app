// マイキッチン欄の入力欄が、長い文章でも全文見える高さになるかを、本物のブラウザ(Playwright + Chromium)で確認するテスト。
// 原因: 設定タブが隠れている間に読み込むと、高さを測れず1行の高さのままになり、タブを開いても測り直されなかった。
// 【重要】外部への通信は一切しません。ページも API も、テストの中で偽物に差し替えています(実際のAIも呼ばれません=費用ゼロ)。
// Playwright が入っていない環境では「スキップ」と表示して正常終了します。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let chromium;
for (const spec of ["playwright", "/opt/npm-tools/node_modules/playwright/index.mjs"]) {
  try { ({ chromium } = await import(spec)); break; } catch (e) { /* 次を試す */ }
}
if (!chromium) { console.log("SKIP: Playwright が見つからないため、画面のテストはスキップしました"); process.exit(0); }

const settingsJs = readFileSync(new URL("../js/settings.js", import.meta.url), "utf8");
const ORIGIN = "http://app.test";
const LONG = "コンロが1つなので、ガスコンロを使うレシピは1提案につき1つまで";
const HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--ink:#2b2a28; --ink-soft:#6b675f; --ink-faint:#9a958b; --line-strong:#cfc8ba; --brand:#2f6f4f; --accent:#d9643f; --accent-soft:#fbe9e2; --protein:#c0392b; --veg:#2f7d4f;}
body{font-family:-apple-system,sans-serif; margin:0; padding:16px; background:#faf7f0; color:var(--ink);}
.panel{background:#fff; border-radius:16px; padding:18px; margin:0 0 16px;} .btn{border:none; border-radius:100px; padding:10px 20px;}
#view-settings{display:none;} #view-settings.active{display:block;}</style></head>
<body><div id="view-settings">
<div id="admin-section" hidden>
  <input id="grok-api-key"><p id="grok-key-state"></p><select id="grok-model"></select><input id="grok-daily-limit"><p id="grok-usage"></p>
  <button id="btn-grok-test"></button><button id="btn-grok-save"></button><p id="grok-test-status" hidden></p>
  <p id="foods-status"></p><button id="btn-foods-import"></button><p id="foods-import-msg" hidden></p>
</div></div>
<div class="field"><input type="hidden" id="create-mood"></div></body></html>`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const external = [];
await page.route("**/*", async (route) => {
  const req = route.request(); const url = new URL(req.url());
  if (url.origin !== ORIGIN) { external.push(req.url()); return route.abort(); }
  const json = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  if (url.pathname === "/") return route.fulfill({ status: 200, contentType: "text/html", body: HTML });
  if (url.pathname === "/api/user/personal-notes") return json({ notes: [LONG, "短い要望"], maxLines: 10, maxLength: 150 });
  if (url.pathname === "/api/user/excluded-foods") return json({ foods: [], max: 30, maxLength: 20 });
  return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
});

await page.goto(ORIGIN + "/");
await page.evaluate(() => { window.isLoggedIn = () => true; window.isAdmin = () => false; });
await page.addScriptTag({ content: settingsJs });

let passed = 0;
const ok = (name) => { passed++; console.log("  ✓ " + name); };
// 欄が文章を全部見せているか(中身の高さ <= 表示の高さ)
const clipped = () => page.$$eval(".notes-item-input", (els) => els.map((e) => e.scrollHeight > e.clientHeight + 1));

// 1. 設定タブが隠れている状態でログイン・読み込み → その後タブを開いても、全文が見える(今回の不具合)
{
  await page.evaluate(() => onAuthChanged());
  await page.waitForFunction(() => document.querySelector(".notes-item-input")?.value !== "");
  await page.evaluate(() => document.getElementById("view-settings").classList.add("active"));
  await page.waitForFunction(() => { const e = document.querySelector(".notes-item-input"); return e && e.clientHeight > 60; });
  assert.deepEqual(await clipped(), [false, false], "隠れている間に読み込んでも、表示したら全文が見える");
  const h = await page.$$eval(".notes-item-input", (els) => els.map((e) => e.clientHeight));
  assert.ok(h[0] > h[1], "長い文章の欄は複数行ぶん高く、短い欄は1行のまま: " + h);
  ok("タブが隠れている間に読み込んでも、開いたときに長い文章が全文見える");
}

// 2. 画面の幅が変わる(回転など)と、折り返しが変わるので、高さも測り直される
{
  await page.setViewportSize({ width: 300, height: 844 });
  await page.waitForTimeout(200);
  assert.deepEqual(await clipped(), [false, false], "幅が狭くなっても全文が見える");
  await page.setViewportSize({ width: 800, height: 844 });
  await page.waitForTimeout(200);
  assert.deepEqual(await clipped(), [false, false], "幅が広がっても切れない");
  ok("画面の幅が変わっても、全文が見える高さに追従する");
}

// 3. 入力中も従来どおり伸びる
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.fill(".notes-item-input >> nth=1", "あ".repeat(120));
  assert.deepEqual(await clipped(), [false, false], "入力しても切れない");
  ok("入力中の高さ調整も従来どおり動く");
}

// 4. 外部通信ゼロ
{
  assert.deepEqual(external, [], "外部への通信: " + external.join(", "));
  ok("外部への通信は0件(ページもAPIもテスト内の偽物。AIは呼ばれない)");
}

await browser.close();
console.log("\nマイキッチン入力欄の高さテスト 全 " + passed + " 件 OK");
