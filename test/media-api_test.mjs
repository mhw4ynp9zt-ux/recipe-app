// 料理の写真・共有リンク・共有の取り込みのAPIテスト。
// 【重要】AI(xAI・有料)も外部サイトも呼びません(test/_support.mjs の見張り役が、外部通信を1件でも試みたら失敗にします)。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createEnv, loginAs, saveRecipe, callJson, call, installFetchGuard, makeRunner, root, PNG_URL, jpegUrl, webpUrl } from "./_support.mjs";

const guard = installFetchGuard(); // 許可する外部通信は無し
const t = makeRunner("写真・共有・取り込みのAPI");

const photo = await import("../functions/api/recipes/[id]/photo.js");
const share = await import("../functions/api/recipes/[id]/share.js");
const shared = await import("../functions/api/shared/[token].js");
const sharedPhoto = await import("../functions/api/shared/[token]/photo.js");
const importShare = await import("../functions/api/recipes/import.js");
const recipesApi = await import("../functions/api/recipes.js");
const recipeId = await import("../functions/api/recipes/[id].js");
const { parseImageDataUrl, PHOTO_MAX_BYTES } = await import("../functions/_lib/photo.js");
const { buildSnapshot } = await import("../functions/_lib/share.js");

const RECIPE = {
  id: "r-1", name: "鶏の照り焼き", type: "主菜", genre: "和食", role: "主菜", main: "鶏肉",
  ingredients: ["鶏もも肉 250g"], steps: ["焼く"],
  ingredientDetails: [{ name: "鶏もも肉", grams: 250, amount: "250g" }],
  nutrition: { protein: 40, calories: 500 }, protein: 40, calories: 500,
  // 共有してはいけない項目(混ざっていても出ない)
  userId: "u-secret", photoData: "data:image/png;base64,AAAA", shareToken: "old", photoUrl: "/old",
};

// ---- 画像の検査 ----
{
  assert.equal(parseImageDataUrl(PNG_URL).ok, true); t.ok("PNGを受け付ける");
  assert.equal(parseImageDataUrl(jpegUrl()).ok, true); t.ok("JPEGを受け付ける");
  assert.equal(parseImageDataUrl(webpUrl()).ok, true); t.ok("WebPを受け付ける");
  assert.equal(parseImageDataUrl("data:image/gif;base64,R0lGODlh").ok, false); t.ok("GIFは断る");
  assert.equal(parseImageDataUrl("data:image/svg+xml;base64,PHN2Zz4=").ok, false); t.ok("SVG(スクリプトを含みうる)は断る");
  assert.equal(parseImageDataUrl("data:image/jpeg;base64," + Buffer.from("<script>alert(1)</script>").toString("base64")).ok, false); t.ok("種類を偽ったデータ(中身がJPEGでない)は断る");
  assert.equal(parseImageDataUrl("data:image/png;base64,!!!").ok, false); t.ok("base64でない文字列は断る");
  assert.equal(parseImageDataUrl("data:image/jpeg;base64," + Buffer.alloc(PHOTO_MAX_BYTES + 10, 1).toString("base64")).ok, false); t.ok("上限(400KB)を超える画像は断る");
  assert.equal(parseImageDataUrl(123).ok, false); t.ok("文字列でない値は断る");
}

// ---- 写真 ----
{
  const { env, sqlite } = createEnv();
  const alice = await loginAs(env, sqlite, "alice");
  const bob = await loginAs(env, sqlite, "bob");
  saveRecipe(sqlite, alice.id, RECIPE);
  const P = { id: "r-1" };

  let r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, body: { image: PNG_URL } });
  assert.equal(r.status, 401); t.ok("未ログインでは写真を付けられない(401)");
  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, body: { image: PNG_URL }, headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403); t.ok("別サイトからの写真の追加は断る(403)");
  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, rawBody: "{oops" });
  assert.equal(r.status, 400); t.ok("壊れたJSONは400");
  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, body: { image: "data:image/gif;base64,AAAA" } });
  assert.equal(r.status, 400); t.ok("対応しない画像は400");
  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: bob.cookie, body: { image: PNG_URL } });
  assert.equal(r.status, 404); t.ok("他人のレシピには写真を付けられない(404)");
  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: { id: "nothing" }, cookie: alice.cookie, body: { image: PNG_URL } });
  assert.equal(r.status, 404); t.ok("存在しないレシピには付けられない(404)");

  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, body: { image: PNG_URL }, headers: { Origin: "https://recipe.test" } });
  assert.equal(r.status, 200); assert.match(r.data.photoUrl, /^\/api\/recipes\/r-1\/photo\?v=\d+$/); t.ok("写真を付けられる");

  let g = await call(photo.onRequestGet, env, { params: P, cookie: alice.cookie });
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("content-type"), "image/png");
  assert.equal(g.headers.get("x-content-type-options"), "nosniff");
  assert.match(g.headers.get("cache-control"), /private/);
  assert.equal(Buffer.from(await g.arrayBuffer()).toString("base64"), PNG_URL.split(",")[1]); t.ok("本人は写真を取得できる(元の画像と一致)");
  g = await call(photo.onRequestGet, env, { params: P, cookie: bob.cookie });
  assert.equal(g.status, 404); t.ok("他人は写真を取得できない");
  g = await call(photo.onRequestGet, env, { params: P });
  assert.equal(g.status, 401); t.ok("未ログインでは写真を取得できない");

  r = await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, body: { image: jpegUrl() } });
  g = await call(photo.onRequestGet, env, { params: P, cookie: alice.cookie });
  assert.equal(g.headers.get("content-type"), "image/jpeg");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipe_photos").get().n, 1); t.ok("差し替えても1レシピ1枚のまま");

  // 一覧への付け足し
  let list = await callJson(recipesApi.onRequestGet, env, { cookie: alice.cookie });
  assert.match(list.data.recipes[0].photoUrl, /photo\?v=\d+/);
  assert.equal(list.data.recipes[0].photoData, undefined); t.ok("保存済み一覧に写真のURLが付く(画像の中身は含めない)");
  list = await callJson(recipesApi.onRequestGet, env, { cookie: bob.cookie });
  assert.deepEqual(list.data.recipes, []); t.ok("他人の一覧には出ない");

  // 付け足し項目は、保存時にレシピ本体へ混ざらない
  await callJson(recipesApi.onRequestPost, env, { method: "POST", cookie: alice.cookie, body: { ...RECIPE, id: "r-2", photoUrl: "/x", shareToken: "t", photoData: "d" } });
  const stored = JSON.parse(sqlite.prepare("SELECT data FROM recipes WHERE id='r-2'").get().data);
  assert.equal(stored.photoUrl, undefined); assert.equal(stored.shareToken, undefined); assert.equal(stored.photoData, undefined);
  t.ok("画面表示用の付け足し(photoUrl/shareToken/photoData)は保存されない");

  r = await callJson(photo.onRequestDelete, env, { method: "DELETE", params: P, cookie: alice.cookie });
  assert.equal(r.status, 200);
  g = await call(photo.onRequestGet, env, { params: P, cookie: alice.cookie });
  assert.equal(g.status, 404); t.ok("写真を外せる");

  // レシピ削除で写真・共有も消える
  await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, body: { image: PNG_URL } });
  await callJson(share.onRequestPost, env, { method: "POST", params: P, cookie: alice.cookie });
  await callJson(recipeId.onRequestDelete, env, { method: "DELETE", params: P, cookie: alice.cookie });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipe_photos").get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipe_shares").get().n, 0); t.ok("レシピを削除すると、写真と共有リンクも消える");
}

// ---- 共有 ----
{
  const { env, sqlite } = createEnv();
  const alice = await loginAs(env, sqlite, "alice");
  const bob = await loginAs(env, sqlite, "bob");
  saveRecipe(sqlite, alice.id, RECIPE);
  const P = { id: "r-1" };

  let r = await callJson(share.onRequestPost, env, { method: "POST", params: P });
  assert.equal(r.status, 401); t.ok("未ログインでは共有できない");
  r = await callJson(share.onRequestPost, env, { method: "POST", params: P, cookie: bob.cookie });
  assert.equal(r.status, 404); t.ok("他人のレシピは共有できない");
  r = await callJson(share.onRequestPost, env, { method: "POST", params: P, cookie: alice.cookie, headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403); t.ok("別サイトからの共有は断る");

  await callJson(photo.onRequestPut, env, { method: "PUT", params: P, cookie: alice.cookie, body: { image: PNG_URL } });
  r = await callJson(share.onRequestPost, env, { method: "POST", params: P, cookie: alice.cookie });
  assert.equal(r.status, 200);
  const token = r.data.token;
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal(r.data.url, "https://recipe.test/?share=" + token); t.ok("共有リンクを作れる(推測できない32桁)");

  const again = await callJson(share.onRequestPost, env, { method: "POST", params: P, cookie: alice.cookie });
  assert.equal(again.data.token, token); t.ok("もう一度共有しても同じリンクのまま");

  // ログインなしで見られる。共有してよい項目だけ
  const v = await callJson(shared.onRequestGet, env, { params: { token } });
  assert.equal(v.status, 200);
  assert.equal(v.data.recipe.name, "鶏の照り焼き");
  assert.deepEqual(v.data.recipe.steps, ["焼く"]);
  assert.equal(v.data.recipe.nutrition.protein, 40);
  const text = JSON.stringify(v.data);
  ["u-secret", "alice", "r-1", "shareToken", "photoData", "photoUrl\":\"/old"].forEach((s) => assert.ok(!text.includes(s), "含まれてはいけない: " + s));
  assert.match(v.data.photoUrl, new RegExp("^/api/shared/" + token + "/photo\\?v=\\d+$"));
  assert.equal(v.res.headers.get("cache-control"), "no-store"); t.ok("ログインなしで見られる。id・利用者・内部の項目は含まれない");

  const pv = await call(sharedPhoto.onRequestGet, env, { params: { token } });
  assert.equal(pv.status, 200); assert.equal(pv.headers.get("content-type"), "image/png"); t.ok("共有の写真もログインなしで見られる");

  assert.equal((await callJson(shared.onRequestGet, env, { params: { token: "../../etc" } })).status, 404);
  assert.equal((await callJson(shared.onRequestGet, env, { params: { token: "0".repeat(32) } })).status, 404); t.ok("形式が違う・存在しないトークンは404");

  // 一覧に共有トークンが付く
  const list = await callJson(recipesApi.onRequestGet, env, { cookie: alice.cookie });
  assert.equal(list.data.recipes[0].shareToken, token); t.ok("保存済み一覧に共有トークンが付く");

  // 共有後にレシピを直すと、もう一度共有したときに中身が更新される
  sqlite.prepare("UPDATE recipes SET data=? WHERE id='r-1'").run(JSON.stringify({ ...RECIPE, name: "鶏の照り焼き(改)" }));
  assert.equal((await callJson(shared.onRequestGet, env, { params: { token } })).data.recipe.name, "鶏の照り焼き"); // 共有した時点の内容のまま
  await callJson(share.onRequestPost, env, { method: "POST", params: P, cookie: alice.cookie });
  assert.equal((await callJson(shared.onRequestGet, env, { params: { token } })).data.recipe.name, "鶏の照り焼き(改)"); t.ok("共有した時点の内容が見える。再共有で更新される");

  // 取り込み
  r = await callJson(importShare.onRequestPost, env, { method: "POST", body: { token } });
  assert.equal(r.status, 401); t.ok("未ログインではサーバーへ取り込めない(端末内に保存する別の経路がある)");
  r = await callJson(importShare.onRequestPost, env, { method: "POST", cookie: bob.cookie, body: { token: "0".repeat(32) } });
  assert.equal(r.status, 404);
  r = await callJson(importShare.onRequestPost, env, { method: "POST", cookie: bob.cookie, body: { token } });
  assert.equal(r.status, 200);
  const copy = r.data.recipe;
  assert.notEqual(copy.id, "r-1"); assert.match(copy.id, /^r-/);
  assert.equal(copy.name, "鶏の照り焼き(改)");
  assert.ok(copy.photoUrl); assert.equal(copy.shareToken, undefined);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipes WHERE user_id=?").get(bob.id).n, 1);
  const bobPhoto = await call(photo.onRequestGet, env, { params: { id: copy.id }, cookie: bob.cookie });
  assert.equal(bobPhoto.status, 200); t.ok("共有を自分のレシピとして取り込める(新しいid・写真つき・共有元とは別物)");

  // 共有をやめる
  r = await callJson(share.onRequestDelete, env, { method: "DELETE", params: P, cookie: bob.cookie });
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipe_shares").get().n, 1); t.ok("他人は共有を止められない");
  r = await callJson(share.onRequestDelete, env, { method: "DELETE", params: P, cookie: alice.cookie });
  assert.equal(r.status, 200);
  assert.equal((await callJson(shared.onRequestGet, env, { params: { token } })).status, 404);
  assert.equal((await call(sharedPhoto.onRequestGet, env, { params: { token } })).status, 404);
  assert.equal((await callJson(importShare.onRequestPost, env, { method: "POST", cookie: bob.cookie, body: { token } })).status, 404); t.ok("共有をやめると、閲覧・写真・取り込みがすべて404になる");
}

// ---- スナップショットの項目 ----
{
  const s = buildSnapshot({ ...RECIPE, sourceUrl: "javascript:alert(1)" });
  assert.equal(s.sourceUrl, undefined); t.ok("http(s)以外の取り込み元URLは共有に含めない");
  assert.equal(buildSnapshot({ name: "x", sourceUrl: "https://example.com/r" }).sourceUrl, "https://example.com/r");
  // 共有されたレシピは、見た人の画面に表示される。型の合わないもの(文字列の栄養値など)や、決められた項目以外は共有に含めない
  const hostile = buildSnapshot({
    name: "<img src=x onerror=alert(1)>", steps: ["<script>x</script>", 5, null],
    nutrition: { protein: "<img src=x onerror=alert(2)>", calories: 5, evil: 1 },
    nutritionCheck: { unmatched: ["<u>", 5], missing: "x" },
    protein: "<x>", calories: 7,
    ingredientDetails: [{ name: "<b>", grams: "<i>", amount: "1個", match: { label: "<s>", foodNo: "<q>", evil: 1 }, extra: "x", manual: { protein: "<x>", fat: 3 } }, "str", null],
  });
  assert.deepEqual(hostile.nutrition, { calories: 5 });
  assert.equal(hostile.protein, undefined); assert.equal(hostile.calories, 7);
  assert.deepEqual(hostile.nutritionCheck, { unmatched: ["<u>"], missing: [] });
  assert.deepEqual(hostile.ingredientDetails, [{ name: "<b>", amount: "1個", match: { label: "<s>" }, manual: { fat: 3 } }]);
  assert.deepEqual(hostile.steps, ["<script>x</script>"]);
  t.ok("共有の対象は、型の合うものだけに絞られる(文字列の栄養値・余計な項目・数値でない値は落とす。文字列は画面側で無害化して表示する)");
  const huge = buildSnapshot({ name: "x", ingredients: Array.from({ length: 200 }, () => "あ".repeat(500)), steps: Array.from({ length: 200 }, () => "い".repeat(2000)) });
  assert.ok(huge.ingredients.length <= 60 && huge.steps.length <= 60 && JSON.stringify(huge).length < 200000); t.ok("件数・長さに上限があり、巨大なレシピは切り詰められる");
}

// ---- マイグレーション未適用でも、保存済み一覧は今までどおり動く ----
{
  const sqlite0 = createEnv();
  sqlite0.sqlite.exec("DROP TABLE recipe_shares; DROP TABLE recipe_photos;");
  const alice = await loginAs(sqlite0.env, sqlite0.sqlite, "alice");
  saveRecipe(sqlite0.sqlite, alice.id, RECIPE);
  const list = await callJson(recipesApi.onRequestGet, sqlite0.env, { cookie: alice.cookie });
  assert.equal(list.status, 200); assert.equal(list.data.recipes.length, 1); assert.equal(list.data.recipes[0].photoUrl, undefined);
  t.ok("写真・共有のテーブルが無くても、保存済み一覧は返る");
  const del = await callJson(recipeId.onRequestDelete, sqlite0.env, { method: "DELETE", params: { id: "r-1" }, cookie: alice.cookie });
  assert.equal(del.status, 200); t.ok("テーブルが無くても、レシピの削除は動く");
  const p = await callJson(photo.onRequestPut, sqlite0.env, { method: "PUT", params: { id: "r-1" }, cookie: alice.cookie, body: { image: PNG_URL } });
  saveRecipe(sqlite0.sqlite, alice.id, RECIPE);
  const p2 = await callJson(photo.onRequestPut, sqlite0.env, { method: "PUT", params: { id: "r-1" }, cookie: alice.cookie, body: { image: PNG_URL } });
  assert.equal(p2.status, 503); assert.match(p2.data.error, /マイグレーション/); t.ok("テーブルが無いときの写真の追加は、503で更新が必要と案内する");
}

// ---- マイグレーションSQLは何度流しても安全で、schema.sql と同じテーブルを作る ----
{
  const { sqlite } = createEnv();
  const mig = fs.readFileSync(path.join(root, "db/migration-010-photos-shares.sql"), "utf8");
  sqlite.exec(mig); sqlite.exec(mig);
  t.ok("migration-010 は、何度実行してもエラーにならない");
}

assert.equal(guard.calls.length, 0, "外部通信は0件のはず: " + guard.calls.join(","));
t.ok("このテスト中の外部通信(AI含む)は0件");
guard.restore();
t.done();
