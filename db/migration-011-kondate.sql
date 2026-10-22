-- ==== 目標の目安・食事記録・週プラン・買い物リスト・写真の栄養計算用テーブル(追加分) ====
-- 適用方法(どちらでも可。何度実行しても安全です):
--   ・Cloudflare の画面: Workers & Pages → D1 → recipe-app-db → コンソール に、このファイルの中身を貼り付けて実行
--   ・wrangler d1 execute recipe-app-db --file=./db/migration-011-kondate.sql --remote
-- 未適用でもアプリは動きます(今日・週プラン・買い物の機能だけが使えず、今までの「作る」「保存済み」は変わりません)。
-- ユーザーを削除すると、ここのデータも一緒に消えます(ON DELETE CASCADE)。

-- 目標の目安(プロフィール・自分で設定した値・数字の表示設定)をJSONで1行ずつ
CREATE TABLE IF NOT EXISTS user_targets (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- お持ちの食材(買い物リストから差し引く)
CREATE TABLE IF NOT EXISTS user_pantry (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- 食事の記録。直近5週間ぶんだけ残し、古いものは記録のたびに自動で消す(functions/_lib/meals.js)
CREATE TABLE IF NOT EXISTS meal_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,              -- 日本時間の日付 YYYY-MM-DD
  slot        TEXT NOT NULL,              -- 朝 / 昼 / 夜 / 間食
  name        TEXT NOT NULL,
  nutrition   TEXT NOT NULL,              -- 栄養値のJSON
  approx      INTEGER NOT NULL DEFAULT 0, -- 1=おおよその値(外食・写真・ざっくり入力)
  source      TEXT NOT NULL,              -- recipe / ingredients / quick / plan
  recipe_id   TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_day ON meal_logs(user_id, day);

-- 週プラン(1ユーザー・1週に1行)。days は7日分のJSON
CREATE TABLE IF NOT EXISTS week_plans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  TEXT NOT NULL,              -- その週の月曜日 YYYY-MM-DD
  status      TEXT NOT NULL,              -- idle / running / done / error
  stage       TEXT NOT NULL DEFAULT 'queued',
  progress    INTEGER NOT NULL DEFAULT 0,
  days        TEXT NOT NULL,
  request     TEXT,
  shopping    TEXT,                       -- 買い物リストのチェック状態(JSON)
  usage_day   TEXT,                       -- AIの利用回数を確保した日(失敗時に戻すため)
  ai_calls    INTEGER NOT NULL DEFAULT 0, -- この週プランでAIを呼んだ回数(上限あり)
  lease_until INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_week_plans_user_week ON week_plans(user_id, week_start);

-- ユーザーごとの月間のAI利用回数(週プラン・写真の栄養計算の上限。アプリ全体の1日の上限とは別に数える)
CREATE TABLE IF NOT EXISTS ai_usage_user (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,              -- YYYY-MM(日本時間)
  kind        TEXT NOT NULL,              -- week / photo
  used        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month, kind)
);
