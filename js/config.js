// ==== 栄養目標の設定値 ====

// 1日の摂取目標(ヘッダーのバッジ表示に使用)
const DAILY = { protein: 104, veg: 800 };

// 「作る」タブで選べる栄養指標の一覧(トグルで有効/無効を切り替え、有効なものだけ目標入力欄が出る)
// id: create-ai.js内部やAIへのプロンプト・保存データのキー名としても使用
// default: そのトグルをONにしたときに入力欄へ最初に入れておく値(ユーザーが自由に変更可能)
// enabledByDefault: 初回アクセス時にONにしておくかどうか(2回目以降は前回の選択をこの端末に保存して復元)
// decimals: 表示する小数点以下の桁数(塩分・食物繊維は0.1g単位)
const NUTRIENT_METRICS = [
  { id: 'protein',  label: 'たんぱく質',  unit: 'g',    default: 78,  enabledByDefault: true, decimals: 0 },
  { id: 'veg',      label: '野菜',        unit: 'g',    default: 600, enabledByDefault: true, decimals: 0 },
  { id: 'fat',      label: '脂質',        unit: 'g',    default: 20,  enabledByDefault: true, decimals: 0 },
  { id: 'salt',     label: '塩分',        unit: 'g',    default: 3,   enabledByDefault: false, decimals: 1 },
  { id: 'fiber',    label: '食物繊維',    unit: 'g',    default: 7,   enabledByDefault: false, decimals: 1 },
  { id: 'carbs',    label: '糖質',        unit: 'g',    default: 60,  enabledByDefault: false, decimals: 0 },
  { id: 'calories', label: 'カロリー',    unit: 'kcal', default: 600, enabledByDefault: false, decimals: 0 },
];

// ※外部AI(Grok)のモデル・APIキーは管理者がサーバー側に設定します(functions/_lib/app-settings.js の DEFAULT_AI_MODEL が初期値)。
// ※サーバー側 functions/_lib/recipe-prompt.js の METRICS は、上の NUTRIENT_METRICS(id・label・unit)と同じ内容に保ってください(decimals も含む)。
