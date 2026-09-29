// POST /api/auth/register-verify
// body: startRegistration()が返したレスポンスそのもの
// → 検証OKならユーザー・クレデンシャルを作成し、ログイン状態にする

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { consumeChallenge, clearChallengeCookie, createSession, publicUser, json } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  let responseBody;
  try {
    responseBody = await request.json();
  } catch (e) {
    return json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const challengeRecord = await consumeChallenge(env, request, "register");
  if (!challengeRecord || !challengeRecord.payload) {
    return json({ error: "登録セッションの期限が切れました。最初からやり直してください" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  const { username, displayName } = challengeRecord.payload;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: responseBody,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
    });
  } catch (err) {
    return json({ error: "パスキーの検証に失敗しました" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return json({ error: "パスキーの検証に失敗しました" }, {
      status: 400,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // 自動生成した内部用の名前が万が一重複していた場合の再チェック(ほぼ起きません)
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first();
  if (existing) {
    return json({ error: "登録に失敗しました。もう一度お試しください" }, {
      status: 409,
      headers: { "Set-Cookie": clearChallengeCookie() },
    });
  }

  const userId = crypto.randomUUID();
  const publicKeyB64 = base64UrlEncode(credential.publicKey);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)")
      .bind(userId, username, displayName),
    env.DB.prepare(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      credential.id,
      userId,
      publicKeyB64,
      credential.counter,
      JSON.stringify(credential.transports || []),
      credentialDeviceType,
      credentialBackedUp ? 1 : 0
    ),
  ]);

  const sessionCookie = await createSession(env, userId);

  return json(
    { user: publicUser(env, { id: userId }) },
    {
      headers: [
        ["Set-Cookie", clearChallengeCookie()],
        ["Set-Cookie", sessionCookie],
      ],
    }
  );
}

function base64UrlEncode(bytes) {
  let binary = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
