// 保存済みタブ(2列タイル・役割の切り替え・並べ替え・「詳しく絞り込む」シート・レシピの詳細シート・右下の＋)の画面テスト(Playwright)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る
//   ・ブラウザの全通信を route で横取りし、/api/* は偽の応答、127.0.0.1 以外は遮断して件数を数える
//     → 外部通信(フォント・ライブラリの静的配信を除く)・AI系通信・サーバーへの書き込みは0件を assert
//   ・未ログイン(この端末の localStorage に偽のレシピを入れて表示)と、ログイン中(偽のサーバー応答)の2通り
// スクリーンショットを見たいときは、環境変数 SHOT_DIR に保存先のフォルダを指定する(通信はしない)。
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
const SHOT_DIR = process.env.SHOT_DIR || "";

const LABELS = ["たんぱく質", "野菜", "脂質", "塩分", "食物繊維", "糖質", "カロリー"];
const nut = (calories, protein, veg, fat, salt, fiber, carbs) => ({ calories, protein, veg, fat, salt, fiber, carbs });
// 古い順に保存した6件(一覧は新しいものが上)
const R = [
  { id: "r1", category: "created", type: "パスタ", name: "鶏肉とブロッコリーの和風ペペロンチーノ", genre: "イタリアン", role: "主食", main: "肉", ingredients: ["パスタ 100g", "鶏むね肉 150g"], steps: ["茹でる", "炒める"], nutrition: nut(793, 59.3, 110, 19.6, 4.9, 8.8, 87.3) },
  { id: "r2", category: "created", type: "煮物", name: "サバ缶と大根のみそ煮", genre: "和食", role: "主菜", main: "魚介", ingredients: ["サバ水煮缶 1缶"], steps: ["煮る"], nutrition: nut(412, 34, 180, 18, 3.1, 4.2, 20) },
  { id: "r3", category: "created", type: "焼き物", name: "鶏むねのチーズ焼き", genre: "洋食", role: "主菜", main: "肉", ingredients: ["鶏むね肉 250g"], steps: ["焼く"], nutrition: nut(658, 65, 5, 38.9, 2.5, 0.4, 5) },
  { id: "r4", category: "created", type: "炒め物", name: "トマトと卵の中華炒め", genre: "中華", role: "副菜", main: "卵", ingredients: ["卵 2個", "トマト 1個"], steps: ["炒める"], nutrition: nut(336, 22, 150, 20, 1.8, 2, 12) },
  { id: "r5", category: "created", type: "サラダ", name: "コールスロー", genre: "洋食", role: "副菜", main: "野菜", ingredients: ["キャベツ 150g"], steps: ["和える"], nutrition: nut(120, 2, 160, 6, 1.5, 3, 10) },
  // 分類も栄養値もない古い形式の保存データ
  { id: "r6", category: "created", type: "その他", name: "分類なしの古いレシピ", ingredients: ["水 100g"], steps: ["温める"] },
];

const browser = await chromium.launch();
try {
  // ============ 未ログイン(この端末に保存したレシピ) ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const seen = { external: [], aiLike: [], writes: [] };
    await page.addInitScript((list) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("recipeRouletteSavedV1", JSON.stringify(list)); sessionStorage.setItem("seeded", "1"); } }, R);
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/");
    await page.waitForTimeout(600);
    await page.click("#tab-saved");
    await page.waitForTimeout(300);
    const shot = async (name) => { if (SHOT_DIR) await page.waitForTimeout(400), await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); };
    const titles = () => page.$$eval("#saved-list .saved-tile .saved-tile-title", (els) => els.map((e) => e.textContent.trim()));
    const total = () => page.textContent("#saved-total");
    await shot("01-list");

    // ---- タイル ----
    assert.deepEqual(await titles(), ["分類なしの古いレシピ", "コールスロー", "トマトと卵の中華炒め", "鶏むねのチーズ焼き", "サバ缶と大根のみそ煮", "鶏肉とブロッコリーの和風ペペロンチーノ"], "新しく保存したものが上");
    assert.equal(await page.$(".saved-card"), null, "以前の開閉カードは出ない");
    const cols = await page.$eval("#saved-list", (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    assert.equal(cols, 2, "2列");
    const tile = await page.$eval('.saved-tile[data-id="r1"]', (el) => el.textContent);
    ["793", "kcal", "パスタ", "たんぱく質 59g", "脂質 20g", "糖質 87g", "塩分 4.9g", "食物繊維 8.8g", "野菜 110g"].forEach((x) => assert.ok(tile.includes(x), "タイルに「" + x + "」: " + tile));
    assert.ok(!/(^|[^A-Za-z])[PFC]\s?\d/.test(tile), "P/F/C の略称は使わない: " + tile);
    assert.deepEqual(await page.$$eval('.saved-tile[data-id="r1"] .saved-tile-chip', (e) => e.map((x) => x.className.replace("saved-tile-chip m-", ""))), ["protein", "fat", "carbs", "salt", "fiber", "veg"], "6項目が同じ形のチップで、この順に出る");
    assert.equal(await total(), "6件");
    ok("2列のタイルで、新しい順に出る(カロリー・6項目のチップ・種類)");

    // 値の無い古いレシピも壊れない
    const oldTile = await page.$eval('.saved-tile[data-id="r6"]', (el) => el.textContent);
    assert.ok(oldTile.includes("ー"), "値が無いときは「ー」: " + oldTile);
    ok("栄養値の無い古いレシピも、「ー」で出る");

    // ---- 役割の切り替え ----
    const segTexts = await page.$$eval("#saved-role-seg button", (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(segTexts, ["すべて", "主菜", "副菜", "汁物", "主食", "未分類"], "役割の切り替え(未分類は該当があるときだけ)");
    assert.equal(await page.$eval('#saved-role-seg [data-role="汁物"]', (b) => b.disabled), true, "0件の役割は押せない");
    await page.click('#saved-role-seg [data-role="主菜"]');
    assert.deepEqual(await titles(), ["鶏むねのチーズ焼き", "サバ缶と大根のみそ煮"]);
    assert.equal(await total(), "2/6件");
    assert.equal(await page.$eval('#saved-role-seg [data-role="主菜"]', (b) => b.getAttribute("aria-pressed")), "true");
    await shot("02-role");
    await page.click('#saved-role-seg [data-role="主菜"]'); // 選択中をもう一度押すと解除
    assert.equal((await titles()).length, 6);
    await page.click('#saved-role-seg [data-role="未分類"]');
    assert.deepEqual(await titles(), ["分類なしの古いレシピ"]);
    await page.click('#saved-role-seg [data-role=""]');
    assert.equal((await titles()).length, 6);
    ok("役割の切り替えで絞り込める(再タップで解除・0件の役割は無効・未分類)");

    // ---- 並べ替え ----
    await page.selectOption("#saved-sort", "protein");
    assert.deepEqual((await titles()).slice(0, 3), ["鶏むねのチーズ焼き", "鶏肉とブロッコリーの和風ペペロンチーノ", "サバ缶と大根のみそ煮"], "たんぱく質が多い順");
    assert.equal((await titles()).at(-1), "分類なしの古いレシピ", "栄養値の無いものは最後");
    await page.selectOption("#saved-sort", "cal-asc");
    assert.deepEqual((await titles()).slice(0, 2), ["コールスロー", "トマトと卵の中華炒め"], "カロリーが低い順");
    await page.selectOption("#saved-sort", "cal-desc");
    assert.equal((await titles())[0], "鶏肉とブロッコリーの和風ペペロンチーノ", "カロリーが高い順");
    await page.selectOption("#saved-sort", "new");
    assert.equal((await titles())[0], "分類なしの古いレシピ");
    ok("並べ替え(たんぱく質・カロリー・新しい順。値の無いものは最後)");

    // ---- 詳しく絞り込む(シート) ----
    assert.equal(await page.isVisible("#saved-filter-sheet"), false);
    await page.click("#saved-filter-open");
    assert.equal(await page.isVisible("#saved-filter-sheet"), true, "シートが開く");
    assert.equal(await page.$eval(".app", (a) => a.inert), true, "後ろの画面は操作できない");
    assert.equal(await page.$eval("body", (b) => getComputedStyle(b).overflow), "hidden", "後ろの画面はスクロールしない");
    const sheetText = await page.textContent("#saved-filter-sheet");
    ["系統", "主材料", "たんぱく質", "カロリー", "塩分", "野菜", "脂質", "食物繊維", "糖質"].forEach((t) => assert.ok(sheetText.includes(t), "シートに「" + t + "」"));
    assert.equal(sheetText.includes("役割"), false, "役割は一覧の上の切り替え側にある");
    assert.equal(sheetText.includes("ほかの栄養"), false, "「ほかの栄養」の見出しは無い");
    assert.equal(await page.$("#saved-filter-sheet details"), null, "折りたたみは無い");
    assert.deepEqual(await page.$$eval("#saved-filter-sheet .range-row .range-label", (e) => e.map((x) => x.textContent.trim())), ["たんぱく質", "カロリー", "塩分", "野菜", "脂質", "食物繊維", "糖質"], "7指標が1つのリストに並ぶ");
    for (const el of await page.$$("#saved-filter-sheet .range-row input")) assert.equal(await el.isVisible(), true, "最初から見えている");
    assert.equal(await page.$eval('#saved-filter-sheet [data-axis="genre"][data-value="韓国"]', (b) => b.disabled), true, "0件のチップは押せない");
    await shot("03-sheet");

    await page.click('#saved-filter-sheet [data-axis="genre"][data-value="洋食"]');
    await page.waitForTimeout(100);
    assert.equal(await page.$eval("#saved-filter-apply", (b) => b.textContent.trim()), "2件を表示する", "シートの下のボタンに件数");
    assert.deepEqual((await titles()).sort(), ["コールスロー", "鶏むねのチーズ焼き"].sort());
    await page.fill('#saved-filter-sheet [data-range="protein:min"]', "３０"); // 全角でもOK
    await page.waitForTimeout(100);
    assert.deepEqual(await titles(), ["鶏むねのチーズ焼き"], "洋食 かつ たんぱく質30g以上");
    assert.equal(await page.$eval("#saved-filter-apply", (b) => b.textContent.trim()), "1件を表示する");
    // 野菜(以前は折りたたみの中だった指標)も、そのまま指定できる
    await page.fill('#saved-filter-sheet [data-range="veg:max"]', "10");
    await page.waitForTimeout(100);
    assert.deepEqual(await titles(), ["鶏むねのチーズ焼き"]);
    // 閉じて、適用中の条件が一覧の上に出る
    await page.click("#saved-filter-apply");
    assert.equal(await page.isVisible("#saved-filter-sheet"), false, "閉じる");
    assert.equal(await page.$eval(".app", (a) => a.inert), false);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "saved-filter-open", "開いたボタンへフォーカスが戻る");
    const chips = await page.$$eval("#saved-active .active-chip", (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(chips, ["洋食 ×", "たんぱく質 30g以上 ×", "野菜 10g以下 ×"]);
    assert.equal(await page.textContent("#saved-filter-badge"), "3", "ボタンに条件の数");
    assert.equal(await total(), "1/6件");
    await shot("04-active");
    // ×で外す
    await page.click('#saved-active [data-clear="range:veg"]');
    await page.click('#saved-active [data-clear="genre"]');
    assert.deepEqual((await titles()).slice(0, 2), ["鶏むねのチーズ焼き", "サバ缶と大根のみそ煮"], "たんぱく質30g以上だけが残る");
    assert.equal(await page.$eval('#saved-filter-sheet [data-range="veg:max"]', (i) => i.value), "", "外した条件は入力欄からも消える");
    // Esc で閉じる / クリアで全部戻る
    await page.click("#saved-filter-open");
    await page.keyboard.press("Escape");
    assert.equal(await page.isVisible("#saved-filter-sheet"), false, "Escで閉じる");
    await page.click("#saved-filter-open");
    await page.click("#saved-filter-clear");
    assert.equal((await titles()).length, 6);
    assert.equal(await page.isHidden("#saved-active"), true);
    await page.click("#saved-filter-sheet .saved-sheet-backdrop", { position: { x: 20, y: 20 } });
    assert.equal(await page.isVisible("#saved-filter-sheet"), false, "外側をタップで閉じる");
    ok("「詳しく絞り込む」シート(系統・主材料・栄養の範囲・件数・×で外す・クリア・Esc・外側タップ)");

    // 条件に合うものが無いとき
    await page.click("#saved-filter-open");
    await page.fill('#saved-filter-sheet [data-range="protein:min"]', "500");
    await page.waitForTimeout(100);
    assert.equal((await titles()).length, 0);
    assert.match(await page.textContent("#saved-no-match"), /条件に一致するレシピはありません/);
    await page.click("#saved-filter-clear");
    await page.click("#saved-filter-apply");
    ok("条件に合うレシピが無いときの案内");

    // ---- 検索(虫めがねで開く) ----
    assert.equal(await page.isHidden("#saved-search"), true, "検索欄は普段は隠れている");
    await page.click("#saved-search-toggle");
    assert.equal(await page.isVisible("#saved-search-input"), true);
    await page.fill("#saved-search-input", "卵");
    assert.deepEqual(await titles(), ["トマトと卵の中華炒め"]);
    assert.match(await page.textContent("#saved-search-count"), /1件ヒット\(保存6件中\)/);
    await page.click("#saved-search-toggle"); // 開いているときに押すと、入力を消して閉じる
    assert.equal(await page.isHidden("#saved-search"), true);
    assert.equal((await titles()).length, 6);
    ok("検索は虫めがねで開き、もう一度押すと入力を消して閉じる");

    // ---- 詳細シート ----
    await page.click('.saved-tile[data-id="r1"]');
    const detail = "#saved-detail";
    assert.equal(await page.isVisible(detail), true);
    const dText = await page.textContent("#saved-detail-panel");
    LABELS.forEach((l) => assert.ok(dText.includes(l), "詳細に「" + l + "」"));
    assert.ok(dText.includes("59.3g") && dText.includes("793kcal") && dText.includes("糖質") && dText.includes("87.3g"), "7指標の値: " + dText);
    assert.ok(dText.includes("鶏むね肉") && dText.includes("茹でる"), "材料と作り方");
    assert.ok(dText.includes("パスタ") && dText.includes("イタリアン") && dText.includes("主食"), "種類・分類のタグ");
    assert.equal(await page.$eval("#saved-detail .edit-saved-btn", (b) => b.disabled), true, "未ログインでは編集できない");
    assert.ok((await page.textContent(detail)).includes("ログインすると編集できます"));
    await shot("05-detail");
    // 値の無い古いレシピでも、7指標の項目は常に出る
    await page.keyboard.press("Escape");
    await page.click('.saved-tile[data-id="r6"]');
    const d6 = await page.textContent("#saved-detail-panel");
    LABELS.forEach((l) => assert.ok(d6.includes(l), "値が無くても「" + l + "」の項目は出る"));
    assert.ok(d6.includes("ー"));
    ok("タップで詳細シートが開き、7指標・材料・作り方が出る(値が無くても7項目)");

    // 削除: キャンセルでは消えない / OKで消えて、シートが閉じる
    await page.keyboard.press("Escape");
    await page.click('.saved-tile[data-id="r5"]');
    page.once("dialog", (d) => d.dismiss());
    await page.click("#saved-detail .remove-saved-btn");
    assert.equal(await page.isVisible(detail), true, "キャンセルすると開いたまま");
    assert.equal((await titles()).length, 6);
    let message = "";
    page.once("dialog", (d) => { message = d.message(); d.accept(); });
    await page.click("#saved-detail .remove-saved-btn");
    assert.match(message, /「コールスロー」を保存済みから削除しますか/);
    assert.equal(await page.isVisible(detail), false, "削除するとシートが閉じる");
    assert.equal((await titles()).includes("コールスロー"), false);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("recipeRouletteSavedV1"))).length, 5, "端末の保存からも消える");
    assert.equal(await total(), "5件");
    ok("削除は確認してから消える(キャンセルでは残る)。シートが閉じ、件数も更新される");

    // ---- 右下の＋(自作レシピ) とタブバー ----
    const fab = await page.$eval("#new-recipe-btn", (b) => { const r = b.getBoundingClientRect(); return { disabled: b.disabled, cls: b.className, r: { top: r.top, bottom: r.bottom, right: r.right, w: r.width, h: r.height } }; });
    assert.equal(fab.disabled, true, "未ログインでは押せない");
    assert.ok(/new-recipe-fab/.test(fab.cls));
    assert.ok(fab.r.w >= 44 && fab.r.h >= 44, "押しやすい大きさ");
    const bar = await page.$eval(".view-tabs", (b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    assert.ok(fab.r.bottom <= bar.top, "＋ボタンはタブバーと重ならない: " + JSON.stringify({ fab: fab.r, bar }));
    assert.ok(fab.r.right <= 390 - 8, "画面の右端に収まる");
    assert.equal(await page.isVisible("#new-recipe-hint"), true, "未ログインの理由を出す");
    const strip = await page.$eval(".view-tabs", (b) => getComputedStyle(b, "::before").backgroundColor);
    assert.ok(strip && strip !== "rgba(0, 0, 0, 0)" && strip !== "transparent", "タブバーの後ろは透けない(一覧が重なって見えない): " + strip);
    // 横幅が狭くても、タイトル行が崩れない
    await page.setViewportSize({ width: 320, height: 640 });
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflowX <= 0, "320px幅でも横にはみ出さない: " + overflowX);
    await page.setViewportSize({ width: 390, height: 844 });
    ok("右下の＋はタブバーに重ならず、未ログインでは押せない。タブバーの後ろは透けない。狭い画面でもはみ出さない");

    // ---- 保存済み0件 ----
    await page.evaluate(() => { savedCache = []; renderSavedView(); });
    assert.equal(await page.isVisible("#saved-empty"), true);
    assert.equal(await page.isHidden("#saved-filter"), true);
    assert.equal(await page.isHidden("#saved-search-toggle"), true);
    assert.equal(await page.isVisible("#new-recipe-btn"), true, "0件でも自作の入口は出る");
    ok("保存が0件のときは、絞り込み・検索を隠して案内を出す(＋は残る)");

    assert.deepEqual(errors, [], "ページのJavaScriptエラーが0件: " + errors.join(" / "));
    assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信が0件");
    assert.deepEqual(seen.aiLike, [], "AI系の通信が0件");
    assert.deepEqual(seen.writes, [], "サーバーへの書き込みが0件");
    ok("(未ログイン) 外部通信・AI系通信・サーバー書き込みはすべて0件");
    await ctx.close();
  }

  // ============ ログイン中(偽のサーバー応答) ============
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const seen = { external: [], aiLike: [], writes: [] };
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1") { seen.external.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (route.request().method() !== "GET") seen.writes.push(url.pathname);
      if (/\/(ai|extract)/.test(url.pathname)) seen.aiLike.push(url.pathname);
      const json = (status, b) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
      if (url.pathname === "/api/auth/me") return json(200, { user: { id: "u1", isAdmin: false } });
      if (url.pathname === "/api/recipes" && route.request().method() === "GET") return json(200, { recipes: R });
      return json(200, {});
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/");
    await page.waitForTimeout(600);
    await page.click("#tab-saved");
    await page.waitForTimeout(300);

    assert.equal(await page.$eval("#new-recipe-btn", (b) => b.disabled), false, "ログイン中は＋が押せる");
    assert.equal(await page.isHidden("#new-recipe-hint"), true);
    await page.click("#new-recipe-btn");
    assert.equal(await page.isVisible("#recipe-edit-sheet"), true, "自作の編集シートが開く");
    await page.evaluate(() => closeRecipeEditor());

    await page.click('.saved-tile[data-id="r2"]');
    assert.equal(await page.$eval("#saved-detail .edit-saved-btn", (b) => b.disabled), false, "ログイン中は編集できる");
    await page.click("#saved-detail .edit-saved-btn");
    assert.equal(await page.isVisible("#recipe-edit-sheet"), true, "編集シートが開く");
    const nameValue = await page.$eval('#recipe-edit-sheet [data-k="name"]', (i) => i.value);
    assert.equal(nameValue, "サバ缶と大根のみそ煮");
    await page.evaluate(() => closeRecipeEditor());
    // 編集シートを閉じても、詳細シートは開いたまま
    assert.equal(await page.isVisible("#saved-detail"), true);
    // 編集の保存を模して一覧を差し替えると、開いている詳細シートも最新になる
    await page.evaluate(() => replaceSaved(Object.assign({}, getSaved().find(r => r.id === 'r2'), { name: '名前を変えたサバ煮' })));
    assert.equal(await page.textContent("#saved-detail-title"), "名前を変えたサバ煮");
    assert.ok((await page.$$eval("#saved-list .saved-tile-title", (e) => e.map((x) => x.textContent))).includes("名前を変えたサバ煮"));
    ok("(ログイン中) ＋で自作、詳細シートの「編集」で編集シートが開く。保存後は詳細・一覧が最新になる");

    assert.deepEqual(errors, [], "ページのJavaScriptエラーが0件: " + errors.join(" / "));
    assert.deepEqual(unexpectedExternal(seen), [], "想定外の外部通信が0件");
    assert.deepEqual(seen.aiLike, [], "AI系の通信が0件");
    const nonCalc = seen.writes.filter((p) => p !== "/api/recipes/calc");
    assert.deepEqual(nonCalc, [], "サーバーへの書き込みは0件(栄養の再計算の問い合わせだけは偽の応答)");
    ok("(ログイン中) 外部通信・AI系通信・サーバー書き込みはすべて0件");
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log("\n" + passed + " 件 PASS(外部通信・AIへの通信: 0件)");
