// ==== 組み合わせ選択ロジック(夜レシピ・昼レシピの目標値に合わせた選出) ====
// config.js の各TARGET、filters.js の getWantedIngredients 等、text-match.js の nameMatches/matchLevel、
// recipes-data.js/recipes-generator.js の recipes 配列に依存します。

  // 直近に提案した組み合わせの状態(再抽選・一致メモ・表示ラベルの管理用)
  let lastIds = [];
  let lastMode = null; // 'night' | 'day'
  let lastMatchNote = null;
  let lastOverallLabel = '';

  // 残り予算(たんぱく質・野菜とも)を超えない候補だけの中から選ぶ。
  // 複数品残っている場合はスロット数で按分した量に近いものを、最後の1品は残り量にできるだけ近い(=使い切る)ものを選ぶ。
  // 予算内に収まる候補が1つも無い場合だけ、やむを得ずはみ出しが最小のものを選ぶ。
  function pickDishForSlot(pool, remainingProtein, remainingVeg, target, slotsLeft, keywords, goalSlotsLeft, fallbackPool){
    const basePool = pool.length ? pool : (fallbackPool || recipes);
    const gsl = goalSlotsLeft || slotsLeft;
    // 残りスロットの分だけ、最低限の余地(副菜1品分の目安)を確保してから今回の候補を絞る
    const MIN_P = 2, MIN_V = 80;
    const ceilP = slotsLeft > 1 ? Math.max(0, remainingProtein - (slotsLeft - 1) * MIN_P) : remainingProtein;
    const ceilV = slotsLeft > 1 ? Math.max(0, remainingVeg - (slotsLeft - 1) * MIN_V) : remainingVeg;
    const fits = basePool.filter(r => r.protein <= ceilP + 0.5 && r.veg <= ceilV + 0.5);
    const useFits = fits.length > 0;
    const candidates = useFits ? fits : basePool;

    const goalP = gsl > 1 ? remainingProtein / gsl : remainingProtein;
    const goalV = gsl > 1 ? remainingVeg / gsl : remainingVeg;

    const scored = candidates.map(r => {
      let score;
      if(useFits){
        score = target.wp * Math.abs(r.protein - goalP) / Math.max(target.protein, 1)
              + target.wv * Math.abs(r.veg - goalV) / Math.max(target.veg, 1);
      } else {
        // 収まる候補が無い場合は、はみ出し量が最小のものを選ぶ
        score = target.wp * Math.max(0, r.protein - remainingProtein) / Math.max(target.protein, 1)
              + target.wv * Math.max(0, r.veg - remainingVeg) / Math.max(target.veg, 1);
      }
      const kwBonus = keywords.length ? scoreMatch(r, keywords) * 0.15 : 0;
      return { r, score: score - kwBonus };
    });
    scored.sort((a, b) => a.score - b.score);
    const bestScore = scored[0].score;
    const nearBest = scored.filter(s => s.score <= bestScore + 0.1);
    return nearBest[Math.floor(Math.random() * nearBest.length)].r;
  }

  // count品を選ぶ。typeFilterがあれば1品はその種類から選び、残りで目標値の過不足を(超えない範囲で)埋める。
  // effortFilterで手間度を絞り込み、ガスコンロを使う料理(stove:true)は組み合わせ全体で1品までに制限する。
  // スープ(スープメーカー使用、1回に野菜+肉合わせて300gまで)は単品構成では量が足りず目標を満たせないため、
  // 品数が1品のときは候補から除外し、2〜3品構成の中の1品としてのみ選ばれるようにする。
  function pickCombo(target, count, typeFilter, keywords, excludeIds, effortFilter, excludeWords){
    const dishes = [];
    let remainingProtein = target.proteinMax || target.protein;
    let remainingVeg = target.veg;
    let slotsLeft = count;
    const usedIds = new Set(); // このコンボ内で既に使った料理(重複防止用)
    const rerollExclude = new Set();
    (excludeIds || []).forEach(id => {
      const r = recipes.find(x => x.id === id);
      if(!r || r.category !== 'side') rerollExclude.add(id);
    });
    let stoveUsed = false;

    const baseRecipes = excludeFilteredRecipes(excludeWords)
      .filter(r => r.category !== 'created')
      .filter(r => !(count === 1 && r.type === 'スープ'));
    const effortPool = effortFilter ? baseRecipes.filter(r => r.effort === effortFilter) : baseRecipes;

    // avoidReroll=trueのときだけ、前回と同じ組み合わせを避ける除外(reroll用)もかける。
    // 料理タイプで絞り込んだ1品目は候補が少ないことがあるため、直前除外はかけない。
    function poolExcluding(base, avoidReroll){
      let filtered = base.filter(r => !usedIds.has(r.id));
      if(avoidReroll){
        const withoutReroll = filtered.filter(r => !rerollExclude.has(r.id));
        if(withoutReroll.length) filtered = withoutReroll;
      }
      if(stoveUsed){
        const noStove = filtered.filter(r => !r.stove);
        if(noStove.length) filtered = noStove;
      }
      return filtered.length ? filtered : base;
    }

    function takeSlot(basePool, avoidReroll, goalSlotsLeft){
      const pool = poolExcluding(basePool, avoidReroll);
      const d = pickDishForSlot(pool, remainingProtein, remainingVeg, target, slotsLeft, keywords, goalSlotsLeft, baseRecipes);
      dishes.push(d); usedIds.add(d.id);
      if(d.stove) stoveUsed = true;
      remainingProtein -= d.protein; remainingVeg -= d.veg; slotsLeft--;
    }

    if(typeFilter){
      const typedPool = effortPool.filter(r => r.type === typeFilter);
      takeSlot(typedPool.length ? typedPool : effortPool, false);
    }

    while(slotsLeft > 0){
      takeSlot(effortPool, true);
    }
    return dishes;
  }

  function finalizeCombo(dishes, keywords){
    lastIds = dishes.map(d => d.id);
    if(!keywords.length){
      lastMatchNote = null;
    } else {
      const matched = keywords.filter(k => dishes.some(d => nameMatches(k, d.name) || matchLevel(k, d.ingredients) > 0));
      lastMatchNote = matched.length ? ('入力したキーワードのうち「' + matched.join('・') + '」に一致するレシピです。') : 'NO_MATCH';
    }
    return dishes;
  }

  function pickNight(){
    const keywords = getWantedIngredients();
    const excludeWords = getExcludeWords();
    const count = getSelectedCount();
    const type = getSelectedType();
    const effort = getSelectedEffort();
    // たんぱく質70〜85g・野菜600g以内を守った上で、野菜量ができるだけ600gに近づく組み合わせを探す。
    // (違反があれば違反の解消を最優先し、違反が無い候補どうしでは野菜の不足分が少ない方を選ぶ)
    function scoreCombo(dishes){
      const p = dishes.reduce((s, d) => s + d.protein, 0);
      const v = dishes.reduce((s, d) => s + d.veg, 0);
      const violation = (Math.max(0, p - 85) + Math.max(0, 70 - p) + Math.max(0, v - 600)) * 50;
      const vegGap = Math.max(0, 600 - v);
      return violation + vegGap;
    }
    let best = pickCombo(NIGHT_TARGET, count, type, keywords, lastIds, effort, excludeWords);
    let bestScore = scoreCombo(best);
    for(let i = 0; i < 39; i++){
      const candidate = pickCombo(NIGHT_TARGET, count, type, keywords, lastIds, effort, excludeWords);
      const score = scoreCombo(candidate);
      if(score < bestScore){ best = candidate; bestScore = score; }
    }
    lastOverallLabel = '夜レシピ' + (count > 1 ? '(' + count + '品)' : '');
    return finalizeCombo(best, keywords);
  }

  // typeで絞ったときに、その種類の料理がtargetの上限内に収まる候補を持っているかどうか
  function typeFitsTarget(type, target, baseRecipes){
    const source = baseRecipes || recipes;
    const pool = type ? source.filter(r => r.type === type) : source;
    return pool.some(r => r.protein <= target.protein + 0.5 && r.veg <= target.veg + 0.5);
  }

  function pickDay(){
    const keywords = getWantedIngredients();
    const excludeWords = getExcludeWords();
    const count = getSelectedCount();
    const type = getSelectedType();
    const effort = getSelectedEffort();
    const baseRecipes = excludeFilteredRecipes(excludeWords).filter(r => r.category !== 'created');
    let focusProtein;
    if(type){
      const okProtein = typeFitsTarget(type, DAY_PROTEIN_TARGET, baseRecipes);
      const okVeg = typeFitsTarget(type, DAY_VEG_TARGET, baseRecipes);
      if(okProtein && !okVeg) focusProtein = true;
      else if(okVeg && !okProtein) focusProtein = false;
      else focusProtein = Math.random() < 0.5;
    } else {
      focusProtein = Math.random() < 0.5;
    }
    const base = focusProtein ? DAY_PROTEIN_TARGET : DAY_VEG_TARGET;
    // 品数が増えるほど、実物の主菜+副菜を組み合わせるための余地を広げる(上限は夜の基準を超えない)
    const target = {
      protein: Math.min(85, base.protein + (count - 1) * 15),
      veg: Math.min(600, base.veg + (count - 1) * 130),
      wp: base.wp, wv: base.wv
    };
    function overBy(dishes){
      const p = dishes.reduce((s, d) => s + d.protein, 0);
      const v = dishes.reduce((s, d) => s + d.veg, 0);
      return Math.max(0, p - target.protein) + Math.max(0, v - target.veg);
    }
    let dishes = pickCombo(target, count, type, keywords, lastIds, effort, excludeWords);
    let best = dishes, bestOver = overBy(dishes);
    let attempts = 0;
    while(bestOver > 0.5 && attempts < 40){
      dishes = pickCombo(target, count, type, keywords, lastIds, effort, excludeWords);
      const over = overBy(dishes);
      if(over < bestOver){ best = dishes; bestOver = over; }
      attempts++;
    }
    if(overBy(dishes) > 0.5) dishes = best;
    lastOverallLabel = '昼レシピ・' + (focusProtein ? 'たんぱく質多め' : '野菜多め') + (count > 1 ? '(' + count + '品)' : '');
    return finalizeCombo(dishes, keywords);
  }

