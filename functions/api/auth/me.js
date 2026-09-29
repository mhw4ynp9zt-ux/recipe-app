// GET /api/auth/me → ログイン中なら { user: { id, isAdmin } }、未ログインなら { user: null } を返す
import { getSessionUser, publicUser, json } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  return json({ user: user ? publicUser(env, user) : null });
}
