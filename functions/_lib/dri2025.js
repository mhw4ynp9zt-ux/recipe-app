// 「日本人の食事摂取基準(2025年版)」(厚生労働省)の成人の基準値を、そのまま表にして持ち、
// 性別・年齢・身体活動レベルから「1日の目安」を引くだけの処理。AIは呼ばない。外部にも通信しない。
//
// 方針(健康に関わる値のため)
//   ・独自の計算式は作らず、公表されている表の値を引く。表に無い組み合わせ(例: 75歳以上の「高い」)は値を出さない。
//   ・エネルギー比率(%エネルギー)で示された目標量(たんぱく質・脂質・炭水化物)だけは、
//     「エネルギー × 比率 ÷ 1gあたりのエネルギー(たんぱく質・炭水化物 4kcal、脂質 9kcal)」でgに換算する(基準自身が使っている換算係数)。
//   ・表は test/dri2025_test.mjs が固定している。値を直すときは、公式の報告書(下の DRI_SOURCE)と見比べてから、テストも直すこと。
//
// 確認した資料(2026-10-22): 厚生労働省の策定ポイント資料(エネルギー・たんぱく質・脂質)と、2025年版の付録表
//   (食物繊維・食塩相当量・参照体位・目標とするBMIを含む)の2つ。エネルギーとたんぱく質は2資料で一致。
//   食物繊維・食塩相当量・炭水化物・BMIは付録表の1資料のみで確認しているため、公開前に公式の報告書(PDF)と目視で照合すること。

export const DRI_SOURCE = {
  title: "日本人の食事摂取基準(2025年版)",
  publisher: "厚生労働省",
  url: "https://kennet.mhlw.go.jp/information/information/dictionary/food/ye-025",
};

export const MIN_AGE = 18;
export const MAX_AGE = 120;

export const AGE_BANDS = [
  { id: "18-29", min: 18, max: 29 },
  { id: "30-49", min: 30, max: 49 },
  { id: "50-64", min: 50, max: 64 },
  { id: "65-74", min: 65, max: 74 },
  { id: "75+", min: 75, max: Infinity },
];

export const SEXES = [
  { id: "male", label: "男性" },
  { id: "female", label: "女性" },
];

// 身体活動レベル(2025年版の名称は「低い」「ふつう」「高い」)
export const ACTIVITY_LEVELS = [
  { id: "low", label: "低い" },
  { id: "normal", label: "ふつう" },
  { id: "high", label: "高い" },
];

// 推定エネルギー必要量(kcal/日)。[低い, ふつう, 高い]。null=表に値がない(75歳以上の「高い」)
const ENERGY = {
  male: { "18-29": [2250, 2600, 3000], "30-49": [2350, 2750, 3150], "50-64": [2250, 2650, 3000], "65-74": [2100, 2350, 2650], "75+": [1850, 2250, null] },
  female: { "18-29": [1700, 1950, 2250], "30-49": [1750, 2050, 2350], "50-64": [1700, 1950, 2250], "65-74": [1650, 1850, 2050], "75+": [1450, 1750, null] },
};

// たんぱく質の推奨量(g/日)
const PROTEIN_RDA = {
  male: { "18-29": 65, "30-49": 65, "50-64": 65, "65-74": 60, "75+": 60 },
  female: { "18-29": 50, "30-49": 50, "50-64": 50, "65-74": 50, "75+": 50 },
};
// たんぱく質の目標量(%エネルギー)[下限, 上限]
const PROTEIN_PCT = { "18-29": [13, 20], "30-49": [13, 20], "50-64": [14, 20], "65-74": [15, 20], "75+": [15, 20] };
// 脂質の目標量(%エネルギー)。成人は全年齢区分で同じ
const FAT_PCT = [20, 30];
// 炭水化物の目標量(%エネルギー)。成人は全年齢区分で同じ
const CARBOHYDRATE_PCT = [50, 65];
// 食物繊維の目標量(g/日・以上)
const FIBER_MIN = {
  male: { "18-29": 20, "30-49": 22, "50-64": 22, "65-74": 21, "75+": 20 },
  female: { "18-29": 18, "30-49": 18, "50-64": 18, "65-74": 18, "75+": 17 },
};
// 食塩相当量の目標量(g/日・未満)
const SALT_MAX = { male: 7.5, female: 6.5 };
// 目標とするBMI(kg/m²)。18〜49歳は同じ範囲
const BMI_RANGE = { "18-29": [18.5, 24.9], "30-49": [18.5, 24.9], "50-64": [20.0, 24.9], "65-74": [21.5, 24.9], "75+": [21.5, 24.9] };

// 1gあたりのエネルギー(kcal)。基準が%エネルギーをgに直すときに使っている係数
const KCAL_PER_G = { protein: 4, carbohydrate: 4, fat: 9 };

export const DRI_TABLES = Object.freeze({ ENERGY, PROTEIN_RDA, PROTEIN_PCT, FAT_PCT, CARBOHYDRATE_PCT, FIBER_MIN, SALT_MAX, BMI_RANGE, KCAL_PER_G });

export function ageBandOf(age) {
  if (!Number.isInteger(age) || age < MIN_AGE) return null;
  return AGE_BANDS.find((b) => age >= b.min && age <= b.max) || null;
}

// 目標とするBMIの範囲と、BMIの値・位置づけ。身長(cm)・体重(kg)が無ければ範囲だけ返す
export function bmiInfo(age, heightCm, weightKg) {
  const band = ageBandOf(age);
  if (!band) return null;
  const range = BMI_RANGE[band.id];
  const out = { range: [range[0], range[1]], bmi: null, position: null };
  if (Number.isFinite(heightCm) && Number.isFinite(weightKg) && heightCm > 0 && weightKg > 0) {
    const bmi = weightKg / Math.pow(heightCm / 100, 2);
    out.bmi = Math.round(bmi * 10) / 10;
    out.position = out.bmi < range[0] ? "below" : out.bmi > range[1] ? "above" : "in";
  }
  return out;
}

const round0 = (v) => Math.round(v);
const round1 = (v) => Math.round(v * 10) / 10;

// 性別・年齢・身体活動レベルから、1日の基準値を引く。
// energyAim(kcal)を渡すと、%エネルギーで示された目標量(たんぱく質・脂質・炭水化物)を、その摂取エネルギーを基準にgへ換算する
// (体重を減らす・増やす設定のときに、エネルギーを調整したあとの量で換算するため。渡さなければ推定エネルギー必要量で換算する)。
// 成功: { ok: true, band, requirement(推定エネルギー必要量), items: { calories, protein, fat, carbohydrate, fiber, salt } }
// 失敗: { ok: false, reason: "age" | "sex" | "activity" | "no-value" }
// items の各項目: { value(目安の値), kind("aim"=目安 / "min"=以上 / "max"=未満), lo, hi(範囲があるときだけ), unit, basis(根拠の説明) }
export function computeStandard({ sex, age, activity }, { energyAim } = {}) {
  const band = ageBandOf(age);
  if (!band) return { ok: false, reason: "age" };
  if (!ENERGY[sex]) return { ok: false, reason: "sex" };
  const level = ACTIVITY_LEVELS.findIndex((l) => l.id === activity);
  if (level < 0) return { ok: false, reason: "activity" };
  const requirement = ENERGY[sex][band.id][level];
  if (requirement == null) return { ok: false, reason: "no-value" };

  const energy = Number.isFinite(energyAim) && energyAim > 0 ? energyAim : requirement;
  const toGrams = (pct, perG) => (energy * pct) / 100 / perG;

  const [pLo, pHi] = PROTEIN_PCT[band.id];
  const proteinLo = Math.max(PROTEIN_RDA[sex][band.id], round0(toGrams(pLo, KCAL_PER_G.protein)));
  const proteinHi = Math.max(proteinLo, round0(toGrams(pHi, KCAL_PER_G.protein)));
  const [fLo, fHi] = FAT_PCT;
  const fatLo = round0(toGrams(fLo, KCAL_PER_G.fat));
  const fatHi = round0(toGrams(fHi, KCAL_PER_G.fat));
  const [cLo, cHi] = CARBOHYDRATE_PCT;
  const carbLo = round0(toGrams(cLo, KCAL_PER_G.carbohydrate));
  const carbHi = round0(toGrams(cHi, KCAL_PER_G.carbohydrate));

  return {
    ok: true,
    band: band.id,
    requirement,
    items: {
      calories: { value: round0(energy), kind: "aim", unit: "kcal", basis: "推定エネルギー必要量" },
      protein: { value: proteinLo, kind: "min", hi: proteinHi, unit: "g", basis: "推奨量と、%エネルギーの目標量(" + pLo + "〜" + pHi + "%)" },
      fat: { value: round0((fatLo + fatHi) / 2), kind: "aim", lo: fatLo, hi: fatHi, unit: "g", basis: "%エネルギーの目標量(" + fLo + "〜" + fHi + "%)" },
      carbohydrate: { value: round0((carbLo + carbHi) / 2), kind: "aim", lo: carbLo, hi: carbHi, unit: "g", basis: "%エネルギーの目標量(" + cLo + "〜" + cHi + "%)" },
      fiber: { value: FIBER_MIN[sex][band.id], kind: "min", unit: "g", basis: "目標量(以上)" },
      salt: { value: round1(SALT_MAX[sex]), kind: "max", unit: "g", basis: "目標量(未満)" },
    },
  };
}
