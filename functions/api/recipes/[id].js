// DELETE /api/recipes/:id
import { getSessionUser, json } from "../../_lib/session.js";

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });

  await env.DB.prepare("DELETE FROM recipes WHERE user_id = ? AND id = ?")
    .bind(user.id, params.id)
    .run();

  return json({ ok: true });
}
