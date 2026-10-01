// ==== レシピ作成機能(食材+雰囲気キーワード+選択した栄養指標の目標値・品数からAIがレシピを考える) ====
// config.js の NUTRIENT_METRICS、utils.js の computeEffort/withPieceCount、
// save.js の isSaved/toggleSave/recipes配列、auth.js の isLoggedIn/checkSession に依存します。
// 栄養量はAIの目分量ではなく、サーバーが日本食品標準成分表(D1)から計算した値を表示します(内訳は各品の「栄養の計算内訳」)。
// AIの呼び出しはサーバー(/api/ai/create-recipe)が行います。ブラウザには食材・雰囲気・品数・栄養目標だけを送り、
// APIキー・モデル・プロンプトはサーバー側(管理者が設定)で扱うため、この画面には一切現れません。
// AIが使えるのはログイン中のユーザーだけで、アプリ全体の1日の利用回数に上限があります。

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  const createResultEl = document.getElementById('create-result');
  const createLoadingEl = document.getElementById('create-loading');
  const createErrorEl = document.getElementById('create-error');
  const createNoteEl = document.getElementById('create-note');
  const generateBtn = document.getElementById('btn-generate');
  const createHintEl = document.getElementById('create-target-hint');
  const metricToggleRowEl = document.getElementById('metric-toggle-row');
  const targetRowEl = document.getElementById('target-row');

  function showCreateError(msg){
    createErrorEl.textContent = msg;
    createErrorEl.hidden = false;
  }
  function hideCreateError(){
    createErrorEl.hidden = true;
  }
  function setCreateLoading(isLoading){
    createLoadingEl.hidden = !isLoading;
    generateBtn.disabled = isLoading;
    generateBtn.style.opacity = isLoading ? '0.6' : '1';
    generateBtn.textContent = isLoading ? '作成中…' : 'レシピを作成する';
  }

  function getCreateCount(){
    const active = document.querySelector('.create-count-btn.active');
    return active ? parseInt(active.dataset.count, 10) : 1;
  }

  // ==== 栄養指標のトグル選択(どの指標を今回の目安にするか、端末に保存して次回も復元) ====
  const TARGET_METRICS_KEY = 'recipeRouletteTargetMetricsV1';

  function loadEnabledMetrics(){
    let saved = null;
    try {
      const raw = localStorage.getItem(TARGET_METRICS_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch(e){ /* 復元できない環境では初期値を使う */ }
    const result = {};
    NUTRIENT_METRICS.forEach(m => {
      result[m.id] = (saved && typeof saved[m.id] === 'boolean') ? saved[m.id] : m.enabledByDefault;
    });
    return result;
  }
  function saveEnabledMetrics(){
    try { localStorage.setItem(TARGET_METRICS_KEY, JSON.stringify(enabledMetrics)); } catch(e){ /* 保存できない環境では無視 */ }
  }

  let enabledMetrics = loadEnabledMetrics();

  function getActiveMetrics(){
    return NUTRIENT_METRICS.filter(m => enabledMetrics[m.id]);
  }

  // 目標入力欄が空欄・0以下・数値以外の場合はconfig.jsの初期値にフォールバックする
  function getTargetValue(el, fallback){
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  function getCreateTarget(){
    const target = { count: getCreateCount() };
    getActiveMetrics().forEach(m => {
      const el = document.getElementById('create-target-' + m.id);
      target[m.id] = el ? getTargetValue(el, m.default) : m.default;
    });
    return target;
  }

  // 入力中の目標値・品数に応じてヒント文言を更新する
  function updateCreateHint(){
    const t = getCreateTarget();
    const active = getActiveMetrics();
    if(!active.length){
      createHintEl.textContent = '全' + t.count + '品の合計で、栄養バランスの良いレシピを考えます。';
      return;
    }
    const parts = active.map(m => m.label + t[m.id] + m.unit);
    createHintEl.textContent = '全' + t.count + '品の合計で、' + parts.join('・') + 'を目安にレシピを考えます。';
  }

  // 選択中の指標に応じて、数値目標の入力欄(target-row)を描画し直す
  function renderTargetInputs(){
    const active = getActiveMetrics();
    targetRowEl.innerHTML = active.map(m => `
      <div class="option-group">
        <label class="option-label" for="create-target-${m.id}">${m.label}(${m.unit})</label>
        <input type="number" id="create-target-${m.id}" inputmode="numeric" min="0" value="${m.default}">
      </div>
    `).join('');
    active.forEach(m => {
      document.getElementById('create-target-' + m.id).addEventListener('input', updateCreateHint);
    });
    updateCreateHint();
  }

  // トグルチップ自体を描画し直す(ON/OFFの見た目を反映)
  function renderMetricToggles(){
    metricToggleRowEl.innerHTML = NUTRIENT_METRICS.map(m =>
      `<button type="button" class="metric-toggle-btn${enabledMetrics[m.id] ? ' active' : ''}" data-metric="${m.id}">${m.label}</button>`
    ).join('');
  }

  metricToggleRowEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.metric-toggle-btn');
    if(!btn) return;
    const id = btn.dataset.metric;
    // 目安にする指標を1つも選ばない状態は避ける(AIへの目標指示が空になってしまうため)
    if(enabledMetrics[id] && getActiveMetrics().length <= 1) return;
    enabledMetrics[id] = !enabledMetrics[id];
    saveEnabledMetrics();
    renderMetricToggles();
    renderTargetInputs();
  });

  renderMetricToggles();
  renderTargetInputs();

  document.querySelectorAll('.create-count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.create-count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCreateHint();
    });
  });

  // 栄養値は小数1桁まで(足し算の誤差で 12.299999 のような表示にならないように)
  function roundNutrient(v){
    return Math.round(v * 10) / 10;
  }

  // 成分表と照合できなかった食材・値がなかった食材があれば、栄養量の下に知らせる
  function renderNutritionWarn(d){
    const c = d.nutritionCheck;
    if(!c) return '';
    const names = list => '「' + list.map(escapeHtml).join('」「') + '」';
    const parts = [];
    if(c.unmatched && c.unmatched.length){
      parts.push(names(c.unmatched) + 'は成分表と照合できなかった(または重さが不明だった)ため、栄養量に含まれていません。');
    }
    if(c.missing && c.missing.length){
      parts.push(names(c.missing) + 'は成分表に値のない項目があり、その分は0として計算しています。');
    }
    return parts.length ? '<p class="nutrition-warn">' + parts.join('') + '</p>' : '';
  }

  // 栄養の計算内訳: どの食材を、成分表のどの食品として計算したか
  function renderNutritionDetail(d){
    if(!d.nutrition || !Array.isArray(d.ingredientDetails)) return '';
    const rows = d.ingredientDetails.map(ing => {
      const left = escapeHtml(ing.name) + (ing.grams > 0 ? ' ' + ing.grams + 'g' : '');
      let right;
      if(ing.match) right = escapeHtml(ing.match.label);
      else if(ing.grams === 0) right = '<span class="nd-skip">計算に含めていません</span>';
      else if(ing.grams == null) right = '<span class="nd-miss">重さが不明のため計算に含まれていません</span>';
      else right = '<span class="nd-miss">成分表に該当なし(計算に含まれていません)</span>';
      return `<li><span class="nd-name">${left}</span><span class="nd-arrow">→</span><span class="nd-food">${right}</span></li>`;
    }).join('');
    const all = NUTRIENT_METRICS.filter(m => d.nutrition[m.id] != null)
      .map(m => m.label + ' ' + d.nutrition[m.id] + m.unit).join(' ・ ');
    return `
      <details class="nutrition-detail">
        <summary>栄養の計算内訳</summary>
        <p class="nd-total">${all}</p>
        <ul>${rows}</ul>
        <p class="nd-note">日本食品標準成分表(八訂)増補2023年の「可食部100gあたり」の値から計算。調理による水分・油の増減は考慮していません。</p>
      </details>`;
  }

  function renderCreatedCombo(dishes, nutritionOk){
    // このバッチで実際に値が入っている指標だけをバッジ・表示対象にする(選択しなかった指標は表示しない)
    const shown = NUTRIENT_METRICS.filter(m => dishes.some(d => d[m.id] != null));
    createResultEl.hidden = false;
    createResultEl.innerHTML = `
      <div class="recipe-card">
        <p class="recipe-tag">入力した内容からAIが作成</p>
        <div class="badges">
          ${shown.map(m => {
            const total = roundNutrient(dishes.reduce((s, d) => s + (d[m.id] || 0), 0));
            return `<span class="badge ${m.id}">${m.label}(合計) ${total}${m.unit}</span>`;
          }).join('')}
        </div>
        ${dishes.map((d, i) => `
          <div class="dish-block">
            <div class="dish-head">
              <h2>${dishes.length > 1 ? (i + 1) + '. ' : ''}${escapeHtml(d.name)}</h2>
              <span class="dish-type-tag">${escapeHtml(d.type)}</span>
            </div>
            <p class="dish-macro">${shown.filter(m => d[m.id] != null).map(m => m.label + ' ' + d[m.id] + m.unit).join(' ・ ')}</p>
            ${renderNutritionWarn(d)}
            <button class="save-btn${isSaved(d.id) ? ' saved' : ''}" data-id="${d.id}">${isSaved(d.id) ? '★ 保存済み' : '☆ 保存する'}</button>
            <div class="ingredients">
              <h3>材料</h3>
              <ul>${d.ingredients.map(x => '<li>' + withPieceCount(escapeHtml(x)) + '</li>').join('')}</ul>
            </div>
            <div class="steps">
              <h3>作り方</h3>
              <ol>${d.steps.map(x => '<li>' + escapeHtml(x) + '</li>').join('')}</ol>
            </div>
            ${renderNutritionDetail(d)}
          </div>
        `).join('')}
      </div>
    `;
    createNoteEl.textContent = nutritionOk
      ? '※栄養量は、AIが示した食材と重さをもとに、日本食品標準成分表(八訂)増補2023年から計算した値です。体調や好みに合わせて調整してください。'
      : '※栄養量を計算できませんでした(成分表のデータが準備できていない可能性があります)。管理者に連絡してください。';
    createNoteEl.hidden = false;
    createResultEl.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  async function generateRecipe(){
    const ingredientsRaw = document.getElementById('create-ingredients').value.trim();
    const moodRaw = document.getElementById('create-mood').value.trim();
    if(!ingredientsRaw){
      showCreateError('食材を1つ以上入力してください。');
      return;
    }
    if(!isLoggedIn()){
      showCreateError('AIでレシピを作成するには、「設定」タブからパスキーでログインしてください。');
      return;
    }
    hideCreateError();
    setCreateLoading(true);
    createResultEl.hidden = true;
    createNoteEl.hidden = true;
    try {
      const target = getCreateTarget();
      const activeMetrics = getActiveMetrics();
      const targets = {};
      activeMetrics.forEach(m => { targets[m.id] = target[m.id]; });
      const response = await fetch('/api/ai/create-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: ingredientsRaw,
          mood: moodRaw,
          count: target.count,
          targets: targets
        })
      });
      const data = await response.json().catch(() => ({}));
      if(!response.ok){
        // ログインの期限切れなら状態を更新し、サーバーが返した日本語メッセージ(上限到達など)をそのまま表示する
        if(response.status === 401) checkSession();
        const apiErr = new Error('API request failed: ' + response.status);
        apiErr.userMessage = data.error;
        throw apiErr;
      }
      const items = Array.isArray(data.dishes) ? data.dishes : null;
      if(!items || !items.length){
        throw new Error('Unexpected response shape');
      }
      const nutritionOk = data.nutritionOk !== false;
      const batchId = Date.now();
      const dishes = items.map((parsedItem, idx) => {
        if(!parsedItem.name || !Array.isArray(parsedItem.ingredients) || !Array.isArray(parsedItem.steps)){
          throw new Error('Unexpected item shape');
        }
        const recipe = {
          id: 'created-' + batchId + '-' + (idx + 1),
          category: 'created',
          type: parsedItem.type || 'その他',
          stove: parsedItem.type === 'スープ' ? false : true,
          effort: computeEffort(parsedItem.ingredients, parsedItem.steps),
          name: parsedItem.name,
          ingredients: parsedItem.ingredients,
          steps: parsedItem.steps
        };
        // サーバーが成分表から計算した値を記録する。
        //   選択していた指標は従来どおり recipe[指標ID] に(保存済みレシピの表示でも使う)
        //   全指標・照合の内訳は nutrition / ingredientDetails / nutritionCheck に
        if(nutritionOk){
          activeMetrics.forEach(m => {
            if(parsedItem[m.id] != null){
              recipe[m.id] = roundNutrient(Number(parsedItem[m.id]) || 0);
            }
          });
          recipe.nutrition = parsedItem.nutrition;
          recipe.nutritionCheck = parsedItem.nutritionCheck;
          recipe.ingredientDetails = parsedItem.ingredientDetails;
        }
        recipes.push(recipe);
        return recipe;
      });
      renderCreatedCombo(dishes, nutritionOk);
    } catch(err){
      showCreateError(err.userMessage || 'レシピの作成に失敗しました。もう一度お試しください。');
    } finally {
      setCreateLoading(false);
    }
  }

  generateBtn.addEventListener('click', generateRecipe);

  // 保存ボタン(作成タブの結果カード内、イベント委任)
  createResultEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.save-btn');
    if(!btn) return;
    const id = btn.dataset.id;
    toggleSave(id);
    const nowSaved = isSaved(id);
    btn.classList.toggle('saved', nowSaved);
    btn.textContent = nowSaved ? '★ 保存済み' : '☆ 保存する';
  });
