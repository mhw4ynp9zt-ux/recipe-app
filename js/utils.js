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

  // ==== 画面表示用の共通ヘルパー(見た目だけ。計算や保存の処理には関係しません) ====

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  // 「豚肉 80g」→ 材料名と分量に分ける(分量の末尾のカッコ書きは、小さく控えめに見せるために別にする)
  function splitIngredient(text){
    const s = String(text).trim();
    const m = s.match(/^(\S+?)[\s\u3000]+([\s\S]+)$/);
    if(!m) return { name: s, amount: '', note: '' };
    const rest = m[2].trim();
    const n = rest.match(/^(.+?)\s*([(（][^)）]*[)）])$/);
    return n ? { name: m[1], amount: n[1], note: n[2] } : { name: m[1], amount: rest, note: '' };
  }

  // 材料リスト → 「材料名 ……… 分量」の並び(罫線なし)
  function renderIngredientsHtml(list){
    return '<ul>' + list.map(x => {
      const p = splitIngredient(withPieceCount(String(x)));
      const amt = p.amount
        ? '<span class="amt">' + escapeHtml(p.amount) + (p.note ? '<small>' + escapeHtml(p.note) + '</small>' : '') + '</span>'
        : '';
      return '<li><span class="ing">' + escapeHtml(p.name) + '</span>' + amt + '</li>';
    }).join('') + '</ul>';
  }

  // 作り方 → 番号は CSS(01, 02 …)で付ける
  function renderStepsHtml(list){
    return '<ol>' + list.map(x => '<li><span>' + escapeHtml(x) + '</span></li>').join('') + '</ol>';
  }

  // 栄養の数値の並び「たんぱく質 23.9g  野菜 280g …」。offIds に入っている指標は目標から外れた印を付ける
  function renderNutrientRow(values, metrics, offIds){
    return '<div class="nutri">' + metrics.filter(m => values[m.id] != null).map(m =>
      '<span class="n' + (offIds && offIds.has(m.id) ? ' off' : '') + '">' +
        '<span class="n-label">' + escapeHtml(m.label) + '</span>' +
        '<span class="n-value">' + values[m.id] + '<small>' + m.unit + '</small></span>' +
      '</span>'
    ).join('') + '</div>';
  }
