#!/usr/bin/env python3
"""日本食品標準成分表(文科省のExcel)から、D1用のSQLを作る。

使い方:
    python3 scripts/build_foods_sql.py 食品データ.xlsx

出力:
    db/migration-003-foods.sql   テーブル定義(foods / food_groups / nutrient_defs)
    db/seed-foods.sql            データ投入(INSERT OR REPLACE なので何度流しても同じ結果)

値の扱い:
    数値            → そのまま
    (12.3)          → 12.3   (推定値・補完値。成分表でも計算に使う値)
    Tr (微量)       → 0
    -  (未測定)     → NULL   (計算では0扱い)
    20.3†           → 20.3   (注記記号を除去)
"""
import re
import sys
import openpyxl

SRC = sys.argv[1] if len(sys.argv) > 1 else "食品データ.xlsx"

# (Excelの成分識別子, DBの列名, 日本語名, 単位)  ※並び順がDBの列順
NUTRIENTS = [
    ("REFUSE", "refuse", "廃棄率", "%"),
    ("ENERC", "enerc", "エネルギー", "kJ"),
    ("ENERC_KCAL", "enerc_kcal", "エネルギー", "kcal"),
    ("WATER", "water", "水分", "g"),
    ("PROTCAA", "protcaa", "アミノ酸組成によるたんぱく質", "g"),
    ("PROT-", "prot", "たんぱく質", "g"),
    ("FATNLEA", "fatnlea", "脂肪酸のトリアシルグリセロール当量", "g"),
    ("CHOLE", "chole", "コレステロール", "mg"),
    ("FAT-", "fat", "脂質", "g"),
    ("CHOAVLM", "choavlm", "利用可能炭水化物(単糖当量)", "g"),
    ("CHOAVL", "choavl", "利用可能炭水化物(質量計)", "g"),
    ("CHOAVLDF-", "choavldf", "差引き法による利用可能炭水化物", "g"),
    ("FIB-", "fib", "食物繊維総量", "g"),
    ("POLYL", "polyl", "糖アルコール", "g"),
    ("CHOCDF-", "chocdf", "炭水化物", "g"),
    ("OA", "oa", "有機酸", "g"),
    ("ASH", "ash", "灰分", "g"),
    ("NA", "na", "ナトリウム", "mg"),
    ("K", "k", "カリウム", "mg"),
    ("CA", "ca", "カルシウム", "mg"),
    ("MG", "mg", "マグネシウム", "mg"),
    ("P", "p", "リン", "mg"),
    ("FE", "fe", "鉄", "mg"),
    ("ZN", "zn", "亜鉛", "mg"),
    ("CU", "cu", "銅", "mg"),
    ("MN", "mn", "マンガン", "mg"),
    ("ID", "iodine", "ヨウ素", "μg"),
    ("SE", "se", "セレン", "μg"),
    ("CR", "cr", "クロム", "μg"),
    ("MO", "mo", "モリブデン", "μg"),
    ("RETOL", "retol", "レチノール", "μg"),
    ("CARTA", "carta", "α-カロテン", "μg"),
    ("CARTB", "cartb", "β-カロテン", "μg"),
    ("CRYPXB", "crypxb", "β-クリプトキサンチン", "μg"),
    ("CARTBEQ", "cartbeq", "β-カロテン当量", "μg"),
    ("VITA_RAE", "vita_rae", "レチノール活性当量", "μg"),
    ("VITD", "vitd", "ビタミンD", "μg"),
    ("TOCPHA", "tocpha", "α-トコフェロール", "mg"),
    ("TOCPHB", "tocphb", "β-トコフェロール", "mg"),
    ("TOCPHG", "tocphg", "γ-トコフェロール", "mg"),
    ("TOCPHD", "tocphd", "δ-トコフェロール", "mg"),
    ("VITK", "vitk", "ビタミンK", "μg"),
    ("THIA", "thia", "ビタミンB1", "mg"),
    ("RIBF", "ribf", "ビタミンB2", "mg"),
    ("NIA", "nia", "ナイアシン", "mg"),
    ("NE", "ne", "ナイアシン当量", "mg"),
    ("VITB6A", "vitb6a", "ビタミンB6", "mg"),
    ("VITB12", "vitb12", "ビタミンB12", "μg"),
    ("FOL", "fol", "葉酸", "μg"),
    ("PANTAC", "pantac", "パントテン酸", "mg"),
    ("BIOT", "biot", "ビオチン", "μg"),
    ("VITC", "vitc", "ビタミンC", "mg"),
    ("ALC", "alc", "アルコール", "g"),
    ("NACL_EQ", "nacl_eq", "食塩相当量", "g"),
]

GROUPS = {
    "01": "穀類", "02": "いも及びでん粉類", "03": "砂糖及び甘味類", "04": "豆類",
    "05": "種実類", "06": "野菜類", "07": "果実類", "08": "きのこ類", "09": "藻類",
    "10": "魚介類", "11": "肉類", "12": "卵類", "13": "乳類", "14": "油脂類",
    "15": "菓子類", "16": "し好飲料類", "17": "調味料及び香辛料類", "18": "調理済み流通食品類",
}


def to_num(v):
    """成分表のセル値 → float / None"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("†", "").replace("\u3000", "")
    if s in ("", "-", "－", "*"):
        return None
    s = s.strip("()（）")
    if s.lower() == "tr":
        return 0.0
    if re.fullmatch(r"-?[0-9]+(\.[0-9]+)?([eE]-?[0-9]+)?", s):
        return float(s)
    raise ValueError("想定外の値: %r" % (v,))


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def fmt(x):
    if x is None:
        return "NULL"
    return repr(round(x, 6)).rstrip("0").rstrip(".") if "." in repr(x) else repr(x)


def main():
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    rows = list(wb["表全体"].iter_rows(values_only=True))

    # 成分識別子の行を探して、列位置を決める
    ident_row = next(r for r in rows[:20] if r[3] == "成分識別子")
    col_of = {}
    for i, v in enumerate(ident_row):
        if v:
            col_of[str(v).strip()] = i
    missing = [code for code, *_ in NUTRIENTS if code not in col_of]
    if missing:
        raise SystemExit("Excelに見つからない成分識別子: %s" % missing)
    note_col = max(col_of.values()) + 1

    start = rows.index(ident_row) + 1
    foods = []
    for r in rows[start:]:
        if not r[1]:
            continue
        food_no = str(r[1]).strip()
        foods.append({
            "food_no": food_no,
            "group": food_no[:2],
            "index_no": str(r[2]).strip() if r[2] else None,
            "name": str(r[3]).strip(),
            "vals": [to_num(r[col_of[code]]) for code, *_ in NUTRIENTS],
            "note": (str(r[note_col]).strip() if len(r) > note_col and r[note_col] else None),
        })
    assert len({f["food_no"] for f in foods}) == len(foods), "食品番号が重複しています"
    print("食品数:", len(foods))

    cols = ",\n".join("  %-10s REAL" % n[1] for n in NUTRIENTS)
    ddl = f"""-- 日本食品標準成分表(八訂)増補2023年 のデータ。可食部100gあたり。
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
{cols},
  note       TEXT                -- 備考
);
CREATE INDEX IF NOT EXISTS idx_foods_group ON foods(group_code);

-- 列名・日本語名・単位の対応表(画面表示や将来の拡張用)
CREATE TABLE IF NOT EXISTS nutrient_defs (
  code      TEXT PRIMARY KEY,    -- 成分識別子(例: PROT-)
  column    TEXT NOT NULL,       -- foods テーブルの列名
  label     TEXT NOT NULL,
  unit      TEXT NOT NULL,
  sort_no   INTEGER NOT NULL
);
"""
    # nutrient_defs の "column" は予約語に近いので引用符つきで作り直す
    ddl = ddl.replace("  column    TEXT NOT NULL,       -- foods", '  "column"  TEXT NOT NULL,       -- foods')
    with open("db/migration-003-foods.sql", "w", encoding="utf-8") as f:
        f.write(ddl)

    col_names = ["food_no", "group_code", "index_no", "name"] + [n[1] for n in NUTRIENTS] + ["note"]
    with open("db/seed-foods.sql", "w", encoding="utf-8") as f:
        f.write("-- 成分表データの投入(scripts/build_foods_sql.py が生成)。何度流しても同じ結果になります。\n")
        for code, name in GROUPS.items():
            f.write("INSERT OR REPLACE INTO food_groups (group_code, group_name) VALUES (%s, %s);\n" % (q(code), q(name)))
        for i, (code, col, label, unit) in enumerate(NUTRIENTS, 1):
            f.write('INSERT OR REPLACE INTO nutrient_defs (code, "column", label, unit, sort_no) VALUES (%s, %s, %s, %s, %d);\n'
                    % (q(code), q(col), q(label), q(unit), i))
        for fd in foods:
            vals = [q(fd["food_no"]), q(fd["group"]), q(fd["index_no"]) if fd["index_no"] else "NULL", q(fd["name"])]
            vals += [fmt(v) for v in fd["vals"]]
            vals.append(q(fd["note"]) if fd["note"] else "NULL")
            f.write("INSERT OR REPLACE INTO foods (%s) VALUES (%s);\n" % (", ".join(col_names), ", ".join(vals)))


if __name__ == "__main__":
    main()
