// DELETE /api/recipes/:id
// PUT    /api/recipes/:id → 自分のレシピを上書き(body: 自作と同じ。recipes.data だけを更新)
import { getSessionUser, json } from "../../_lib/session.js";
import { readEditRequest, validateDraft, buildRecipe } from "../../_lib/recipe-edit.js";

export async function onRequestDelete({ request, env, params }) {
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "ログインが必要です" }, { status: 401 });

  await env.DB.prepare("DELETE FROM recipes WHERE user_id = ? AND id = ?")
    .bind(user.id, params.id)
    .run();

  return json({ ok: true });
}

export async function onRequestPut({ request, env, params }) {
  const r = await readEditRequest(request, env, validateDraft);
  if (r.response) return r.response;

  // 自分の (user_id, id) だけを UPDATE し、変わった行が無ければ 404(確認と更新の間に消えた場合も含む)
  const recipe = await buildRecipe(env, r.value, params.id);
  const result = await env.DB.prepare("UPDATE recipes SET data = ? WHERE user_id = ? AND id = ?")
    .bind(JSON.stringify(recipe), r.user.id, params.id)
    .run();
  if (result?.meta?.changes === 0) {
    return json({ error: "レシピが見つかりません" }, { status: 404 });
  }
  return json({ recipe });
}
