// ==== 「見つける」タブの結果表示・抽選演出 ====
// config.js の DAILY、utils.js の withPieceCount、save.js の isSaved、filters.js の getExcludeWords、
// combo-picker.js の lastOverallLabel/lastMatchNote に依存します。

  const resultEl = document.getElementById('result');
  const tagEl = document.getElementById('r-tag');
  const proteinEl = document.getElementById('r-protein');
  const proteinPctEl = document.getElementById('r-protein-pct');
  const vegEl = document.getElementById('r-veg');
  const vegPctEl = document.getElementById('r-veg-pct');
  const dishListEl = document.getElementById('dish-list');
  const noteEl = document.getElementById('r-match-note');

  function render(dishes){
    tagEl.textContent = lastOverallLabel;

    if(lastMatchNote === 'NO_MATCH'){
      noteEl.textContent = '入力した食材に合うレシピが見つからなかったため、全体からランダムに選びました。';
      noteEl.hidden = false;
    } else if(lastMatchNote){
      noteEl.textContent = lastMatchNote;
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }

    const totalProtein = dishes.reduce((s, d) => s + d.protein, 0);
    const totalVeg = dishes.reduce((s, d) => s + d.veg, 0);
    proteinEl.textContent = totalProtein;
    proteinPctEl.textContent = '(1日の目標の' + Math.round(totalProtein / DAILY.protein * 100) + '%)';
    vegEl.textContent = totalVeg;
    vegPctEl.textContent = '(1日の目標の' + Math.round(totalVeg / DAILY.veg * 100) + '%)';

    dishListEl.innerHTML = dishes.map((d, i) => `
      <div class="dish-block">
        <div class="dish-head">
          <h2>${dishes.length > 1 ? (i + 1) + '. ' : ''}${d.name}</h2>
          <span class="dish-type-tag">${d.type}</span>
        </div>
        <p class="dish-macro">たんぱく質 ${d.protein}g ・ 野菜 ${d.veg}g</p>
        <button class="save-btn${isSaved(d.id) ? ' saved' : ''}" data-id="${d.id}">${isSaved(d.id) ? '★ 保存済み' : '☆ 保存する'}</button>
        <div class="ingredients">
          <h3>材料</h3>
          <ul>${d.ingredients.map(x => '<li>' + withPieceCount(x) + '</li>').join('')}</ul>
        </div>
        <div class="steps">
          <h3>作り方</h3>
          <ol>${d.steps.map(x => '<li>' + x + '</li>').join('')}</ol>
        </div>
      </div>
    `).join('');

    resultEl.hidden = false;
    resultEl.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  function nightSpinPool(){
    return excludeFilteredRecipes(getExcludeWords()).filter(r => r.category === 'night');
  }
  function daySpinPool(){
    return excludeFilteredRecipes(getExcludeWords()).filter(r => r.category !== 'night' && r.category !== 'created');
  }

  function renderExcludeEmpty(){
    resultEl.hidden = false;
    noteEl.hidden = true;
    tagEl.textContent = '該当なし';
    proteinEl.textContent = '0';
    proteinPctEl.textContent = '';
    vegEl.textContent = '0';
    vegPctEl.textContent = '';
    dishListEl.innerHTML = '<div class="dish-block"><h2>除外ワードによって該当するレシピがありませんでした</h2><p class="dish-macro">除外ワードを見直すか、空欄にしてもう一度お試しください。</p></div>';
    resultEl.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  function spinThenRender(pickFn, spinPool){
    if(!spinPool.length){
      renderExcludeEmpty();
      return;
    }
    let count = 0;
    resultEl.hidden = false;
    noteEl.hidden = true;
    const spin = setInterval(() => {
      const r = spinPool[Math.floor(Math.random() * spinPool.length)];
      tagEl.textContent = '選んでいます…';
      dishListEl.innerHTML = '<div class="dish-block"><h2>' + r.name + '</h2></div>';
      count++;
      if(count > 6){
        clearInterval(spin);
        render(pickFn());
      }
    }, 70);
  }

