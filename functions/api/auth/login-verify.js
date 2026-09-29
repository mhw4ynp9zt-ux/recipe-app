// POST /api/auth/login-verify
// body: startAuthentication()が返したレスポンスそのもの

import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { consumeChallenge, clearChallengeCookie, createSession, publicUser, json } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  let responseBody;
  try {
    responseBody = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const challengeRecord = await consumeChallenge(env, request, "login");
  if (!challengeRecord) {
    return json({ error: "ログインセッションの期限が切れました。もう一度お試しください" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  const credentialId = responseBody.id;
  const credRow = await env.DB.prepare(
    "SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = ?"
  ).bind(credentialId).first();

  if (!credRow) {
    return json({ error: "登録されていないパスキーです" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: responseBody,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential: {
        id: credRow.id,
        publicKey: base64UrlDecode(credRow.public_key),
        counter: credRow.counter,
        transports: credRow.transports ? JSON.parse(credRow.transports) : undefined,
      },
    });
  } catch (err) {
    return json({ error: "パスキーの検証に失敗しました" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  if (!verification.verified) {
    return json({ error: "パスキーの検証に失敗しました" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  // クローン検知用にカウンタを更新
  await env.DB.prepare("UPDATE credentials SET counter = ? WHERE id = ?")
    .bind(verification.authenticationInfo.newCounter, credRow.id)
    .run();

  const user = await env.DB.prepare(
    "SELECT id, username, display_name FROM users WHERE id = ?"
  ).bind(credRow.user_id).first();

  const sessionCookie = await createSession(env, user.id);

  return json(
    { user: publicUser(env, user) },
    {
      headers: [
        ["Set-Cookie", clearChallengeCookie()],
        ["Set-Cookie", sessionCookie],
      ],
    }
  );
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
