// GET /api/auth/me → ログイン中ならユーザー情報、未ログインならnullを返す
import { getSessionUser, json } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(env, request);
  return json({ user });
}
