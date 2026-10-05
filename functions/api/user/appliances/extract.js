// POST /api/user/appliances/extract(ログイン必須)
//   body: { name, text }  → 200 { proposal: { can, note, spec }, remaining } / エラー { error }
// 説明書の文字から家電の登録内容の「案」をAIで読み取って返すだけです。保存はしません(user_settings.appliances は読み書きしません)。
// 【費用】AI(有料)を1回呼びます。1人1日3回・アプリ全体の上限にも計上。入口の順序: 未ログイン401 → Origin不一致403 → JSON不正400 → 読み取り。
import { getSessionUser, checkOrigin, json } from "../../../_lib/session.js";
import { runExtract, defaultExtractDeps } from "../../../_lib/manual-extract.js";

const NO_STORE = { "Cache-Control": "no-store" };

export async function onRequestPost({ request, env }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401, headers: NO_STORE });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403, headers: NO_STORE });

  let body = null;
  try { body = await request.json(); } catch (e) { /* 読めなければ null のまま */ }
  if (!body || typeof body !== "object") return json({ error: "リクエストが不正です" }, { status: 400, headers: NO_STORE });

  const r = await runExtract(env, user, body, defaultExtractDeps);
  return json(r.body, { status: r.status, headers: NO_STORE });
}
