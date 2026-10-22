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

-- 料理の写真・共有リンク(db/migration-010-photos-shares.sql と同じ内容。初回構築用)
CREATE TABLE IF NOT EXISTS recipe_photos (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id   TEXT NOT NULL,
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,           -- ミリ秒。画像URLの ?v= に使い、差し替え時にキャッシュを避ける
  PRIMARY KEY (user_id, recipe_id),
  FOREIGN KEY (user_id, recipe_id) REFERENCES recipes(user_id, id) ON DELETE CASCADE
);

-- 共有リンク(1レシピに1リンク)。共有した時点のレシピのコピー(snapshot)と写真を持つ。
-- token は推測できないランダム値で、ログインなしで見られる(共有を止める=この行を消す)
CREATE TABLE IF NOT EXISTS recipe_shares (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id   TEXT NOT NULL,
  snapshot    TEXT NOT NULL,              -- 共有してよい項目だけを抜き出したレシピのJSON
  photo_mime  TEXT,
  photo_data  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (user_id, recipe_id) REFERENCES recipes(user_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_shares_recipe ON recipe_shares(user_id, recipe_id);

-- ==== 目標の目安・食事記録・週プラン用テーブル(db/migration-011-kondate.sql と同じ内容。初回構築用) ====
CREATE TABLE IF NOT EXISTS user_targets (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_pantry (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meal_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  slot        TEXT NOT NULL,
  name        TEXT NOT NULL,
  nutrition   TEXT NOT NULL,
  approx      INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL,
  recipe_id   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_day ON meal_logs(user_id, day);
CREATE TABLE IF NOT EXISTS week_plans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,
  status      TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'queued',
  progress    INTEGER NOT NULL DEFAULT 0,
  days        TEXT NOT NULL,
  request     TEXT,
  shopping    TEXT,
  usage_day   TEXT,
  ai_calls    INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_week_plans_user_week ON week_plans(user_id, week_start);
CREATE TABLE IF NOT EXISTS ai_usage_user (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month, kind)
);
