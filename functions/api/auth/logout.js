// POST /api/auth/logout
import { destroySession, json } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const cookie = await destroySession(env, request);
  return json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
