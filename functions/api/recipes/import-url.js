// POST /api/recipes/import-url   body: { url }  → レシピのページ(JSON-LD)を読み取って、編集シートの下書きを返す
// POST /api/recipes/import-text  body: { text } (import-text.js)
// 【重要】AI(xAI・有料)は呼びません。ページを1回取得して決まったルールで読むだけです(AI設定・利用回数にも触れません)。
// ログイン中だけ使える(サーバーが外のページを取りに行くため、誰でも使える入口にしない)。栄養はここでは計算しない。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { importFromUrl, ImportError } from "../../_lib/recipe-import.js";

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }
  try {
    return json(await importFromUrl(body && body.url));
  } catch (err) {
    if (err instanceof ImportError) return json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}
