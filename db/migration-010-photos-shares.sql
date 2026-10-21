-- ==== 料理の写真・レシピの共有リンク用テーブル(追加分) ====
-- 適用方法(どちらでも可。何度実行しても安全です):
--   ・Cloudflare の画面: Workers & Pages → D1 → recipe-app-db → コンソール に、このファイルの中身を貼り付けて実行
--   ・wrangler d1 execute recipe-app-db --file=./db/migration-010-photos-shares.sql --remote
-- 未適用でもアプリは動きます(写真・共有の機能だけが使えず、保存済み一覧は今までどおり出ます)。

-- 料理の写真(1レシピに1枚)。端末側で縮小したJPEG/PNG/WebPをbase64文字列のまま保存する(上限は functions/_lib/photo.js)
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
