// レシピの取り込み(URL・テキスト)のテスト。
// 【重要】AI(xAI・有料)も本物の外部サイトも呼びません。ページの取得は、このテストが用意した偽のサーバー応答に差し替えます。
//   見張り役(test/_support.mjs)は、偽サイト以外への通信と、AIへの通信を1件でも見つけたら失敗にします。
import assert from "node:assert/strict";
import { createEnv, loginAs, callJson, installFetchGuard, makeRunner } from "./_support.mjs";

const SITE = "recipes.example.jp";
let pages = {};
const guard = installFetchGuard({
  [SITE]: (u) => {
    const p = pages[u.pathname];
    if (!p) return new Response("not found", { status: 404 });
    return new Response(p.body, { status: p.status || 200, headers: p.headers || { "content-type": "text/html; charset=utf-8" } });
  },
  "other.example.jp": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
});
const t = makeRunner("レシピの取り込み");

const lib = await import("../functions/_lib/recipe-import.js");
const { parseIngredientLine: P, parseRecipeText, extractRecipeFromHtml, validateImportUrl, fetchPageHtml, ImportError } = lib;
const importUrl = await import("../functions/api/recipes/import-url.js");
const importText = await import("../functions/api/recipes/import-text.js");

// ---- 材料の1行 ----
{
  const eq = (line, name, grams) => { const r = P(line); assert.ok(r, line); assert.equal(r.name, name, line); assert.equal(r.grams, grams, line); };
  eq("鶏もも肉 200g", "鶏もも肉", 200);
  eq("鶏もも肉 1枚(約250g)", "鶏もも肉", 250);
  eq("牛乳:200ml", "牛乳", 200);
  eq("水 400cc", "水", 400);
  eq("小麦粉 1.5kg", "小麦粉", 1500);
  eq("豚バラ肉(薄切り) 150〜200g", "豚バラ肉(薄切り)", 175);
  eq("ブロッコリー 1/2株 (100g)", "ブロッコリー", 100);
  eq("・玉ねぎ　２００ｇ", "玉ねぎ", 200); t.ok("グラム・ml・cc・kg・範囲・全角・括弧内の量を読み取れる");
  eq("塩 少々", "塩", 0);
  eq("こしょう 適量", "こしょう", 0); t.ok("「少々・適量」は0gとして読む(栄養に入れない)");
  eq("玉ねぎ 1/2個", "玉ねぎ", null);
  eq("オリーブオイル 大さじ1", "オリーブオイル", null);
  eq("砂糖 小さじ1/2", "砂糖", null);
  eq("米 2合", "米", null);
  eq("卵 2個", "卵", null); t.ok("大さじ・個・合などグラムに直せない量は、推測せず空欄(null)のまま返す");
  assert.equal(P("【A】"), null);
  assert.equal(P("＜調味料＞"), null);
  assert.equal(P(""), null);
  assert.equal(P("   "), null); t.ok("見出し・空行は材料にしない");
  assert.equal(P("A 醤油 大さじ2").name, "醤油"); t.ok("先頭の A/B の印を取り除く");
  assert.ok(P("あ".repeat(100) + " 10g").name.length <= 40); t.ok("長すぎる名前は40文字に収める");
}

// ---- テキスト ----
{
  const text = `【簡単】鶏の照り焼き
#鶏肉 #簡単レシピ
https://example.com/xxxx
【材料】(2人分)
・鶏もも肉 1枚(250g)
・醤油 大さじ2
・サラダ油 少々
【作り方】
①鶏肉を焼く。
②調味料を加えて煮詰める。
ポイント
焦がさない`;
  const { draft, warnings } = parseRecipeText(text);
  assert.equal(draft.name, "鶏の照り焼き");
  assert.deepEqual(draft.ingredients.map((i) => [i.name, i.grams]), [["鶏もも肉", 250], ["醤油", null], ["サラダ油", 0]]);
  assert.deepEqual(draft.steps, ["鶏肉を焼く。", "調味料を加えて煮詰める。"]);
  assert.deepEqual(warnings, []); t.ok("【材料】【作り方】の投稿文を読める(タイトル・ハッシュタグ・URL・ポイント欄の扱い)");
  const en = parseRecipeText("Pasta\nIngredients\nspaghetti 100g\nDirections\n1. boil\n2. mix");
  assert.deepEqual(en.draft.steps, ["boil", "mix"]); t.ok("英語の見出し・番号つきの手順も読める");
  assert.throws(() => parseRecipeText("今日の晩ごはん おいしかった"), (e) => e instanceof ImportError && e.status === 422); t.ok("見出しがない文章は、読み取れないと案内する");
  const many = parseRecipeText("料理\n材料\n" + Array.from({ length: 40 }, (_, i) => `具${i} ${i + 1}g`).join("\n") + "\n作り方\n" + "a。".repeat(10));
  assert.equal(many.draft.ingredients.length, 30); assert.ok(many.warnings.length === 1); t.ok("材料が31行以上なら30行に収めて知らせる");
  const longStep = parseRecipeText("料理\n材料\n水 100g\n作り方\n" + "あいうえお。".repeat(100));
  assert.ok(longStep.draft.steps.every((s) => s.length <= 300)); assert.ok(longStep.draft.steps.length >= 2); t.ok("長すぎる手順は300文字以内に分ける");
}

// ---- JSON-LD ----
{
  const ld = (o) => `<html><head><script type="application/ld+json">${JSON.stringify(o)}</script></head></html>`;
  const graph = ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": ["Recipe", "Thing"], name: "カレー &amp; ご飯", recipeIngredient: ["玉ねぎ 1個", "豚肉 200g"], recipeInstructions: [{ "@type": "HowToStep", text: "炒める" }, { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "煮る" }] }] }] });
  let r = extractRecipeFromHtml(graph, "https://recipes.example.jp/a");
  assert.equal(r.draft.name, "カレー & ご飯");
  assert.deepEqual(r.draft.steps, ["炒める", "煮る"]);
  assert.equal(r.draft.sourceUrl, "https://recipes.example.jp/a");
  assert.equal(r.draft.ingredients[1].grams, 200); t.ok("@graph・HowToStep・HowToSection・文字参照の入ったJSON-LDを読める");
  r = extractRecipeFromHtml(ld([{ "@type": "Recipe", name: "x", recipeIngredient: ["水 100ml"], recipeInstructions: "混ぜる<br>冷やす" }]));
  assert.deepEqual(r.draft.steps, ["混ぜる", "冷やす"]); t.ok("文字列の手順(<br>区切り)・配列直下のJSON-LDも読める");
  const two = `<script type="application/ld+json">{bad json</script>` + ld({ "@type": "Recipe", name: "y", recipeIngredient: ["水 1g"], recipeInstructions: ["a"] });
  assert.equal(extractRecipeFromHtml(two).draft.name, "y"); t.ok("壊れたJSON-LDのブロックは飛ばして、読めるものを使う");
  assert.throws(() => extractRecipeFromHtml("<html><body>no recipe</body></html>"), (e) => e.status === 422 && e.code === "no_recipe"); t.ok("レシピの情報がないページは、テキスト取り込みを案内する(422)");
  assert.throws(() => extractRecipeFromHtml(ld({ "@type": "Recipe", name: "空" })), (e) => e.status === 422);
}

// ---- URLの検査(サーバーが内部へ接続させられない) ----
{
  const bad = ["http://localhost/a", "https://127.0.0.1/", "https://10.0.0.1/", "https://192.168.0.1/", "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://2130706433/", "https://0x7f000001/",
    "https://example.com:8080/", "https://u:p@example.com/", "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "https://metadata.google.internal/", "https://intranet/", "https://printer.local/", "", "   ", "not a url"];
  bad.forEach((u) => assert.equal(validateImportUrl(u).ok, false, u));
  t.ok("localhost・IPアドレス・内部の名前・ポート指定・認証つき・http(s)以外のURLは断る");
  assert.equal(validateImportUrl("https://recipes.example.jp/r/1").ok, true);
  assert.equal(validateImportUrl("http://recipes.example.jp/r/1").ok, true); t.ok("普通のURLは通す");
}

// ---- ページの取得(偽サーバー) ----
{
  const recipeHtml = `<html><script type="application/ld+json">{"@type":"Recipe","name":"取得テスト","recipeIngredient":["水 100g"],"recipeInstructions":["混ぜる"]}</script></html>`;
  pages = {
    "/ok": { body: recipeHtml },
    "/redir": { status: 302, headers: { location: "/ok" }, body: "" },
    "/redir-internal": { status: 302, headers: { location: "http://127.0.0.1/admin" }, body: "" },
    "/redir-loop": { status: 302, headers: { location: "/redir-loop" }, body: "" },
    "/json": { body: "{}", headers: { "content-type": "application/json" } },
    "/err": { status: 500, body: "boom" },
    "/big": { body: recipeHtml + "x".repeat(3000000) },
    "/sjis": { body: recipeHtml, headers: { "content-type": "text/html; charset=shift_jis" } },
  };
  const before = guard.calls.length;
  let r = await fetchPageHtml("https://recipes.example.jp/ok");
  assert.match(r.html, /取得テスト/); t.ok("ページを取得できる");
  r = await fetchPageHtml("https://recipes.example.jp/redir");
  assert.equal(r.finalUrl, "https://recipes.example.jp/ok"); t.ok("リダイレクトを追える");
  await assert.rejects(fetchPageHtml("https://recipes.example.jp/redir-internal"), (e) => e.status === 400);
  assert.ok(!guard.calls.slice(before).some((c) => c.includes("127.0.0.1"))); t.ok("内部アドレスへのリダイレクトは、接続する前に断る");
  await assert.rejects(fetchPageHtml("https://recipes.example.jp/redir-loop"), (e) => e.status === 502); t.ok("リダイレクトの繰り返しは3回で打ち切る");
  await assert.rejects(fetchPageHtml("https://recipes.example.jp/json"), (e) => e.code === "not_html"); t.ok("HTMLでないものは断る");
  await assert.rejects(fetchPageHtml("https://recipes.example.jp/err"), (e) => e.status === 502); t.ok("取得に失敗したページは502");
  r = await fetchPageHtml("https://recipes.example.jp/big");
  assert.ok(r.html.length <= 1500000); t.ok("巨大なページは1.5MBで読むのをやめる");
  await assert.rejects(fetchPageHtml("https://recipes.example.jp/missing"), (e) => e.status === 502);
  // 偽のfetchが例外を投げる場合
  await assert.rejects(fetchPageHtml("https://recipes.example.jp/ok", { fetchImpl: async () => { throw new Error("net"); } }), (e) => e.status === 502); t.ok("通信エラーは502(中身の詳細は返さない)");
  r = await fetchPageHtml("https://recipes.example.jp/sjis"); assert.ok(r.html.length > 0); t.ok("文字コードの指定があっても読める");
}

// ---- エンドポイント ----
{
  const { env, sqlite } = createEnv();
  const alice = await loginAs(env, sqlite, "alice");
  let r = await callJson(importUrl.onRequestPost, env, { method: "POST", body: { url: "https://recipes.example.jp/ok" } });
  assert.equal(r.status, 401); t.ok("未ログインでは、URLの取り込みを使えない(サーバーが外のページを取りに行くため)");
  r = await callJson(importUrl.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { url: "https://recipes.example.jp/ok" }, headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  r = await callJson(importUrl.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { url: "http://127.0.0.1/" } });
  assert.equal(r.status, 400); assert.ok(!guard.calls.some((c) => c.includes("127.0.0.1"))); t.ok("内部アドレスは接続せずに400");
  r = await callJson(importUrl.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { url: "https://recipes.example.jp/ok" }, headers: { Origin: "https://recipe.test" } });
  assert.equal(r.status, 200); assert.equal(r.data.draft.name, "取得テスト"); assert.equal(r.data.draft.ingredients[0].grams, 100); t.ok("ログイン中はURLから下書きを取得できる");
  r = await callJson(importUrl.onRequestPost, env, { method: "POST", cookie: alice.cookie, rawBody: "{oops" });
  assert.equal(r.status, 400);
  r = await callJson(importUrl.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { url: "https://recipes.example.jp/none" } });
  assert.equal(r.status, 502);

  r = await callJson(importText.onRequestPost, env, { method: "POST", body: { text: "x" } });
  assert.equal(r.status, 401);
  r = await callJson(importText.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { text: "  " } });
  assert.equal(r.status, 400);
  r = await callJson(importText.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { text: "ねぎ塩\n材料\nねぎ 50g\n作り方\n切る" } });
  assert.equal(r.status, 200); assert.equal(r.data.draft.steps[0], "切る"); t.ok("テキストの取り込みAPI(ログイン必須・空は400・成功は下書き)");
  assert.ok(!("nutrition" in r.data) && !("nutrition" in r.data.draft)); t.ok("取り込みは栄養を計算しない(成分表・AIの設定を使わない)");
  r = await callJson(importText.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { text: "ただの文章" } });
  assert.equal(r.status, 422);
}

// ---- 見張り役: AIへの通信が起きないこと ----
assert.ok(guard.calls.every((c) => new URL(c).hostname === SITE || c.includes("example.jp")), "偽サイト以外の通信がある: " + guard.calls.join(","));
assert.ok(!guard.calls.some((c) => /x\.ai|chat\/completions/.test(c)));
t.ok("このテスト中のAI(x.ai)への通信は0件");
guard.restore();
t.done();
