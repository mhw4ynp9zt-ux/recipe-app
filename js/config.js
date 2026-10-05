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

// ※外部AI(Grok)のモデル・APIキーは管理者がサーバー側に設定します(functions/_lib/app-settings.js の DEFAULT_AI_MODEL が初期値)。
// ※サーバー側 functions/_lib/recipe-prompt.js の METRICS は、上の NUTRIENT_METRICS(id・label・unit)と同じ内容に保ってください。

// レシピの分類の選択肢。functions/_lib/taxonomy.js と同じ内容に保つ(test/genre-taxonomy_test.mjs が一致を確認する)。
const GENRES = ['和食', '洋食', '中華', 'イタリアン', '韓国', 'エスニック'];
const ROLES = ['主菜', '副菜', '汁物', '主食'];
const MAINS = ['肉', '魚介', '卵', '大豆', '野菜', '穀類', 'その他'];

// レシピ作成の所要時間の選択肢(分。全品を同時進行で作り終える上限)。functions/_lib/recipe-prompt.js の MAX_MINUTES_OPTIONS と同じ内容に保つ(test/time-limit_test.mjs が一致を確認する)。
// ※「作る」タブの画面には出していません(手間度に置き換え)。サーバー側は maxMinutes を受け付けるので、画面に戻すときはここを使います。
const TIME_LIMIT_OPTIONS = [10, 30, 45, 60];

// レシピ作成の手間度の選択肢(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり)。品ごとに選ぶ。functions/_lib/recipe-prompt.js の EFFORT_LEVELS と同じ内容に保つ(test/effort-limit_test.mjs が一致を確認する)。
// short: 選んだときに画面に出す説明。基準の詳細はサーバー側のプロンプトにある(超ラク=包丁・まな板なし、ラク=手順3つ以内・器具1つ・切る食材2種類まで など)
const EFFORT_OPTIONS = [
  { level: 0, label: '超ラク',   short: '包丁・まな板なし・洗い物少なめ' },
  { level: 1, label: 'ラク',     short: '手順3つ以内・加熱の器具は1つ・洗い物少なめ' },
  { level: 2, label: 'ふつう',   short: '手順5つ前後・器具は2つまで' },
  { level: 3, label: 'しっかり', short: '手間をかけた本格的な料理' },
];

// 調理家電の登録(設定タブ「使っている調理家電」)。functions/_lib/appliances.js の APPLIANCE_OPS / APPLIANCE_POLICIES と
// id・label・順番まで同じ内容に保つ(test/appliances_test.mjs が一致を確認する)。
const APPLIANCE_OPS = [
  { id: 'stir_fry',  label: '炒める' },
  { id: 'sear',      label: '焼く' },
  { id: 'simmer',    label: '煮る・茹でる' },
  { id: 'steam',     label: '蒸す' },
  { id: 'deep_fry',  label: '揚げる' },
  { id: 'blend',     label: '粉砕・攪拌' },
  { id: 'auto_stir', label: '自動で混ぜる' },
  { id: 'hold',      label: '保温・低温調理' },
];
const APPLIANCE_POLICIES = [
  { id: 'optional', label: '使えるときだけ使う' },
  { id: 'prefer',   label: 'できるだけ使う' },
  { id: 'always',   label: 'この家電で作れる料理は必ずこれで作る' },
];

// 取扱説明書から取り込む仕様(spec)の上限。functions/_lib/appliances.js の APPLIANCE_SPEC_LIMITS と同じ内容に保つ。
const APPLIANCE_SPEC_LIMITS = { capacity: 20, modes: 6, modeName: 16, modeDesc: 30, ranges: 60, cautions: 3, caution: 60 };

// 「ひな形から追加」の初期値。あくまで目安(画面にもそう表示し、ユーザーが確認・修正する)。
// 方針: メーカー公式の情報で確認できた操作だけをチェックし、確認できないものはチェックしない(=AIには「できない」と伝わる)。
// 出典・確認状況は claude/APPLIANCES.md に記録。
const APPLIANCE_PRESETS = [
  { key: 'recolte-pot', name: 'レコルト自動調理ポット', can: ['simmer', 'blend', 'auto_stir'], policy: 'optional',
    note: 'モードはポタージュと粗挽きの2つのみ。食材を切って入れ、モードを選ぶだけ' },
  { key: 'pressure-cooker', name: '電気圧力鍋', can: ['simmer', 'steam', 'hold'], policy: 'optional',
    note: '圧力調理・無水調理・低温調理・煮込み・蒸しが得意。炒め・焼きは機種によるため未選択(必要なら追加)' },
  { key: 'hotcook', name: 'ホットクック(電気調理鍋)', can: ['stir_fry', 'simmer', 'steam', 'auto_stir', 'hold'], policy: 'optional',
    note: '材料を入れてメニューを選ぶ自動調理。無水調理・低温調理もできる。焼く・揚げるは未選択' },
  { key: 'air-fryer', name: 'エアフライヤー', can: ['sear', 'deep_fry'], policy: 'optional',
    note: '熱風で油をほぼ使わずに揚げ物風・焼き物を作る。炒める・煮る・蒸すはできない' },
  { key: 'oven-range', name: 'オーブンレンジ', can: ['sear'], policy: 'optional',
    note: 'あたため・解凍・オーブン/グリルで焼く。蒸す・揚げるはスチーム機能付きの機種のみ(必要なら追加)' },
  { key: 'rice-cooker', name: '炊飯器', can: ['simmer', 'hold'], policy: 'optional',
    note: '主に炊飯と保温。炒める・焼く・揚げるはできない' },
];
