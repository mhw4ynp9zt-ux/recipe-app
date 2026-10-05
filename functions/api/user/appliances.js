// /api/user/appliances(ログイン必須。自分の設定だけ)
//
// GET → { appliances: [{ name, can, policy, note, spec? }, ...], max: 5, maxNameLength: 20, maxNoteLength: 100 }   登録済みの「使っている調理家電」
// PUT → body: { appliances: [{ name, can, policy, note, spec? }, ...] }                                          一覧をまるごと置き換えて保存し、保存した一覧を返す
//
// ここはDBを読み書きするだけで、AIは呼びません(=費用は発生しません)。
// 登録した家電は、レシピ作成の開始時(functions/_lib/recipe-job.js の startJob)に読まれ、AIへの条件に加わります。

import { getSessionUser, checkOrigin, json } from "../../_lib/session.js";
import {
  parseAppliances, loadAppliances, saveAppliances, MAX_APPLIANCES, MAX_APPLIANCE_NAME_LEN, MAX_APPLIANCE_NOTE_LEN,
} from "../../_lib/appliances.js";

const NO_STORE = { "Cache-Control": "no-store" };
const LIMITS = { max: MAX_APPLIANCES, maxNameLength: MAX_APPLIANCE_NAME_LEN, maxNoteLength: MAX_APPLIANCE_NOTE_LEN };

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE });
  try {
    return json({ appliances: await loadAppliances(env, user.id), ...LIMITS }, { headers: NO_STORE });
  } catch (e) {
    console.error("loadAppliances failed: " + (e && e.message));
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

  const parsed = parseAppliances(body.appliances);
  if (parsed.error) return json({ error: parsed.error }, { status: 400, headers: NO_STORE });

  try {
    const appliances = await saveAppliances(env, user.id, parsed.value);
    return json({ appliances, ...LIMITS }, { headers: NO_STORE });
  } catch (e) {
    console.error("saveAppliances failed: " + (e && e.message));
    return json({ error: "保存できませんでした。時間をおいてもう一度お試しください" }, { status: 500, headers: NO_STORE });
  }
}
