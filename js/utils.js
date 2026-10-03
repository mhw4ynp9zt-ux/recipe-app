// ==== 共通ユーティリティ関数 ====

  // 野菜のグラム表記に「目安の個数」を併記するための対応表(1個・1本・1玉あたりの標準的なg数)
  const VEG_UNITS = {
    'にんじん':{unit:'本',g:150}, 'パプリカ':{unit:'個',g:150}, '白菜':{unit:'玉',g:2000},
    'キャベツ':{unit:'玉',g:1200}, 'トマト':{unit:'個',g:150}, '玉ねぎ':{unit:'個',g:200},
    'ブロッコリー':{unit:'株',g:250}, '長ねぎ':{unit:'本',g:100}, 'ミニトマト':{unit:'個',g:15},
    'しめじ':{unit:'パック',g:100}, 'きゅうり':{unit:'本',g:100}, 'レタス':{unit:'玉',g:350},
    'ピーマン':{unit:'個',g:35}, '小松菜':{unit:'束',g:200}, 'えのき':{unit:'袋',g:100},
    'ほうれん草':{unit:'束',g:200}, '大根':{unit:'本',g:1000}, 'ズッキーニ':{unit:'本',g:200},
    'ごぼう':{unit:'本',g:150}, '水菜':{unit:'束',g:200}, 'なす':{unit:'本',g:80},
    'しいたけ':{unit:'個',g:20}, 'アスパラガス':{unit:'本',g:20}, '里芋':{unit:'個',g:50},
    'いんげん':{unit:'本',g:8}, 'もやし':{unit:'袋',g:200},
    'セロリ':{unit:'本',g:100}, 'たけのこ':{unit:'個',g:150}, 'チンゲン菜':{unit:'株',g:100},
    'オクラ':{unit:'本',g:10}, 'エリンギ':{unit:'本',g:50}, '貝割れ大根':{unit:'パック',g:50},
    'アボカド':{unit:'個',g:200}, 'にんにく':{unit:'片',g:10}, 'カリフラワー':{unit:'株',g:400},
    'れんこん':{unit:'節',g:200}, 'さつまいも':{unit:'本',g:250}, 'にら':{unit:'束',g:100},
    'マッシュルーム':{unit:'個',g:12}, 'じゃがいも':{unit:'個',g:150}, '豆苗':{unit:'パック',g:100},
  };
  // 分数・小数の候補の中から、実際の個数に一番近いものを選んで「約○○」の形にする
  function formatCount(count){
    if(count <= 0.05 || count > 6) return null;
    const candidates = [
      [1/8,'1/8'], [1/6,'1/6'], [1/5,'1/5'], [1/4,'1/4'], [1/3,'1/3'],
      [1/2,'1/2'], [2/3,'2/3'], [3/4,'3/4'], [1,'1'], [1.5,'1.5'],
      [2,'2'], [2.5,'2.5'], [3,'3'], [4,'4'], [5,'5'], [6,'6'],
    ];
    let best = candidates[0], bestDiff = Math.abs(count - candidates[0][0]);
    for(const c of candidates){
      const diff = Math.abs(count - c[0]);
      if(diff < bestDiff){ best = c; bestDiff = diff; }
    }
    return '約' + best[1];
  }
  // 「にんじん 50g」のような1品だけの材料表記に、対応表があれば個数の目安を付け加える
  function withPieceCount(str){
    const m = str.match(/^([^、]+?)\s+([0-9]+(?:\.[0-9]+)?)g$/);
    if(!m) return str;
    const baseName = m[1].replace(/\([^)]*\)/g, '').trim();
    const grams = parseFloat(m[2]);
    const unitInfo = VEG_UNITS[baseName];
    if(!unitInfo) return str;
    const label = formatCount(grams / unitInfo.g);
    if(!label) return str;
    return `${str}(${label}${unitInfo.unit})`;
  }

  // 材料数・工程数から手間度を大まかに判定する(low/mid/high)
  function computeEffort(ingredients, steps){
    const score = ingredients.length + steps.length;
    if(score <= 8) return 'low';
    if(score <= 12) return 'mid';
    return 'high';
  }

  // ==== 「作る」タブの手間度の指定(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり。品ごとに選ぶ。通信はしない) ====
  // 上の computeEffort(材料数+手順数の low/mid/high。レシピの effort 項目)とは別のもので、
  // こちらは作成時に選ぶ指定と、AIが判定して返す effortLevel(0〜3。レシピの effortLevel 項目)に使う。
  // 注意: 0(超ラク)は「指定なし(null)」とは別の値。0 を偽(falsy)として扱わないこと。
  // config.js の EFFORT_OPTIONS と、サーバー側 functions/_lib/recipe-prompt.js の EFFORT_LEVELS は同じ内容に保つ。
  const EFFORT_KEY = 'recipeRouletteEffortV1';
  // 手順数の上限(ラク=3、ふつう=6)。AIの自己申告に頼らず、コード側で数えて判定するために使う。
  // 超ラク(0)は手順数の上限なし(包丁を使うかどうかはAIの判定=effortLevel だけで見る)、しっかり(3)は上限なし
  const EFFORT_STEP_LIMIT = { 1: 3, 2: 6 };

  // 手間度として使える値か(0・1・2・3の数値型のみ)
  function validEffortLevel(v){
    return v === 0 || v === 1 || v === 2 || v === 3;
  }

  // 指定した手間度(selected)より手間がかかっている品の番号(0始まり)。
  //   ・selected は、品ごとの指定の配列(i番目が i品目の指定。null=指定なし)か、全品共通の数値
  //   ・AIが返した effortLevel が指定より大きい、または手順の数が上限を超えている品が対象
  //   ・指定なし・「しっかり」(3)・不正な指定の品は、常に対象外(しっかりは「手間をかけてよい」という指定で、上限ではない)
  function effortOverIndexes(dishes, selected){
    const out = [];
    if(!Array.isArray(dishes)) return out;
    dishes.forEach((d, i) => {
      if(!d) return;
      const sel = Array.isArray(selected) ? selected[i] : selected;
      if(sel !== 0 && sel !== 1 && sel !== 2) return;
      const levelOver = validEffortLevel(d.effortLevel) && d.effortLevel > sel;
      const limit = EFFORT_STEP_LIMIT[sel];
      const stepsOver = limit !== undefined && Array.isArray(d.steps) && d.steps.length > limit;
      if(levelOver || stepsOver) out.push(i);
    });
    return out;
  }

  // 品ごとの記憶先のキー。1品目は従来のキーのまま、2品目以降は -2 / -3 を付ける
  function effortKeyFor(idx){
    return idx > 0 ? EFFORT_KEY + '-' + (idx + 1) : EFFORT_KEY;
  }

  // 覚えておいた手間度(idx: 0始まりの品の番号)。"0"〜"3" の文字列だけ復元し、それ以外・読めないときは null(指定なし)
  function readEffortLevel(storage, idx){
    try {
      const raw = storage.getItem(effortKeyFor(idx || 0));
      if(raw === null || raw === undefined || raw === '') return null;
      const n = Number(raw);
      return validEffortLevel(n) && raw === String(n) ? n : null;
    } catch(e){
      return null;
    }
  }

  // 手間度を覚える。level が null(指定なし)なら覚えた値を消す。保存できなくても何もしない
  function writeEffortLevel(storage, level, idx){
    try {
      const key = effortKeyFor(idx || 0);
      if(level === null || level === undefined) storage.removeItem(key);
      else storage.setItem(key, String(level));
    } catch(e){ /* 保存できない環境では、次回の復元だけできない */ }
  }

