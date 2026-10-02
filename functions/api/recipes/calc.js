// POST /api/recipes/calc → 食材から栄養を計算して返す(保存しない。AIも外部APIも呼ばない)
import { json } from "../../_lib/session.js";
import { readEditRequest, validateIngredients, calcIngredients } from "../../_lib/recipe-edit.js";

export async function onRequestPost({ request, env }) {
  const r = await readEditRequest(request, env, validateIngredients, (body) => body && body.ingredients);
  if (r.response) return r.response;
  return json(await calcIngredients(env, r.value));
}
