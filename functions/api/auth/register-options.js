// POST /api/auth/register-options
// body: なし(ユーザー名は入力させず、サーバー側で内部用の名前を自動生成します)
// → navigator.credentials.create() に渡すoptionsを返す
//
// 1ユーザーにつきパスキーは1つだけ。既存アカウントにパスキーを追加する機能は作らず、
// ログイン中の新規登録リクエストは拒否します(別アカウントが増えてしまうのを防ぐため)。

import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createChallenge, getSessionUser, checkOrigin, json } from "../../_lib/session.js";

// パスキーの選択画面に表示される内部用の名前(例: recipe-a1b2c3d4)。ユーザーには入力させない。
function generateUsername() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `recipe-${hex}`;
}

export async function onRequestPost({ request, env }) {
  if (!checkOrigin(request, env)) {
    return json({ error: "不正なリクエストです" }, { status: 403 });
  }

  const current = await getSessionUser(env, request);
  if (current) {
    return json({ error: "すでにログイン中です。パスキーは1人1つまでです" }, { status: 409 });
  }

  const username = generateUsername();
  const displayName = env.RP_NAME || "コンダテ";

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
