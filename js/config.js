// ==== 栄養目標の設定値 ====

// 1日の摂取目標(ヘッダーのバッジ表示に使用)
const DAILY = { protein: 104, veg: 800 };

// 「作る」タブで選べる栄養指標の一覧(トグルで有効/無効を切り替え、有効なものだけ目標入力欄が出る)
// id: create-ai.js内部やAIへのプロンプト・保存データのキー名としても使用
// default: そのトグルをONにしたときに入力欄へ最初に入れておく値(ユーザーが自由に変更可能)
// enabledByDefault: 初回アクセス時にONにしておくかどうか(2回目以降は前回の選択をこの端末に保存して復元)
const NUTRIENT_METRICS = [
  { id: 'protein',  label: 'たんぱく質',  unit: 'g',    default: 78,  enabledByDefault: true  },
  { id: 'veg',      label: '野菜',        unit: 'g',    default: 600, enabledByDefault: true  },
  { id: 'fat',      label: '脂質',        unit: 'g',    default: 20,  enabledByDefault: true  },
  { id: 'salt',     label: '塩分',        unit: 'g',    default: 3,   enabledByDefault: false },
  { id: 'fiber',    label: '食物繊維',    unit: 'g',    default: 7,   enabledByDefault: false },
  { id: 'carbs',    label: '糖質',        unit: 'g',    default: 60,  enabledByDefault: false },
  { id: 'calories', label: 'カロリー',    unit: 'kcal', default: 600, enabledByDefault: false },
];

// 外部AI(Grok)のモデルがまだ選択されていない場合のフォールバック
const DEFAULT_GROK_MODEL = 'grok-4.5';
