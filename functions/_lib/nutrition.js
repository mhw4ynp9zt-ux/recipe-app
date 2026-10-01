// 食材 → 日本食品標準成分表(D1の foods テーブル)の照合と、栄養量の計算(すべてサーバー側)。
//
// 流れ:
//   1. AIが返した食材ごとの {name, amount, grams, food} を受け取る
//      food は成分表の食品名に合わせた表記(例: "ぶた ロース 脂身つき 生")
//   2. foods の食品名一覧(約2,500件)をメモリに読み込み、food → 一般名の変換表 → name の順に照合する
//   3. 一致した食品の「可食部100gあたり」の値 × grams / 100 を合計する
//
// 前提: grams は「皮・骨・種などを除いた可食部(正味)の重さ」。調理による水分・油の増減は考慮せず、
//       生の食材の値で計算する(炒め油などは別の食材として grams に入れてもらう)。

const CACHE_TTL_MS = 10 * 60 * 1000;
let indexCache = null; // { at, foods: [{ foodNo, group, name, label, tokens, weak, trailingNote }] }

// foods から読む列(計算に使うものだけ)
const NUTRIENT_COLUMNS = "enerc_kcal, prot, protcaa, fat, fatnlea, choavl, choavldf, chocdf, fib, nacl_eq";
const VEG_GROUPS = ["06"]; // 「野菜」のgに数える食品群(06=野菜類。きのこ・藻類・いも類は含めない)

// アプリの指標ID(config.js の NUTRIENT_METRICS と同じ)ごとの取り方。
// 先に挙げた列が NULL(未測定)なら次の列を使う。
const METRICS = {
  calories: { digits: 0, get: (r) => pick(r, ["enerc_kcal"]) },
  protein: { digits: 1, get: (r) => pick(r, ["prot", "protcaa"]) },
  fat: { digits: 1, get: (r) => pick(r, ["fat", "fatnlea"]) },
  salt: { digits: 1, get: (r) => pick(r, ["nacl_eq"]) },
  fiber: { digits: 1, get: (r) => pick(r, ["fib"]) },
  // 糖質 = 利用可能炭水化物(質量計) → 差引き法 → 炭水化物 − 食物繊維 の順に探す
  carbs: {
    digits: 1,
    get: (r) => {
      const v = pick(r, ["choavl", "choavldf"]);
      if (v != null) return v;
      return r.chocdf != null ? Math.max(0, r.chocdf - (r.fib || 0)) : null;
    },
  },
  veg: { digits: 0, get: () => null }, // 食品群で数えるので下で別扱い
};
const METRIC_IDS = Object.keys(METRICS);

function pick(row, cols) {
  for (const c of cols) if (row[c] != null) return row[c];
  return null;
}

// ==== 文字の正規化 ====

// 全角/半角をそろえ、カタカナをひらがなにして比較する(成分表は「たまねぎ」「ブロッコリー」など表記が混在しているため)
function norm(s) {
  return String(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function splitTokens(s) {
  return s.split(/[\s、,・]+/).filter(Boolean);
}

// 成分表の食品名 → 照合用の語(トークン)と、画面に出す表示名
//   "＜畜肉類＞　ぶた　［大型種肉］　ロース　脂身つき　生"
//     → 語: ぶた / ロース / 脂身つき / 生 / 大型種肉(weak) ・ 表示名: "ぶた [大型種肉] ロース 脂身つき 生"
//   先頭の（まぐろ類）のような分類名は、照合には使う(weak)が表示名には出さない。
const LEADING_TAG = /^\s*(?:<[^>]*>|\(([^)]*)\))\s*/;

function parseFoodName(name) {
  const weak = new Set();
  let n = norm(name);
  let label = String(name).normalize("NFKC");
  for (let prev = null; prev !== n; ) {
    prev = n;
    n = n.replace(LEADING_TAG, (_, cat) => {
      if (cat) splitTokens(cat).forEach((t) => weak.add(t));
      return " ";
    });
  }
  // 表示名: ＜…＞は落とす。（…類）は、残りの名前にその名前が含まれていれば落とす(「（にんじん類） にんじん …」)。
  // 含まれていなければ残す(「（まぐろ類） 缶詰 水煮 …」は、まぐろの名前がここにしか出てこないため)。
  const kept = [];
  for (let m = label.match(LEADING_TAG); m; m = label.match(LEADING_TAG)) {
    label = label.slice(m[0].length);
    if (m[1] && !label.includes(m[1].replace(/類$/, ""))) kept.push(m[1]);
  }
  label = [...kept, label].join(" ").replace(/\s+/g, " ").trim();

  const trailingNote = /\([^)]*\)\s*$/.test(n); // 末尾の（凝固剤:…）などの注記つき
  n = n.replace(/\([^)]*\)/g, " ");
  n = n.replace(/\[([^\]]*)\]/g, (_, inner) => {
    splitTokens(inner).forEach((t) => weak.add(t));
    return " " + inner + " ";
  });
  const tokens = splitTokens(n);
  // 分類名(weak)は照合のために語として加えておく
  weak.forEach((t) => { if (!tokens.includes(t)) tokens.push(t); });
  return { tokens, weak, trailingNote, label };
}

// ==== 一般的な食材名 → 成分表の表記(AIが成分表の表記で返さなかったときの保険) ====
// 先に書いたものが優先。R('…') はカタカナ/ひらがなを区別せず、全角半角も気にせず書ける。
const R = (src) => new RegExp(norm(src));
const CANON = [
  // --- 卵・乳・大豆 ---
  [R("卵白"), "鶏卵 卵白 生"],
  [R("卵黄"), "鶏卵 卵黄 生"],
  [R("卵|たまご|玉子|エッグ"), "鶏卵 全卵 生"],
  [R("牛乳|ミルク"), "普通牛乳"],
  [R("ヨーグルト"), "ヨーグルト 全脂無糖"],
  [R("クリームチーズ"), "ナチュラルチーズ クリーム"],
  [R("パルメザン|粉チーズ"), "ナチュラルチーズ パルメザン"],
  [R("モッツァレラ|モッツァレラ|モツァレラ"), "ナチュラルチーズ モッツァレラ"],
  [R("カッテージ"), "ナチュラルチーズ カテージ"],
  [R("カマンベール"), "ナチュラルチーズ カマンベール"],
  [R("チーズ"), "プロセスチーズ"],
  [R("生クリーム"), "クリーム 液状 乳脂肪"],
  [R("バター"), "有塩バター"],
  [R("絹"), "絹ごし豆腐"],
  [R("豆腐"), "木綿豆腐"],
  [R("納豆"), "糸引き納豆"],
  [R("厚揚げ|生揚げ"), "生揚げ"],
  [R("油揚げ|あぶらあげ"), "油揚げ 生"],
  [R("豆乳"), "豆乳"],
  // --- 他の語を含みやすい加工品・調味料(「牛乳」の牛、「コンソメ」のチキンなど。肉・魚より先に判定) ---
  [R("薄口|うすくち"), "うすくちしょうゆ"],
  [R("米酢"), "米酢"],
  [R("赤みそ|赤味噌"), "米みそ 赤色辛みそ"],
  [R("ケチャップ"), "トマトケチャップ"],
  [R("マヨ"), "マヨネーズ 全卵型"],
  [R("とんかつソース|中濃ソース"), "中濃ソース"],
  [R("ウスターソース"), "ウスターソース"],
  [R("オイスターソース"), "オイスターソース"],
  [R("コンソメ|ブイヨン"), "固形ブイヨン"],
  [R("鶏がら|鶏ガラ|中華だし|中華スープ|ウェイパー"), "顆粒中華だし"],
  [R("昆布だし"), "こんぶだし 水出し"],
  [R("だし|出汁|ダシ"), "かつおだし 荒節"],
  [R("めんつゆ"), "めんつゆ 三倍濃縮"],
  [R("ぽん酢|ポン酢"), "ぽん酢しょうゆ"],
  [R("ごま油|胡麻油"), "ごま油"],
  [R("オリーブ(オイル|油)"), "オリーブ油"],
  [R("サラダ油|植物油|菜種油|なたね油"), "調合油"],
  [R("練りごま|ねりごま"), "ごま ねり"],
  [R("カレー粉"), "カレー粉"],
  [R("カレールウ|カレールー"), "カレールウ"],
  // --- 肉 ---
  [R("(合|あい)(い)?(び|挽)き"), "ぶた ひき肉 生"],
  [R("(豚|ぶた|ポーク).*(ひき|挽き|ミンチ)"), "ぶた ひき肉 生"],
  [R("(鶏|とり|にわとり|チキン).*(ひき|挽き|ミンチ)"), "にわとり ひき肉 生"],
  [R("(牛|ビーフ).*(ひき|挽き|ミンチ)"), "うし ひき肉 生"],
  [R("(豚|ぶた|ポーク).*(ばら|バラ)"), "ぶた 大型種肉 ばら 脂身つき 生"],
  [R("(豚|ぶた|ポーク).*(肩ロース|かたロース)"), "ぶた 大型種肉 かたロース 脂身つき 生"],
  [R("(豚|ぶた|ポーク).*(ロース)"), "ぶた 大型種肉 ロース 脂身つき 生"],
  [R("(豚|ぶた|ポーク).*(ヒレ)"), "ぶた 大型種肉 ヒレ 赤肉 生"],
  [R("(豚|ぶた|ポーク)"), "ぶた 大型種肉 もも 脂身つき 生"],
  [R("(鶏|とり|にわとり|チキン).*(むね|胸)"), "にわとり 若どり むね 皮つき 生"],
  [R("(鶏|とり|にわとり|チキン).*(もも|モモ)"), "にわとり 若どり もも 皮つき 生"],
  [R("ささみ|ササミ|ささ身"), "にわとり 若どり ささみ 生"],
  [R("手羽先|手羽さき"), "にわとり 若どり 手羽さき 皮つき 生"],
  [R("手羽元|手羽もと"), "にわとり 若どり 手羽もと 皮つき 生"],
  [R("(鶏|とり|にわとり|チキン)"), "にわとり 若どり もも 皮つき 生"],
  [R("(牛|ビーフ).*(ばら|バラ|カルビ)"), "うし 乳用肥育牛肉 ばら 脂身つき 生"],
  [R("(牛|ビーフ).*(ロース)"), "うし 乳用肥育牛肉 ロース 脂身つき 生"],
  [R("(牛|ビーフ).*(ヒレ)"), "うし 乳用肥育牛肉 ヒレ 赤肉 生"],
  [R("(牛|ビーフ)"), "うし 乳用肥育牛肉 もも 脂身つき 生"],
  [R("ベーコン"), "ぶた ベーコン類 ばらベーコン"],
  // --- 魚介 ---
  [R("鮭|サケ|さけ|サーモン"), "しろさけ 生"],
  [R("鯖|サバ|さば"), "まさば 生"],
  [R("鯵|アジ|あじ"), "まあじ 皮つき 生"],
  [R("ぶり|ブリ|鰤"), "ぶり 成魚 生"],
  [R("たら|タラ|鱈"), "まだら 生"],
  [R("いわし|イワシ|鰯"), "まいわし 生"],
  [R("さんま|サンマ|秋刀魚"), "さんま 皮つき 生"],
  [R("かつお節|鰹節|削り節"), "かつお節"],
  [R("ツナ"), "まぐろ類 缶詰 水煮 フレーク ライト"],
  [R("まぐろ|マグロ|鮪"), "くろまぐろ 赤身 生"],
  [R("えび|エビ|海老"), "バナメイえび 養殖 生"],
  [R("ほたて|ホタテ|帆立"), "ほたてがい 貝柱 生"],
  [R("あさり|アサリ"), "あさり 生"],
  [R("いか|イカ|烏賊"), "するめいか 生"],
  [R("しらす"), "しらす 微乾燥品"],
  // --- 野菜・きのこ・いも ---
  [R("玉ねぎ|玉葱|たまねぎ"), "たまねぎ りん茎 生"],
  [R("にんじん|人参|ニンジン"), "にんじん 根 皮なし 生"],
  [R("キャベツ"), "キャベツ 結球葉 生"],
  [R("白菜|はくさい"), "はくさい 結球葉 生"],
  [R("ほうれん草|ほうれんそう"), "ほうれんそう 葉 通年平均 生"],
  [R("小松菜|こまつな"), "こまつな 葉 生"],
  [R("じゃがいも|ジャガイモ|じゃが芋|馬鈴薯"), "じゃがいも 塊茎 皮なし 生"],
  [R("さつまいも|サツマイモ|さつま芋"), "さつまいも 塊根 皮なし 生"],
  [R("トマト缶|ホールトマト|カットトマト|トマト水煮"), "トマト 加工品 ホール 食塩無添加"],
  [R("トマトジュース"), "トマト 加工品 トマトジュース 食塩無添加"],
  [R("ミニトマト|プチトマト"), "赤色ミニトマト 果実 生"],
  [R("トマト"), "赤色トマト 果実 生"],
  [R("きゅうり|キュウリ|胡瓜"), "きゅうり 果実 生"],
  [R("なす|ナス|茄子"), "なす 果実 生"],
  [R("パプリカ|赤ピーマン"), "赤ピーマン 果実 生"],
  [R("黄ピーマン"), "黄ピーマン 果実 生"],
  [R("ピーマン"), "青ピーマン 果実 生"],
  [R("ブロッコリー"), "ブロッコリー 花序 生"],
  [R("カリフラワー"), "カリフラワー 花序 生"],
  [R("大根|だいこん"), "だいこん 根 皮なし 生"],
  [R("ごぼう|牛蒡"), "ごぼう 根 生"],
  [R("れんこん|蓮根"), "れんこん 根茎 生"],
  [R("小ねぎ|青ねぎ|万能ねぎ|あさつき"), "葉ねぎ 葉 生"],
  [R("長ねぎ|白ねぎ|根深ねぎ|ねぎ|ネギ"), "根深ねぎ 葉 軟白 生"],
  [R("にら|ニラ|韮"), "にら 葉 生"],
  [R("もやし|モヤシ"), "りょくとうもやし 生"],
  [R("しょうが|生姜|ショウガ"), "しょうが 根茎 皮なし 生"],
  [R("にんにく|ニンニク|大蒜"), "にんにく りん茎 生"],
  [R("かぼちゃ|カボチャ|南瓜"), "西洋かぼちゃ 果実 生"],
  [R("ズッキーニ"), "ズッキーニ 果実 生"],
  [R("アスパラ"), "アスパラガス 若茎 生"],
  [R("オクラ"), "オクラ 果実 生"],
  [R("水菜|みずな"), "みずな 葉 生"],
  [R("チンゲン"), "チンゲンサイ 葉 生"],
  [R("セロリ"), "セロリ 葉柄 生"],
  [R("レタス"), "レタス 土耕栽培 結球葉 生"],
  [R("枝豆|えだまめ"), "えだまめ 生"],
  [R("いんげん"), "いんげんまめ さやいんげん 若ざや 生"],
  [R("たけのこ|筍"), "たけのこ 若茎 生"],
  [R("大葉|しそ|シソ"), "しそ 葉 生"],
  [R("パセリ"), "パセリ 葉 生"],
  [R("とうもろこし|コーン"), "スイートコーン 未熟種子 生"],
  [R("しめじ"), "ぶなしめじ 生"],
  [R("しいたけ|椎茸"), "しいたけ 生しいたけ 菌床栽培 生"],
  [R("えのき"), "えのきたけ 生"],
  [R("まいたけ|舞茸"), "まいたけ 生"],
  [R("エリンギ"), "エリンギ 生"],
  [R("マッシュルーム"), "マッシュルーム 生"],
  [R("しらたき|糸こんにゃく"), "こんにゃく しらたき"],
  [R("こんにゃく"), "こんにゃく 板こんにゃく 精粉こんにゃく"],
  [R("わかめ"), "わかめ 乾燥わかめ 素干し 水戻し"],
  // --- 果実 ---
  [R("レモン"), "レモン 全果 生"],
  [R("りんご|リンゴ|林檎"), "りんご 皮なし 生"],
  [R("バナナ"), "バナナ 生"],
  [R("アボカド"), "アボカド 生"],
  // --- 穀類・粉・麺 ---
  [R("ごはん|ご飯|白米|米飯"), "こめ 水稲めし 精白米 うるち米"],
  [R("玄米"), "こめ 水稲めし 玄米"],
  [R("パスタ|スパゲッティ|スパゲティ|マカロニ"), "マカロニ・スパゲッティ 乾"],
  [R("うどん"), "うどん ゆで"],
  [R("そば|蕎麦"), "そば そば ゆで"],
  [R("中華麺|中華めん|ラーメン"), "中華めん 生"],
  [R("パン粉"), "パン粉 乾燥"],
  [R("食パン|パン"), "角形食パン 食パン"],
  [R("強力粉"), "強力粉 1等"],
  [R("薄力粉|小麦粉"), "薄力粉 1等"],
  [R("片栗粉|かたくり粉"), "じゃがいもでん粉"],
  [R("オートミール"), "オートミール"],
  // --- 調味料・油 ---
  [R("しょうゆ|醤油|しょう油"), "こいくちしょうゆ"],
  [R("^(食)?塩$|^塩(少々|適量)?$|^(あら|粗)?塩$"), "食塩"],
  [R("砂糖|さとう|グラニュー糖"), "上白糖"],
  [R("はちみつ|ハチミツ|蜂蜜"), "はちみつ"],
  [R("みりん"), "本みりん"],
  [R("^(料理)?酒$|日本酒|清酒"), "清酒 普通酒"],
  [R("ワイン"), "ぶどう酒 白"],
  [R("酢"), "穀物酢"],
  [R("みそ|味噌"), "米みそ 淡色辛みそ"],
  [R("ごま|ゴマ|胡麻"), "ごま いり"],
  [R("こしょう|胡椒|ブラックペッパー"), "こしょう 混合 粉"],
  [R("からし|マスタード"), "からし 練り"],
  [R("わさび"), "わさび 練り"],
  [R("ナンプラー|魚醤"), "魚醤油 ナンプラー"],
  [R("豆板醤|トウバンジャン"), "トウバンジャン"],
  [R("甜麺醤|テンメンジャン"), "テンメンジャン"],
  // --- 最後に判定する広い語 ---
  [R("米"), "こめ 水稲穀粒 精白米 うるち米"],
];

// 皮なし/皮つきの指定が一般名に含まれていたら、変換先に反映する
function adjustSkin(canonical, hay) {
  if (/皮なし|皮無し|皮を除|皮抜き/.test(hay)) return canonical.replace("皮つき", "皮なし");
  return canonical;
}

// 一般名 → 成分表の表記。見つからなければ null
function canonicalQuery(text) {
  const hay = norm(text);
  if (!hay.trim()) return null;
  for (const [re, canon] of CANON) {
    if (re.test(hay)) return adjustSkin(canon, hay);
  }
  return null;
}

// ==== 照合 ====

// 調理済み・加工済みを表す語。問い合わせに無い場合は「生」の食品を優先するために使う。
const COOKED_WORDS = [
  "ゆで", "焼き", "油いため", "揚げ", "水煮", "蒸し", "水さらし", "天ぷら", "フライ", "とんかつ", "素揚げ", "ソテー",
  "電子レンジ調理", "缶詰", "塩漬", "ぬか漬", "甘煮", "つくだ煮", "乾", "味付け", "水戻し", "ゆで", "炊き", "煮",
].map(norm);
// 迷ったときに選びたい品目(同点のときの小さな加点)
const PREFERRED = ["若どり", "大型種肉", "乳用肥育牛肉"].map(norm);

const MATCH_MIN_RATIO = 0.6; // 問い合わせの語のうち、これ以上が食品名に含まれていること

// 問い合わせの語 q と食品名の語 ft の近さ。3=完全一致 / 1.5=ftがqを含む / 1=qがftを含む(分類名には使わない)
function tokenScore(q, ft, isWeak) {
  if (q === ft) return 3;
  if (q.length >= 2 && ft.includes(q)) return 1.5;
  if (!isWeak && ft.length >= 2 && q.includes(ft)) return 1;
  return 0;
}

function queryTokens(text) {
  const n = norm(text).replace(/[()（）\[\]]/g, " ");
  return splitTokens(n);
}

// 1つの問い合わせ文字列で最も近い食品を探す。{ food, score } か null
function searchOnce(foods, queryText) {
  const q = queryTokens(queryText);
  if (!q.length) return null;
  const mentionsCooked = q.some((t) => COOKED_WORDS.includes(t));

  let best = null;
  for (const food of foods) {
    // 先頭の語(食品の主な名前)がどこかの語に当たらない食品は対象外
    const mainScore = Math.max(0, ...food.tokens.map((ft) => tokenScore(q[0], ft, food.weak.has(ft))));
    if (mainScore < 1.5) continue;

    let score = 0;
    let hit = 0;
    const used = new Set();
    for (const t of q) {
      let bestTok = 0;
      let bestIdx = -1;
      food.tokens.forEach((ft, i) => {
        const s = tokenScore(t, ft, food.weak.has(ft));
        if (s > bestTok) { bestTok = s; bestIdx = i; }
      });
      if (bestTok > 0) { hit++; used.add(bestIdx); score += bestTok; }
      else score -= 2;
    }
    if (hit / q.length < MATCH_MIN_RATIO) continue;

    // 問い合わせに無い語が食品名に多いほど、少し下げる(より一般的な名前を優先)
    food.tokens.forEach((ft, i) => {
      if (used.has(i)) return;
      score -= food.weak.has(ft) ? 0.1 : 0.3;
      if (!mentionsCooked && COOKED_WORDS.includes(ft)) score -= 1.5; // 調理指定が無いのに調理済みの食品は避ける
      if (PREFERRED.includes(ft)) score += 0.5;
    });
    if (!mentionsCooked && food.tokens.includes("生")) score += 1;
    if (food.trailingNote) score -= 0.3;

    // 同点なら食品番号が小さい方(成分表で先に載っている基本の食品)
    if (!best || score > best.score + 1e-9) best = { food, score };
  }
  return best;
}

// AIが返した食材 { name, food } に合う食品を探す。見つからなければ null
//   1) AIが書いた成分表風の表記(food)  2) 一般名の変換表(name→food)  3) 食材名そのもの(name)
function matchFood(foods, { name, food }) {
  const attempts = [];
  if (food) attempts.push(["food", food]);
  const canon = canonicalQuery(name) || canonicalQuery(food || "");
  if (canon) attempts.push(["canon", canon]);
  if (name) attempts.push(["name", name]);

  for (const [via, text] of attempts) {
    const hit = searchOnce(foods, text);
    if (hit) return { food: hit.food, score: hit.score, via };
  }
  return null;
}

// ==== D1からの読み込み ====

async function loadFoodIndex(env) {
  const now = Date.now();
  if (indexCache && now - indexCache.at < CACHE_TTL_MS) return indexCache.foods;

  const { results } = await env.DB.prepare(
    "SELECT food_no, group_code, name FROM foods ORDER BY food_no"
  ).all();
  if (!results || !results.length) throw new Error("foods table is empty");

  const foods = results.map((r) => ({
    foodNo: r.food_no,
    group: r.group_code,
    name: r.name,
    ...parseFoodName(r.name),
  }));
  indexCache = { at: now, foods };
  return foods;
}

async function loadNutrientRows(env, foodNos) {
  const unique = [...new Set(foodNos)];
  const rows = {};
  // D1の1クエリあたりの変数は100個まで
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT food_no, group_code, ${NUTRIENT_COLUMNS} FROM foods WHERE food_no IN (${chunk.map(() => "?").join(",")})`
    ).bind(...chunk).all();
    results.forEach((r) => { rows[r.food_no] = r; });
  }
  return rows;
}

function round(v, digits) {
  const m = Math.pow(10, digits);
  return Math.round(v * m) / m;
}

// ==== 計算 ====

// dishes: parseDishes() の結果(各品に ingredientDetails がある)。各品に nutrition などを書き足して返す。
//   dish.nutrition       … { calories, protein, fat, salt, fiber, carbs, veg } (1品ぶんの合計)
//   dish.nutritionCheck  … { unmatched: [食材名], missing: [食材名] }  (計算に入れられなかったもの)
//   dish.ingredientDetails[i].match … { foodNo, label } | null
// activeIds に含まれる指標は dish[id] にも入れる(画面・保存済みレシピの既存の表示がそのまま使える)。
async function attachNutrition(env, dishes, activeIds) {
  const foods = await loadFoodIndex(env);

  // 照合
  const matches = dishes.map((dish) =>
    dish.ingredientDetails.map((ing) => (ing.grams > 0 ? matchFood(foods, ing) : null))
  );
  const foodNos = matches.flat().filter(Boolean).map((m) => m.food.foodNo);
  const rows = foodNos.length ? await loadNutrientRows(env, foodNos) : {};

  dishes.forEach((dish, di) => {
    const totals = {};
    METRIC_IDS.forEach((id) => { totals[id] = 0; });
    const unmatched = [];
    const missing = new Set();

    dish.ingredientDetails.forEach((ing, ii) => {
      const m = matches[di][ii];
      if (!(ing.grams > 0)) {
        // 水など(grams=0)は計算対象外。gramsが無いのに食材名がある場合だけ知らせる
        if (ing.grams == null) unmatched.push(ing.name);
        ing.match = null;
        return;
      }
      if (!m) {
        unmatched.push(ing.name);
        ing.match = null;
        return;
      }
      const row = rows[m.food.foodNo];
      ing.match = { foodNo: m.food.foodNo, label: m.food.label };

      const ratio = ing.grams / 100;
      const contrib = {}; // この食材が各栄養素にいくら寄与したか(目標から外れたとき、AIに内訳を伝えるために使う)
      METRIC_IDS.forEach((id) => {
        contrib[id] = 0;
        if (id === "veg") {
          if (VEG_GROUPS.includes(row.group_code)) { totals.veg += ing.grams; contrib.veg = ing.grams; }
          return;
        }
        const v = METRICS[id].get(row);
        if (v == null) { if (activeIds.includes(id)) missing.add(ing.name); } // 成分表に値がない(未測定)。0として扱う
        else { totals[id] += v * ratio; contrib[id] = v * ratio; }
      });
      // enumerable: false にして、画面へ返すJSONや保存済みレシピには含めない(サーバー内だけで使う)
      Object.defineProperty(ing, "contrib", { value: contrib, enumerable: false, writable: true, configurable: true });
    });

    dish.nutrition = {};
    METRIC_IDS.forEach((id) => { dish.nutrition[id] = round(totals[id], METRICS[id].digits); });
    dish.nutritionCheck = { unmatched, missing: [...missing] };
    activeIds.forEach((id) => {
      if (dish.nutrition[id] != null) dish[id] = dish.nutrition[id];
    });
  });

  return dishes;
}

export {
  attachNutrition,
  loadFoodIndex,
  matchFood,
  canonicalQuery,
  parseFoodName,
  CANON,
  METRIC_IDS,
};
