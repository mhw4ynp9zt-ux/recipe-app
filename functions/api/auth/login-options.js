// POST /api/auth/login-options
// ユーザー名を送らせない「usernameless」方式。端末に保存されたパスキーの一覧から
// ブラウザ側が候補を出す(id指定しないのでallowCredentialsは空にする)

import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createChallenge, json } from "../../_lib/session.js";

export async function onRequestPost({ env }) {
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    userVerification: "preferred",
    allowCredentials: [], // 空にすることで、この端末に保存済みの全パスキーが候補になる
  });

  const { cookie } = await createChallenge(env, {
    challenge: options.challenge,
    type: "login",
  });

  return json(options, { headers: { "Set-Cookie": cookie } });
}
