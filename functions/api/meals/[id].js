// DELETE /api/meals/:id → 記録を1件消す
import { getSessionUser, json, checkOrigin } from "../../_lib/session.js";
import { deleteMeal, isMissingTable } from "../../_lib/meals.js";

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });
  if (!checkOrigin(request, env)) return json({ error: "不正なリクエストです" }, { status: 403 });
  try {
    const ok = await deleteMeal(env, user.id, String(params.id || ""));
    return ok ? json({ ok: true }) : json({ error: "記録が見つかりません" }, { status: 404 });
  } catch (e) {
    if (isMissingTable(e)) return json({ error: "準備中です", unavailable: true }, { status: 503 });
    throw e;
  }
}
