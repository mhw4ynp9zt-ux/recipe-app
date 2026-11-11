// 「今日」「週プラン」「ふりかえり」「目標の目安」で画面に出す文言を、1か所にまとめたもの。
// 方針: 「足りない」「不足」「ダメ」といった言葉を使わず、「足せる」「整える」の言い方にそろえる。
//       数字の差(◯g足りない)は、ユーザーを責める見え方になるので、文言の中に入れない。
// 文言を直したいときは、このファイルだけ直せばよい(test/kondate-tone_test.mjs が、避けたい言葉が入っていないかを確かめる)。

export const AVOID_WORDS = ["不足", "足りない", "足りません", "足りず", "未達", "失敗", "サボ", "ダメ", "だめ", "危険です", "オーバー", "超過", "守れ"];

const LABEL = { calories: "カロリー", protein: "たんぱく質", veg: "野菜", fat: "脂質", salt: "塩分", fiber: "食物繊維", carbs: "糖質", carbohydrate: "炭水化物" };
export const metricLabel = (id) => LABEL[id] || id;

// 栄養の状態ごとの短い言葉(週の振り返りの判定で使う)
export const STATUS_TEXT = {
  ok: "ちょうど良い",
  below: "まだ伸ばせます",
  above: "やや多めです",
  none: "目標なし",
};

// 週ページの「その日のバランス」(予定=プランの料理の合計 / 食べた=「食べた」と記録したものの合計)
export const DAY_HELP = "縦の線は、1日の目安の位置です。濃い色は食べた分、薄い色は予定の分です。届かない日があっても大丈夫。栄養は週や月の平均で整います。";
export const DAY_EMPTY = "この日は、まだ予定も食べた記録もありません。";
export const DAY_APPROX = "おおよその値を含みます";
export const EATEN_NONE = "まだ食べた記録がありません";

// 週の振り返り
export const REVIEW_TITLE = "今週もおつかれさまでした";
export const REVIEW_FEW = "まだ記録が少ないので、傾向はこれから見えてきます。無理のない範囲で、食べたものを足してみてください。";
export const REVIEW_AVERAGE_OK = "1週間の平均で見ると、栄養はおおむね目安の範囲に収まっていました。";
export const REVIEW_AVERAGE_MIXED = "1週間の平均で見ると、整っている栄養がいくつもありました。";
export const REVIEW_NOTE = "栄養は、習慣として少しずつ整えるものです。1日単位の多い少ないは、気にしなくて大丈夫です。";
export const RECORD_DAYS_NOTE = "記録のない日があっても、評価は変わりません。";

export const positive = {
  metricOk: (id) => `${metricLabel(id)}が、目安の範囲に収まっていました`,
  vegDays: (n) => `野菜が${n}日の食事に入っていました`,
  outing: () => "外食の日も、記録しながら過ごせました",
  recorded: (n) => `${n}日ぶんの食事を記録できました`,
};

// 来週のヒント(1つだけ出す)
export const hint = {
  fiber: "食物繊維を少し増やすと、さらに整います。きのこや豆、海藻を使うレシピを、来週の提案に多めに入れますか?",
  protein: "たんぱく質を少し増やすと、さらに整います。卵・豆腐・魚を使うレシピを、来週の提案に多めに入れますか?",
  veg: "野菜をもう1品足すと、さらに整います。野菜が多めのレシピを、来週の提案に多めに入れますか?",
  salt: "塩分がやや多めの週でした。汁物の味を少しうすめにすると、ちょうど良くなります。",
  fat: "脂質がやや多めの週でした。焼き物や蒸し物を少し増やすと、ちょうど良くなります。",
};

// 目標の目安
export const TARGET_NOTE = "平均的な体格を想定した、健康な方向けの一般的な目安です。医療行為ではありません。";
export const SPECIAL_NOTE = "妊娠中・授乳中の方、18歳未満の方、通院・治療中の方は、自動の目安を使えません。医師や管理栄養士にご相談のうえ、数値を手入力してください。";
export const PURPOSE_NOTE = "「減らす」「増やす」は、基準表にはないアプリ独自の調整です(エネルギーを±10%)。";
export const SELF_SET_NOTE = "自分で設定した値は、一般的な基準とは異なります。";
export const noticeLowEnergy = "この値は低めです。医師や管理栄養士への相談をおすすめします。";
export const noticeBmiBelow = (lo, hi) => `目標とするBMI(${lo}〜${hi})より低めです。体重の調整が目的でなければ、今の食事量を保ちましょう。心配なときは医師や管理栄養士への相談をおすすめします。`;
export const noticeBmiAbove = (lo, hi) => `目標とするBMI(${lo}〜${hi})より高めです。体重の調整が目的のときは、医師や管理栄養士への相談もおすすめです。`;
export const errorEnergyFloor = (floor) => `エネルギーの目標は${floor.toLocaleString("ja-JP")}kcal以上にしてください。これより低い設定は、医師や管理栄養士の指導のもとで行ってください。`;
export const errorLoseBelowBmi = "現在の体格では「減らす」は選べません。目標とするBMIの範囲に入っています。";
export const errorGainAboveBmi = "現在の体格では「増やす」は選べません。";

// 週プラン
export const PLAN_STAGES = { queued: "準備しています", ai: "献立を考えています", calc: "栄養を計算しています", done: "できあがりました" };
export const PLAN_OUTING = "外食の予定";
export const PLAN_OUTING_NOTE = "ほかの日で栄養を整えられます";
export const PLAN_FAIL = "うまく作れませんでした。もう一度お試しください";
export const PLAN_LIMIT = "今月の週プランの作成回数の上限に達しました。来月またお試しください";
export const PHOTO_LIMIT = "今月の写真での栄養計算の回数の上限に達しました。来月またお試しください";
export const PHOTO_FAIL = "写真から料理を読み取れませんでした。もう一度お試しいただくか、手入力で記録してください";
export const PHOTO_APPROX = "写真からの推定です。量は見た目からの目安なので、料理名と量を確認して直してください";
