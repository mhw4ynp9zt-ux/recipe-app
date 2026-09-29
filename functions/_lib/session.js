// functions配下で _ から始まるファイル/フォルダはルーティング対象外になる(Pages Functionsの仕様)。
// 各エンドポイントから import { ... } from "../_lib/session.js" のように読み込んで使う共通処理。

const SESSION_COOKIE = "session";
const CHALLENGE_COOKIE = "challenge_id";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30日
const CHALLENGE_TTL_SEC = 60 * 5; // 5分

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function buildCookie(name, value, maxAgeSec) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ];
  if (maxAgeSec === 0) {
    parts.push("Max-Age=0");
  } else {
    parts.push(`Max-Age=${maxAgeSec}`);
  }
  return parts.join("; ");
}

// ==== チャレンジ(登録・ログイン中だけ使う使い捨ての値) ====

async function createChallenge(env, { challenge, type, userId = null, payload = null }) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO challenges (id, user_id, challenge, type, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, challenge, type, payload ? JSON.stringify(payload) : null, expiresAt).run();
  return { id, cookie: buildCookie(CHALLENGE_COOKIE, id, CHALLENGE_TTL_SEC) };
}

async function consumeChallenge(env, request, expectedType) {
  const cookies = parseCookies(request);
  const id = cookies[CHALLENGE_COOKIE];
  if (!id) return null;

  const row = await env.DB.prepare(
    "SELECT id, user_id, challenge, type, payload, expires_at FROM challenges WHERE id = ?"
  ).bind(id).first();

  // 使い捨てなので取得できたら即削除(リプレイ攻撃対策)
  await env.DB.prepare("DELETE FROM challenges WHERE id = ?").bind(id).run();

  if (!row) return null;
  if (row.type !== expectedType) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return {
    challenge: row.challenge,
    userId: row.user_id,
    payload: row.payload ? JSON.parse(row.payload) : null,
  };
}

function clearChallengeCookie() {
  return buildCookie(CHALLENGE_COOKIE, "", 0);
}

// ==== セッション(ログイン状態) ====

async function createSession(env, userId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(token, userId, expiresAt).run();
  return buildCookie(SESSION_COOKIE, token, SESSION_TTL_SEC);
}

async function getSessionUser(env, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT users.id AS id, users.username AS username, users.display_name AS display_name, sessions.expires_at AS expires_at
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`
  ).bind(token).first();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { id: row.id, username: row.username, displayName: row.display_name };
}

async function destroySession(env, request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
  return buildCookie(SESSION_COOKIE, "", 0);
}

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

// ==== 管理者判定・リクエスト検証 ====

// 管理者は環境変数 ADMIN_USER_ID に指定したユーザーIDの1人だけ。
// 未設定なら誰も管理者にならない(安全側に倒す)。
function isAdminUser(env, user) {
  return !!user && !!env.ADMIN_USER_ID && user.id === env.ADMIN_USER_ID;
}

// 画面に返してよいユーザー情報(内部のユーザー名などは返さない)
function publicUser(env, user) {
  return { id: user.id, isAdmin: isAdminUser(env, user) };
}

// 他のサイトからのPOST/PUTを弾く(Originヘッダーが付いている場合だけ確認する)
function checkOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === env.ORIGIN;
}

// 管理者専用APIの入口で使う。成功なら { user }、失敗なら { error: Response } を返す。
async function requireAdmin(env, request) {
  const user = await getSessionUser(env, request);
  if (!user) return { error: json({ error: "ログインが必要です" }, { status: 401 }) };
  if (!isAdminUser(env, user)) return { error: json({ error: "権限がありません" }, { status: 403 }) };
  if (request.method !== "GET" && !checkOrigin(request, env)) {
    return { error: json({ error: "不正なリクエストです" }, { status: 403 }) };
  }
  return { user };
}

export {
  createChallenge,
  consumeChallenge,
  clearChallengeCookie,
  createSession,
  getSessionUser,
  destroySession,
  json,
  isAdminUser,
  publicUser,
  checkOrigin,
  requireAdmin,
};
