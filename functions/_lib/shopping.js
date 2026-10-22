// 買い物リストの作成。AIは呼ばない。週プランの各日の材料(ingredientDetails)を、同じ食材ごとに合計し、売り場ごとに分ける。
// 「家にあるもの」(user_pantry)に登録した食材は、リストの下の「家にあるもの」に分ける(買うものから外す)。

export const SECTIONS = [
  { id: "veg", label: "野菜・きのこ・海藻" },
  { id: "meat", label: "肉・魚・卵" },
  { id: "dairy", label: "豆腐・乳製品" },
  { id: "staple", label: "米・パン・麺・乾物" },
  { id: "season", label: "調味料・油" },
  { id: "other", label: "その他" },
];
const RULES = [
  ["season", /(しょうゆ|醤油|みそ|味噌|砂糖|塩|食塩|こしょう|胡椒|酢|みりん|酒|油|ごま油|オリーブ|マヨネーズ|ケチャップ|ソース|だし|コンソメ|鶏がら|片栗粉|小麦粉|バター|カレー粉|ルウ|豆板醤|コチュジャン|ポン酢|めんつゆ|はちみつ|わさび|からし|しょうが|生姜|にんにく|ガーリック)/],
  ["dairy", /(豆腐|とうふ|油揚げ|厚揚げ|納豆|牛乳|チーズ|ヨーグルト|生クリーム|豆乳)/],
  ["meat", /(肉|豚|牛|鶏|とり|ひき|ささみ|ベーコン|ハム|ソーセージ|鮭|さけ|サケ|さば|鯖|ぶり|たら|あじ|いわし|えび|海老|いか|たこ|貝|あさり|しじみ|ツナ|魚|卵|たまご|玉子|ちくわ|かまぼこ)/],
  ["staple", /(米|ご飯|ごはん|パン|麺|うどん|そば|パスタ|スパゲ|マカロニ|もち|餅|春雨|乾燥|のり|海苔|わかめ|ひじき|昆布|切り干し|豆|大豆|オートミール)/],
  ["veg", /(菜|ねぎ|葱|キャベツ|白菜|レタス|ほうれん|小松|にら|もやし|きゅうり|トマト|なす|茄子|ピーマン|パプリカ|かぼちゃ|大根|かぶ|にんじん|人参|玉ねぎ|たまねぎ|ごぼう|れんこん|ブロッコリー|カリフラワー|アスパラ|オクラ|きのこ|しいたけ|しめじ|えのき|まいたけ|エリンギ|なめこ|じゃがいも|さつまいも|里芋|いも|セロリ|ズッキーニ|コーン|とうもろこし|えだまめ|枝豆|さやいんげん|いんげん|しそ|みょうが|ゴーヤ|アボカド|レモン|りんご|バナナ)/],
];
export function sectionOf(name) {
  const n = String(name || "");
  for (const [id, re] of RULES) if (re.test(n)) return id;
  return "other";
}
export const normName = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();

const MAX_PANTRY = 60;
export function parsePantry(input) {
  const raw = Array.isArray(input) ? input : null;
  if (!raw) return { error: "リクエストが不正です" };
  const items = [];
  for (const x of raw) {
    if (typeof x !== "string") return { error: "食材の指定が不正です" };
    const name = x.normalize("NFKC").trim().slice(0, 30);
    if (!name) continue;
    if (!items.some((i) => normName(i) === normName(name))) items.push(name);
  }
  if (items.length > MAX_PANTRY) return { error: `登録できるのは${MAX_PANTRY}件までです` };
  return { value: items };
}

// days: 週プランの days / pantry: 家にあるもの(名前の配列) / checked: チェック済みのキー
export function buildShopping(days, pantry = [], checked = []) {
  const map = new Map();
  for (const d of days || []) {
    if (d.kind !== "cook" || !d.recipe) continue;
    for (const ing of d.recipe.ingredientDetails || []) {
      if (!ing || !ing.name) continue;
      const key = normName(ing.name);
      const cur = map.get(key) || { key, name: ing.name, grams: 0, hasGrams: false, uses: [] };
      if (ing.grams > 0) { cur.grams += ing.grams; cur.hasGrams = true; }
      else if (!cur.hasGrams && ing.amount) cur.note = ing.amount;
      if (!cur.uses.includes(d.date)) cur.uses.push(d.date);
      map.set(key, cur);
    }
  }
  const pantryKeys = pantry.map(normName);
  const checkedSet = new Set(checked);
  const sections = SECTIONS.map((s) => ({ ...s, items: [] }));
  const have = [];
  for (const it of [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"))) {
    const item = { key: it.key, name: it.name, amount: it.hasGrams ? `${Math.round(it.grams / 5) * 5 || Math.round(it.grams)}g` : (it.note || ""), uses: it.uses, checked: checkedSet.has(it.key) };
    if (pantryKeys.some((p) => p && (it.key.includes(p) || p.includes(it.key)))) have.push(item);
    else sections.find((s) => s.id === sectionOf(it.name)).items.push(item);
  }
  return { sections: sections.filter((s) => s.items.length), have };
}
