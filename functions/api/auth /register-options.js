// POST /api/auth/register-options
// body: { username: string, displayName: string }
// → navigator.credentials.create() に渡すoptionsを返す

import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createChallenge, json } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const username = (body.username || "").trim();
  const displayName = (body.displayName || username).trim();

  if (!username || username.length < 2 || username.length > 50) {
    return json({ error: "ユーザー名は2〜50文字で入力してください" }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first();
  if (existing) {
    return json({ error: "そのユーザー名はすでに使われています" }, { status: 409 });
  }

  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: username,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",       // ユーザー名なしログイン(ディスカバラブル資格情報)を必須にする
      userVerification: "preferred",
    },
  });

  const { cookie } = await createChallenge(env, {
    challenge: options.challenge,
    type: "register",
    payload: { username, displayName },
  });

  return json(options, { headers: { "Set-Cookie": cookie } });
}
