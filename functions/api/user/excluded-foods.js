// /api/user/excluded-foods(ログイン必須。自分の設定だけ)
//
// GET → { foods: ["パクチー", ...], max: 30, maxLength: 20 }   登録済みの「使わない食材」
// PUT → body: { foods: ["パクチー", ...] }                       一覧をまるごと置き換えて保存し、保存した一覧を返す
//
// ここはDBを読み書きするだけで、AIは呼びません(=費用は発生しません)。
// 登録した食材は、レシピ作成の開始時(functions/_lib/recipe-job.js の startJob)に読まれ、AIへの条件に加わります。

import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import {
  parseExcludedFoods, loadExcludedFoods, saveExcludedFoods, MAX_EXCLUDED, MAX_EXCLUDED_NAME_LEN,
} from "../../_lib/excluded-foods.js";

const NO_STORE = { "Cache-Control": "no-store" };
const LIMITS = { max: MAX_EXCLUDED, maxLength: MAX_EXCLUDED_NAME_LEN };

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE });
  try {
    return json({ foods: await loadExcludedFoods(env, user.id), ...LIMITS }, { headers: NO_STORE });
  } catch (e) {
    console.error("loadExcludedFoods failed: " + (e && e.message));
    return json({ error: "サーバーでエラーが発生しました。もう一度お試しください" }, { status: 500, headers: NO_STORE });
  }
}

export async function onRequestPut({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403, headers: NO_STORE });

  let body = null;
  try { body = await request.json(); } catch (e) { /* 読めなければ null のまま */ }
  if (!body || typeof body !== "object") return json({ error: "リクエストが不正です" }, { status: 400, headers: NO_STORE });

  const parsed = parseExcludedFoods(body.foods);
  if (parsed.error) return json({ error: parsed.error }, { status: 400, headers: NO_STORE });

  try {
    const foods = await saveExcludedFoods(env, user.id, parsed.value);
    return json({ foods, ...LIMITS }, { headers: NO_STORE });
  } catch (e) {
    console.error("saveExcludedFoods failed: " + (e && e.message));
    return json({ error: "保存できませんでした。時間をおいてもう一度お試しください" }, { status: 500, headers: NO_STORE });
  }
}
