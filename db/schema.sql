-- ==== レシピアプリ ログイン機能用 D1スキーマ ====
-- 適用方法:
--   wrangler d1 execute recipe-app-db --file=./db/schema.sql --remote

-- ユーザー
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,          -- crypto.randomUUID()
  username     TEXT NOT NULL UNIQUE,      -- ログインID(メールでも好きな文字列でも可)
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- パスキー(WebAuthnクレデンシャル)。1ユーザーが複数端末分を持てる
CREATE TABLE IF NOT EXISTS credentials (
  id            TEXT PRIMARY KEY,         -- credential ID (base64url)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,            -- base64url化した公開鍵
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                     -- JSON配列文字列 (例: ["internal","hybrid"])
  device_type   TEXT,                     -- "singleDevice" | "multiDevice"
  backed_up     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials(user_id);

-- 登録・ログイン中に発行するチャレンジ(短命・使い捨て)
CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,           -- Cookieに載せるランダムID
  user_id     TEXT,                       -- 登録時のみ設定。ログイン(usernameless)時はNULL
  challenge   TEXT NOT NULL,
  type        TEXT NOT NULL,              -- "register" | "login"
  payload     TEXT,                       -- 登録時: {"username":..,"displayName":..} のJSON文字列
  expires_at  TEXT NOT NULL
);

-- ログインセッション
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,           -- crypto.randomUUID()、Cookieに載せる値
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- レシピ(今までlocalStorageに入れていたものをユーザー単位で保存)
CREATE TABLE IF NOT EXISTS recipes (
  id          TEXT NOT NULL,              -- クライアント側で生成しているレシピID
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,              -- レシピ全体をJSON文字列でそのまま保存
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, id)
);
