// POST /api/recipes/import-text   body: { text } → 貼り付けたレシピの文章を読み取って、編集シートの下書きを返す
// 【重要】AI(xAI・有料)は呼びません。「材料」「作り方」の見出しで区切る決まったルールだけで読みます。外部通信もしません。
import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import { parseRecipeText, ImportError, IMPORT_LIMITS } from "../../_lib/recipe-import.js";

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
  const text = body && typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return json({ error: "テキストを貼り付けてください" }, { status: 400 });
  if (text.length > IMPORT_LIMITS.text * 2) return json({ error: "テキストが長すぎます" }, { status: 400 });
  try {
    return json(parseRecipeText(text));
  } catch (err) {
    if (err instanceof ImportError) return json({ error: err.message, code: err.code }, { status: err.status });
    throw err;
  }
}
