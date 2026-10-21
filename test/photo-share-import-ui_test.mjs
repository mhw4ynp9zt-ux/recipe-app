// 料理の写真・共有リンク・レシピの取り込みの画面テスト(Playwright。iPhone幅)。
// 【重要】実際のAI(xAI・有料)も、外部サイトも呼びません。
//   ・ページは、このテストが立てる 127.0.0.1 のローカルサーバーから配る
//   ・ブラウザの全通信を route で横取りし、/api/* はこのテストの偽サーバーが答える。127.0.0.1 以外は遮断して数える
//   ・AI系(/api/ai/ ・ /api/admin/ai ・ x.ai)への通信と外部通信は、0件であることを assert する
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

const nut = (calories, protein, veg, fat, salt, fiber, carbs) => ({ calories, protein, veg, fat, salt, fiber, carbs });
const RECIPE = (id, name) => ({
  id, category: "created", type: "主菜", name, genre: "和食", role: "主菜", main: "肉",
  ingredients: ["鶏もも肉 250g"], ingredientDetails: [{ name: "鶏もも肉", grams: 250, amount: "250g", match: { label: "鶏もも肉" } }],
  steps: ["焼く", "煮る"], nutrition: nut(500, 40, 0, 20, 2, 0, 10), nutritionCheck: { unmatched: [], missing: [] },
});
const TOKEN = "a".repeat(32);
const HOSTILE = "d".repeat(32); // 悪意のあるデータ(サーバーの無害化をすり抜けた場合を想定した、画面側の二重の防御の確認用)
const SHARED = { ...RECIPE("ignored", "友だちの鶏の照り焼き"), sourceUrl: "https://recipes.example.jp/r/1" };
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---- 偽のサーバー(このテストの中だけ。AIは存在しない) ----
function makeFakeApi({ user, recipes }) {
  const st = { user, recipes: recipes.map((r) => ({ ...r })), calls: [], aiLike: [], external: [], photos: {}, tokens: {} };
  const json = (route, status, b, headers) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b), headers });
  const handler = async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.hostname !== "127.0.0.1") { st.external.push(url.href); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (/^\/api\/(ai|admin\/ai)|\/extract/.test(url.pathname)) { st.aiLike.push(url.pathname); return json(route, 500, { error: "AIは呼べません" }); }
    const body = (() => { try { return JSON.parse(route.request().postData() || "null"); } catch (e) { return null; } })();
    if (method !== "GET") st.calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (p === "/api/auth/me") return json(route, 200, { user: st.user });
    if (p === "/api/recipes" && method === "GET") return json(route, 200, { recipes: st.recipes });
    if (p === "/api/recipes" && method === "POST") return json(route, 200, { ok: true });
    let m;
    if ((m = /^\/api\/recipes\/([^/]+)\/photo$/.exec(p))) {
      if (method === "PUT") { const v = Date.now(); st.photos[m[1]] = body.image; return json(route, 200, { ok: true, photoUrl: `/api/recipes/${m[1]}/photo?v=${v}` }); }
      if (method === "DELETE") { delete st.photos[m[1]]; return json(route, 200, { ok: true }); }
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PNG_B64, "base64") });
    }
    if ((m = /^\/api\/recipes\/([^/]+)\/share$/.exec(p))) {
      if (method === "POST") { st.tokens[m[1]] = st.tokens[m[1]] || "b".repeat(32); return json(route, 200, { token: st.tokens[m[1]], url: `https://recipe-app.test/?share=${st.tokens[m[1]]}` }); }
      if (method === "DELETE") { delete st.tokens[m[1]]; return json(route, 200, { ok: true }); }
    }
    if (p === `/api/shared/${HOSTILE}`) return json(route, 200, { recipe: { name: "<img src=x onerror=window.__pwned=1>悪い名前", type: "<b>x</b>", ingredients: ["<img src=x onerror=window.__pwned=2>"], steps: ["<img src=x onerror=window.__pwned=3>"], ingredientDetails: [{ name: "<img src=x onerror=window.__pwned=4>", grams: "5<img src=x onerror=window.__pwned=5>", match: { label: "<img src=x onerror=window.__pwned=6>" } }], nutrition: { protein: "<img src=x onerror=window.__pwned=7>", calories: 5 }, nutritionCheck: { unmatched: ["<img src=x onerror=window.__pwned=8>"], missing: [] }, sourceUrl: "javascript:window.__pwned=9" }, photoUrl: null });
    if (p === `/api/shared/${TOKEN}`) return json(route, 200, { recipe: SHARED, photoUrl: `/api/shared/${TOKEN}/photo?v=1` });
    if (p === `/api/shared/${TOKEN}/photo`) return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PNG_B64, "base64") });
    if (p.startsWith("/api/shared/")) return json(route, 404, { error: "共有リンクが見つかりません(共有が止められた可能性があります)" });
    if (p === "/api/recipes/import") { const r = { ...RECIPE("r-imported", "友だちの鶏の照り焼き"), photoUrl: "/api/recipes/r-imported/photo?v=1" }; st.recipes.push(r); return json(route, 200, { recipe: r }); }
    if (p === "/api/recipes/import-url") {
      if (/bad/.test(body.url)) return json(route, 422, { error: "このページからレシピの情報を読み取れませんでした。レシピ本文をコピーして「テキスト」から取り込めます" });
      return json(route, 200, { draft: { name: "取り込みカレー", type: "", sourceUrl: body.url, ingredients: [{ name: "玉ねぎ", grams: null, line: "玉ねぎ 1個" }, { name: "豚肉", grams: 200, line: "豚肉 200g" }], steps: ["炒める", "煮る"] }, warnings: [] });
    }
    if (p === "/api/recipes/import-text") return json(route, 200, { draft: { name: "貼り付けサラダ", type: "", ingredients: [{ name: "レタス", grams: 50, line: "レタス 50g" }], steps: ["ちぎる"] }, warnings: ["材料が多いため、先頭の30行だけを取り込みました"] });
    if (p === "/api/recipes/calc") {
      const ings = body.ingredients;
      return json(route, 200, { ingredientDetails: ings.map((i) => ({ ...i, match: { label: i.name + "(成分表)" } })), nutrition: nut(300, 20, 50, 10, 1.5, 3, 30), nutritionCheck: { unmatched: [], missing: [] } });
    }
    if (p === "/api/recipes/custom") {
      const r = { ...RECIPE("r-custom", body.name), type: body.type || "その他", steps: body.steps, ingredients: body.ingredients.map((i) => `${i.name} ${i.grams}g`), sourceUrl: body.sourceUrl };
      st.recipes.push(r);
      return json(route, 200, { recipe: r });
    }
    return json(route, 200, {});
  };
  return { st, handler };
}

const FAKE_USER = { id: "u1", isAdmin: false };
// ページの見た目・パスキー用の静的な読み込み(Googleフォント・WebAuthnのライブラリ)だけは、遮断して数えるだけにする。それ以外の外部通信(AIのx.aiを含む)は0件でなければならない
const STATIC_EXTERNAL = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com"]);
const unexpectedExternal = (api) => api.st.external.filter((u) => !STATIC_EXTERNAL.has(new URL(u).hostname));
const browser = await chromium.launch();
async function newPage({ user, recipes, local }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const api = makeFakeApi({ user, recipes });
  await page.addInitScript(({ local }) => {
    if (local && !sessionStorage.getItem("seeded")) { localStorage.setItem("recipeRouletteSavedV1", JSON.stringify(local)); sessionStorage.setItem("seeded", "1"); }
    window.__copied = []; window.__shared = null;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
    Object.defineProperty(navigator, "share", { value: async (d) => { window.__shared = d; }, configurable: true });
  }, { local });
  await page.route("**/*", api.handler);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  return { ctx, page, api, errors };
}
const shot = async (page, name) => { if (SHOT_DIR) { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); } };
// 縮小・容量確認用: ランダムなノイズの大きな写真(JPEG)を、ブラウザの中で作る
async function bigNoisePhoto(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 2400; c.height = 1800;
    const ctx = c.getContext("2d"); const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = Math.random() * 255; img.data[i + 1] = Math.random() * 255; img.data[i + 2] = Math.random() * 255; img.data[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.95).split(",")[1];
  });
  return { name: "dish.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}
const imgInfo = (page, src) => page.evaluate((s) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve(null); i.src = s; }), src);
const failIfErrors = (errors, where) => assert.deepEqual(errors, [], where + ": ページのエラー " + errors.join(" / "));

try {
  // ================= 未ログイン =================
  {
    const { page, api, errors } = await newPage({ user: null, recipes: [], local: [RECIPE("r1", "鶏の照り焼き")] });
    await page.goto(base + "/"); await page.waitForTimeout(500);
    await page.click("#tab-saved"); await page.waitForTimeout(200);
    assert.equal(await page.isVisible("#import-recipe-btn"), true); ok("(未ログイン) 保存済み画面に「取り込む」ボタンが出る");
    await shot(page, "01-saved-head");

    await page.click('.saved-tile[data-id="r1"]');
    assert.equal(await page.isDisabled(".share-saved-btn"), true);
    assert.match(await page.textContent("#saved-detail-panel"), /ログインすると、レシピを共有リンクで送れます/); ok("(未ログイン) 共有は押せず、理由が出る");
    assert.equal(await page.$(".recipe-photo"), null);
    assert.equal(await page.textContent(".photo-pick-btn"), "写真を追加"); ok("(未ログイン) 写真が無いときは「写真を追加」");

    const photo = await bigNoisePhoto(page);
    assert.ok(photo.buffer.length > 600 * 1024, "元の写真は大きい(" + photo.buffer.length + "バイト)");
    await page.setInputFiles("#saved-detail-panel [data-photo-input]", photo);
    await page.waitForSelector("#saved-detail-panel .recipe-photo", { timeout: 15000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("recipeRouletteSavedV1"))[0].photoData);
    assert.match(stored, /^data:image\/jpeg;base64,/);
    const bytes = Math.floor((stored.length - stored.indexOf(",") - 1) * 3 / 4);
    assert.ok(bytes <= 380 * 1024, "縮小後は380KB以内: " + bytes);
    const dim = await imgInfo(page, stored);
    assert.ok(dim && Math.max(dim.w, dim.h) <= 960, "長辺960px以内: " + JSON.stringify(dim));
    assert.equal(await page.textContent(".photo-pick-btn"), "写真を変更");
    assert.match(await page.textContent("[data-photo-msg]"), /保存しました/);
    ok(`(未ログイン) 大きな写真(${Math.round(photo.buffer.length / 1024)}KB)が、端末で縮小されて(${dim.w}×${dim.h}・${Math.round(bytes / 1024)}KB)この端末に保存される`);
    await shot(page, "02-detail-photo");
    await page.click("#saved-detail-panel .saved-sheet-close");
    assert.equal(await page.$eval('.saved-tile[data-id="r1"] .saved-tile-photo img', (i) => i.src.startsWith("data:image/jpeg")), true); ok("(未ログイン) 一覧のタイルに写真が出る");
    await shot(page, "03-tile-photo");

    await page.reload(); await page.waitForTimeout(500); await page.click("#tab-saved");
    assert.ok(await page.$('.saved-tile[data-id="r1"] .saved-tile-photo img')); ok("(未ログイン) 再読み込みしても写真が残る");

    await page.click('.saved-tile[data-id="r1"]');
    await page.click("[data-photo-remove]");
    await page.waitForFunction(() => !document.querySelector("#saved-detail-panel .recipe-photo"));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("recipeRouletteSavedV1"))[0].photoData), undefined);
    assert.equal(await page.$('.saved-tile[data-id="r1"] .saved-tile-photo'), null); ok("(未ログイン) 写真を削除できる");
    await page.click("#saved-detail-panel .saved-sheet-close");

    // 共有リンクを開く(ログインなし)
    await page.goto(base + "/?share=" + TOKEN); await page.waitForTimeout(600);
    assert.equal(await page.isVisible("#shared-sheet"), true);
    const sharedText = await page.textContent("#shared-panel");
    ["友だちの鶏の照り焼き", "鶏もも肉", "焼く", "recipes.example.jp", "ログインしていないので、この端末に保存されます"].forEach((t) => assert.ok(sharedText.includes(t), "共有シートに「" + t + "」: " + sharedText.slice(0, 200)));
    assert.ok(await page.$("#shared-panel .recipe-photo")); assert.equal(await page.$("#shared-panel [data-photo-input]"), null, "共有の表示に編集操作は出ない");
    ok("(未ログイン) 共有リンクを開くと、ログインなしでレシピ・写真・取り込み元が見える");
    await shot(page, "04-shared-sheet");
    await page.click("[data-shared-save]");
    await page.waitForFunction(() => document.getElementById("shared-sheet").hidden);
    const titles = await page.$$eval("#saved-list .saved-tile-title", (e) => e.map((x) => x.textContent.trim()));
    assert.ok(titles.includes("友だちの鶏の照り焼き"));
    const local = await page.evaluate(() => JSON.parse(localStorage.getItem("recipeRouletteSavedV1")));
    const got = local.find((r) => r.name === "友だちの鶏の照り焼き");
    assert.match(got.id, /^r-/); assert.match(got.photoData, /^data:image\//); assert.equal(got.sourceUrl, "https://recipes.example.jp/r/1");
    assert.equal(new URL(page.url()).search, "", "取り込んだら、URLの ?share= は消える");
    assert.equal(api.st.calls.length, 0, "未ログインの取り込みで、サーバーへの書き込みは無い");
    ok("(未ログイン) 共有されたレシピを、この端末の保存済みに入れられる(写真つき・サーバーへの書き込み0件)");

    // 悪意のあるデータが来ても、画面で実行されない(画面側の無害化)
    await page.goto(base + "/?share=" + HOSTILE); await page.waitForTimeout(600);
    await page.click("#shared-panel .nutrition-detail summary");
    assert.equal(await page.evaluate(() => window.__pwned), undefined, "スクリプトが実行された");
    assert.equal(await page.$("#shared-panel img[src='x']"), null, "投稿内容がタグとして解釈された");
    assert.equal(await page.$("#shared-panel .recipe-source"), null, "javascript: のリンクは出さない");
    assert.match(await page.textContent("#shared-panel h2"), /<img src=x/); ok("(未ログイン) 悪意のあるHTMLを含む共有データは、文字としてだけ表示され、実行されない");
    await page.click("#shared-sheet [data-sheet-close].saved-sheet-close");

    // 存在しない共有リンク
    await page.goto(base + "/?share=" + "c".repeat(32)); await page.waitForTimeout(500);
    assert.match(await page.textContent("#shared-panel"), /共有リンクが見つかりません/);
    assert.equal(await page.$("[data-shared-save]"), null); ok("(未ログイン) 止められた・存在しない共有リンクは、案内を出して保存ボタンは出ない");
    await page.click("#shared-sheet [data-sheet-close].saved-sheet-close");

    // 取り込みシート
    await page.goto(base + "/"); await page.waitForTimeout(400); await page.click("#tab-saved");
    await page.click("#import-recipe-btn");
    assert.equal(await page.isVisible("#import-sheet"), true);
    assert.match(await page.textContent("#import-panel"), /ログインなしでも取り込めます/);
    await shot(page, "05-import-sheet");
    await page.fill("#import-url", "https://recipes.example.jp/r/2"); await page.click("[data-import-run]");
    assert.match(await page.textContent("[data-import-msg]"), /ログインすると使えます/);
    await page.click('[data-import-tab="text"]'); await page.fill("#import-text", "【材料】\n水 100g"); await page.click("[data-import-run]");
    assert.match(await page.textContent("[data-import-msg]"), /ログインすると使えます/);
    await page.click('[data-import-tab="url"]'); await page.fill("#import-url", `${base}/?share=${TOKEN}`); await page.click("[data-import-run]");
    await page.waitForSelector("#shared-sheet:not([hidden])");
    assert.equal(await page.isHidden("#import-sheet"), true);
    assert.match(await page.textContent("#shared-panel"), /友だちの鶏の照り焼き/); ok("(未ログイン) 取り込みシート: 共有リンクは取り込める。URL・テキストはログインが必要と案内する");
    assert.equal(api.st.calls.length, 0);
    assert.deepEqual(unexpectedExternal(api), [], "想定外の外部通信"); assert.equal(api.st.aiLike.length, 0, "AI系通信");
    failIfErrors(errors, "未ログイン"); ok("(未ログイン) 外部通信・AI系通信・サーバー書き込みはすべて0件");
  }

  // ================= ログイン中 =================
  {
    const { page, api, errors } = await newPage({ user: FAKE_USER, recipes: [RECIPE("r1", "鶏の照り焼き")], local: null });
    await page.goto(base + "/"); await page.waitForTimeout(600);
    await page.click("#tab-saved"); await page.waitForTimeout(300);
    await page.click('.saved-tile[data-id="r1"]');
    assert.equal(await page.isDisabled(".share-saved-btn"), false);

    // 写真
    await page.setInputFiles("#saved-detail-panel [data-photo-input]", await bigNoisePhoto(page));
    await page.waitForSelector("#saved-detail-panel .recipe-photo", { timeout: 15000 });
    const put = api.st.calls.find((c) => c.method === "PUT" && c.path === "/api/recipes/r1/photo");
    assert.ok(put, "写真をサーバーへ送る");
    assert.match(put.body.image, /^data:image\/jpeg;base64,/);
    assert.ok(Math.floor((put.body.image.length - put.body.image.indexOf(",") - 1) * 3 / 4) <= 380 * 1024, "送る画像は縮小済み");
    assert.match(await page.$eval("#saved-detail-panel .recipe-photo", (i) => i.getAttribute("src")), /^\/api\/recipes\/r1\/photo\?v=\d+$/);
    const localAfter = await page.evaluate(() => localStorage.getItem("recipeRouletteSavedV1"));
    assert.ok(!localAfter || !localAfter.includes("data:image"), "ログイン中は、写真を端末に残さない");
    ok("(ログイン中) 写真は縮小してサーバーへ送られ、サーバーの画像URLで表示される");

    // 共有
    await page.click(".share-saved-btn");
    await page.waitForSelector("#share-sheet:not([hidden]) .share-url");
    assert.equal(await page.inputValue("#share-url"), `https://recipe-app.test/?share=${"b".repeat(32)}`);
    assert.deepEqual(api.st.calls.filter((c) => c.path.endsWith("/share")).map((c) => c.method), ["POST"]);
    const xHref = await page.getAttribute('[data-share-act="x"]', "href");
    const lineHref = await page.getAttribute('[data-share-act="line"]', "href");
    assert.ok(xHref.startsWith("https://twitter.com/intent/tweet?") && xHref.includes(encodeURIComponent("https://recipe-app.test/?share=" + "b".repeat(32))));
    assert.ok(lineHref.startsWith("https://social-plugins.line.me/lineit/share?url="));
    assert.equal(await page.getAttribute('[data-share-act="x"]', "rel"), "noopener noreferrer");
    ok("(ログイン中) 共有リンクが作られ、X・LINEの共有リンクが付く");
    await shot(page, "06-share-sheet");
    await page.click('[data-share-act="copy"]');
    assert.deepEqual(await page.evaluate(() => window.__copied), [`https://recipe-app.test/?share=${"b".repeat(32)}`]);
    assert.match(await page.textContent("[data-share-msg]"), /コピーしました/);
    await page.click('[data-share-act="native"]');
    const sd = await page.evaluate(() => window.__shared);
    assert.equal(sd.url, `https://recipe-app.test/?share=${"b".repeat(32)}`); assert.match(sd.text, /鶏の照り焼き/);
    ok("(ログイン中) リンクのコピーと、端末の共有メニュー(navigator.share)が動く");
    await page.click("#share-sheet .saved-sheet-close");
    assert.equal(await page.textContent(".share-saved-btn"), "共有中"); ok("(ログイン中) 共有したレシピのボタンは「共有中」になる");
    await page.click(".share-saved-btn"); await page.waitForSelector("#share-sheet .share-stop");
    await page.click('[data-share-act="stop"]');
    await page.waitForFunction(() => document.getElementById("share-sheet").hidden);
    assert.ok(api.st.calls.some((c) => c.method === "DELETE" && c.path === "/api/recipes/r1/share"));
    assert.equal(await page.textContent(".share-saved-btn"), "共有"); ok("(ログイン中) 共有をやめられる");

    // 写真を削除
    await page.click("[data-photo-remove]");
    await page.waitForFunction(() => !document.querySelector("#saved-detail-panel .recipe-photo"));
    assert.ok(api.st.calls.some((c) => c.method === "DELETE" && c.path === "/api/recipes/r1/photo")); ok("(ログイン中) 写真を削除できる");
    await page.click("#saved-detail-panel .saved-sheet-close");

    // URLからの取り込み → 編集シート
    await page.click("#import-recipe-btn");
    assert.equal(await page.$("[data-import-login]"), null);
    await page.fill("#import-url", "https://recipes.example.jp/bad"); await page.click("[data-import-run]");
    await page.waitForFunction(() => /読み取れませんでした/.test(document.querySelector("[data-import-msg]").textContent));
    assert.equal(await page.isHidden("#recipe-edit-sheet"), true); ok("(ログイン中) 読み取れないページは、案内を出して編集シートは開かない");
    await page.fill("#import-url", "https://recipes.example.jp/r/curry"); await page.click("[data-import-run]");
    await page.waitForSelector("#recipe-edit-sheet:not([hidden]) .re-import-info");
    assert.equal(await page.isHidden("#import-sheet"), true);
    assert.equal(await page.inputValue("#re-name"), "取り込みカレー");
    assert.equal(await page.inputValue('[data-k="gn:0"]'), "玉ねぎ"); assert.equal(await page.inputValue('[data-k="gg:0"]'), "", "グラム数が読めない行は空欄");
    assert.equal(await page.inputValue('[data-k="gg:1"]'), "200");
    assert.match(await page.textContent(".re-head h2"), /レシピを取り込む/);
    const info = await page.textContent(".re-import-info");
    ["recipes.example.jp", "玉ねぎ 1個", "豚肉 200g", "グラム数が空欄"].forEach((t) => assert.ok(info.includes(t), "案内に「" + t + "」: " + info));
    assert.equal(await page.isDisabled('[data-act="save-new"]'), true, "グラム数が空欄の間は保存できない");
    assert.equal(api.st.calls.filter((c) => c.path === "/api/recipes/calc").length, 0, "空欄の間は栄養を計算しない");
    ok("(ログイン中) URLの取り込み: 下書きが編集シートに入り、元の材料の表記が出る。グラム数が空欄の間は保存できない");
    await shot(page, "07-editor-import");
    await page.fill('[data-k="gg:0"]', "150");
    await page.waitForFunction(() => !document.querySelector('[data-act="save-new"]').disabled, null, { timeout: 8000 });
    await page.click('[data-act="save-new"]');
    await page.waitForFunction(() => document.getElementById("recipe-edit-sheet").hidden);
    const saved = api.st.calls.find((c) => c.path === "/api/recipes/custom");
    assert.equal(saved.body.sourceUrl, "https://recipes.example.jp/r/curry");
    assert.deepEqual(saved.body.ingredients.map((i) => [i.name, i.grams]), [["玉ねぎ", 150], ["豚肉", 200]]);
    assert.ok(!JSON.stringify(saved.body).includes("玉ねぎ 1個"), "元の表記(line)は保存データに含めない");
    await page.click('.saved-tile[data-id="r-custom"]');
    assert.match(await page.textContent("#saved-detail-panel .recipe-source"), /recipes\.example\.jp/);
    assert.equal(await page.getAttribute("#saved-detail-panel .recipe-source a", "rel"), "noopener noreferrer nofollow");
    ok("(ログイン中) グラム数を入れると栄養が計算され、保存できる(取り込み元URLも保存・リンク表示)");
    await shot(page, "08-detail-source");
    await page.click("#saved-detail-panel .saved-sheet-close");

    // テキストの取り込み
    await page.click("#import-recipe-btn"); await page.click('[data-import-tab="text"]');
    await page.fill("#import-text", "【材料】\nレタス 50g\n【作り方】\nちぎる");
    await page.click("[data-import-run]");
    await page.waitForSelector("#recipe-edit-sheet:not([hidden]) .re-import-info");
    assert.equal(await page.inputValue("#re-name"), "貼り付けサラダ");
    assert.match(await page.textContent(".re-import-info"), /貼り付けた文章から取り込みました/);
    assert.match(await page.textContent(".re-import-info"), /先頭の30行/);
    ok("(ログイン中) テキストの取り込みで編集シートが開く(警告も出る)");
    await page.click('[data-act="close"]'); // 取り込み直後は変更あり扱いなので確認が出る(自動でOK)
    await page.waitForFunction(() => document.getElementById("recipe-edit-sheet").hidden);

    // 共有リンクをサーバーへ取り込む
    await page.click("#import-recipe-btn"); await page.fill("#import-url", TOKEN); await page.click("[data-import-run]");
    await page.waitForSelector("#shared-sheet:not([hidden]) [data-shared-save]");
    assert.equal(await page.$("#shared-panel .edit-login-hint"), null, "ログイン中は「この端末に保存」の注意は出ない");
    await page.click("[data-shared-save]");
    await page.waitForFunction(() => document.getElementById("shared-sheet").hidden);
    assert.ok(api.st.calls.some((c) => c.path === "/api/recipes/import" && c.body.token === TOKEN));
    assert.ok(await page.$('.saved-tile[data-id="r-imported"] .saved-tile-photo img'));
    ok("(ログイン中) 共有リンク(トークンだけの入力でも)をサーバーへ取り込める。写真つきで一覧に出る");

    assert.deepEqual(unexpectedExternal(api), [], "想定外の外部通信");
    assert.equal(api.st.aiLike.length, 0, "AI系通信: " + api.st.aiLike.join(","));
    failIfErrors(errors, "ログイン中");
    ok("(ログイン中) 外部通信・AI系通信は0件");
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passed} 件 PASS(外部通信・AIへの通信: 0件)`);
