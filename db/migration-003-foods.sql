-- 日本食品標準成分表(八訂)増補2023年 のデータ。可食部100gあたり。
-- このファイルは scripts/build_foods_sql.py が生成しました(テーブル定義)。データは db/seed-foods.sql。
--   数値    : 成分表の値。( ) の推定値は数値として登録。Tr(微量)は0。
--   NULL    : 成分表で「-」(未測定)。計算では0として扱う。

CREATE TABLE IF NOT EXISTS food_groups (
  group_code TEXT PRIMARY KEY,   -- 食品群(01〜18)
  group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS foods (
  food_no    TEXT PRIMARY KEY,   -- 食品番号(例: 06061)。先頭2桁が食品群
  group_code TEXT NOT NULL,      -- food_groups.group_code(外部キーは張らない: seedを何度流しても失敗しないように)
  index_no   TEXT,               -- 索引番号
  name       TEXT NOT NULL,      -- 食品名(成分表の表記のまま)
  refuse     REAL,
  enerc      REAL,
  enerc_kcal REAL,
  water      REAL,
  protcaa    REAL,
  prot       REAL,
  fatnlea    REAL,
  chole      REAL,
  fat        REAL,
  choavlm    REAL,
  choavl     REAL,
  choavldf   REAL,
  fib        REAL,
  polyl      REAL,
  chocdf     REAL,
  oa         REAL,
  ash        REAL,
  na         REAL,
  k          REAL,
  ca         REAL,
  mg         REAL,
  p          REAL,
  fe         REAL,
  zn         REAL,
  cu         REAL,
  mn         REAL,
  iodine     REAL,
  se         REAL,
  cr         REAL,
  mo         REAL,
  retol      REAL,
  carta      REAL,
  cartb      REAL,
  crypxb     REAL,
  cartbeq    REAL,
  vita_rae   REAL,
  vitd       REAL,
  tocpha     REAL,
  tocphb     REAL,
  tocphg     REAL,
  tocphd     REAL,
  vitk       REAL,
  thia       REAL,
  ribf       REAL,
  nia        REAL,
  ne         REAL,
  vitb6a     REAL,
  vitb12     REAL,
  fol        REAL,
  pantac     REAL,
  biot       REAL,
  vitc       REAL,
  alc        REAL,
  nacl_eq    REAL,
  note       TEXT                -- 備考
);
CREATE INDEX IF NOT EXISTS idx_foods_group ON foods(group_code);

-- 列名・日本語名・単位の対応表(画面表示や将来の拡張用)
CREATE TABLE IF NOT EXISTS nutrient_defs (
  code      TEXT PRIMARY KEY,    -- 成分識別子(例: PROT-)
  "column"  TEXT NOT NULL,       -- foods テーブルの列名
  label     TEXT NOT NULL,
  unit      TEXT NOT NULL,
  sort_no   INTEGER NOT NULL
);
