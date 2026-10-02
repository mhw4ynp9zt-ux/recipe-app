// POST /api/recipes/custom → 自作レシピを1件保存(idはサーバーが付ける。栄養はサーバーで計算し直す)
import { json } from "../../_lib/session.js";
import { readEditRequest, validateDraft, buildRecipe } from "../../_lib/recipe-edit.js";

export async function onRequestPost({ request, env }) {
  const r = await readEditRequest(request, env, validateDraft);
  if (r.response) return r.response;

  const recipe = await buildRecipe(env, r.value, "r-" + crypto.randomUUID());
  await env.DB.prepare("INSERT INTO recipes (id, user_id, data) VALUES (?, ?, ?)")
    .bind(recipe.id, r.user.id, JSON.stringify(recipe))
    .run();
  return json({ recipe });
}
