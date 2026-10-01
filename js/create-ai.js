// ==== レシピ作成機能(食材+雰囲気キーワード+選択した栄養指標の目標値・品数からAIがレシピを考える) ====
// config.js の NUTRIENT_METRICS、utils.js の computeEffort/withPieceCount、
// save.js の isSaved/toggleSave/recipes配列、auth.js の isLoggedIn/checkSession、
// error-log.js の logError/logWarn(管理者向けエラーログ)に依存します。
// 栄養量はAIの目分量ではなく、サーバーが日本食品標準成分表(D1)から計算した値を表示します(内訳は各品の「栄養の計算内訳」)。
// AIの呼び出しはサーバー(/api/ai/create-recipe)が行います。ブラウザには食材・雰囲気・品数・栄養目標だけを送り、
// APIキー・モデル・プロンプトはサーバー側(管理者が設定)で扱うため、この画面には一切現れません。
// AIが使えるのはログイン中のユーザーだけで、アプリ全体の1日の利用回数に上限があります。

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  const createResultEl = document.getElementById('create-result');
  const createLoadingEl = document.getElementById('create-loading');
  // 待機中の文言を入れる要素(無い古い画面では create-loading 自体に入れる)
  const createLoadingTextEl = document.getElementById('create-loading-text') || createLoadingEl;
  const createLoadingSubEl = document.getElementById('create-loading-sub');
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
  const CREATE_LOADING_TEXT = 'レシピを考えています…(画面を開いたままお待ちください)';

  // 待っている間の経過秒数表示(長い待ち時間でも「動いている」ことが分かるように)
  let loadingActive = false;
  let loadingStartedAt = 0;
  function tickLoading(){
    if(!loadingActive || !createLoadingSubEl) return;
    const sec = Math.floor((Date.now() - loadingStartedAt) / 1000);
    createLoadingSubEl.textContent = 'AIによる作成と、成分表での栄養計算を行っています(経過 ' + sec + ' 秒)';
    setTimeout(tickLoading, 1000);
  }

  function setCreateLoading(isLoading){
    if(isLoading) createLoadingTextEl.textContent = CREATE_LOADING_TEXT;
    createLoadingEl.hidden = !isLoading;
    generateBtn.disabled = isLoading;
    generateBtn.textContent = isLoading ? '作成中…' : 'レシピを作成する';
    const wasActive = loadingActive;
    loadingActive = isLoading;
    if(isLoading && !wasActive){
      loadingStartedAt = Date.now();
      tickLoading();
      if(typeof createLoadingEl.scrollIntoView === 'function') createLoadingEl.scrollIntoView({behavior:'smooth', block:'center'});
    } else if(!isLoading && createLoadingSubEl){
      createLoadingSubEl.textContent = '';
    }
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

  // 入力中の目標値・品数に応じてヒント文言(作成ボタンの上の要約)を更新する
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

  // 入力欄の値を指標ごとに覚えておき、指標のON/OFFで描画し直しても入力した値が消えないようにする
  const typedTargets = {};

  // 選択中の指標に応じて、数値目標の入力欄(target-row)を描画し直す
  function renderTargetInputs(){
    const active = getActiveMetrics();
    targetRowEl.innerHTML = active.map(m => `
      <div class="target-item m-${m.id}">
        <label class="option-label" for="create-target-${m.id}">${m.label}</label>
        <div class="target-input">
          <input type="number" id="create-target-${m.id}" inputmode="numeric" min="0" value="${typedTargets[m.id] != null ? typedTargets[m.id] : m.default}">
          <span class="target-unit">${m.unit}</span>
        </div>
      </div>
    `).join('');
    active.forEach(m => {
      const input = document.getElementById('create-target-' + m.id);
      input.addEventListener('input', () => {
        typedTargets[m.id] = input.value;
        updateCreateHint();
      });
    });
    updateCreateHint();
  }

  // トグルチップ自体を描画し直す(ON/OFFの見た目を反映)
  function renderMetricToggles(){
    metricToggleRowEl.innerHTML = NUTRIENT_METRICS.map(m =>
      `<button type="button" class="metric-toggle-btn m-${m.id}${enabledMetrics[m.id] ? ' active' : ''}" data-metric="${m.id}" aria-pressed="${enabledMetrics[m.id] ? 'true' : 'false'}">${m.label}</button>`
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

  // 全品の合計が目標の許容範囲(サーバーの recipe-prompt.js の TOLERANCE。現在±10%)に収まったかの表示
  // (サーバーが計算・必要ならAIに作り直させた結果)。作り直して収まった場合は、控えめに「自動調整した」ことだけ添える。
  function renderTargetCheck(tc){
    if(!tc || !Array.isArray(tc.results)) return '';
    if(tc.ok){
      const adjusted = tc.attempts > 1 ? '(目標値に合わせて自動調整しました)' : '';
      return '<p class="target-check">✓ 目標の±' + tc.tolerancePct + '%以内に収まっています' + adjusted + '</p>';
    }
    const items = tc.results.filter(r => !r.ok).map(r => {
      const m = NUTRIENT_METRICS.find(x => x.id === r.id);
      const label = m ? m.label : r.id;
      const unit = m ? m.unit : '';
      return escapeHtml(label) + ' ' + r.total + unit + '(目標' + r.target + unit + '、' + (r.diffPct > 0 ? '+' : '') + r.diffPct + '%)';
    });
    return '<p class="nutrition-warn">' + tc.attempts + '回まで作り直しましたが、目標の±' + tc.tolerancePct + '%に収まらない項目が残りました: ' +
      items.join('、') + '。食材や目標値を少し変えて、もう一度作成してみてください。</p>';
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

  function renderCreatedCombo(dishes, nutritionOk, targetCheck){
    // このバッチで実際に値が入っている指標だけをバッジ・表示対象にする(選択しなかった指標は表示しない)
    const shown = NUTRIENT_METRICS.filter(m => dishes.some(d => d[m.id] != null));
    const offIds = new Set(((targetCheck && targetCheck.results) || []).filter(r => !r.ok).map(r => r.id));
    createResultEl.hidden = false;
    createResultEl.innerHTML = `
      <div class="recipe-card">
        <p class="recipe-tag">${dishes.length > 1 ? '全' + dishes.length + '品の合計' : 'AIが作成したレシピ'}</p>
        ${shown.length ? `<div class="badges">
          ${shown.map(m => {
            const total = roundNutrient(dishes.reduce((s, d) => s + (d[m.id] || 0), 0));
            return `<span class="badge ${m.id}${offIds.has(m.id) ? ' off' : ''}"><span class="badge-label">${m.label}</span><span class="badge-val">${total}<small>${m.unit}</small></span></span>`;
          }).join('')}
        </div>` : ''}
        ${nutritionOk ? renderTargetCheck(targetCheck) : ''}
        ${dishes.map((d, i) => `
          <div class="dish-block">
            <div class="dish-head">
              <h2>${dishes.length > 1 ? '<span class="dish-num">' + (i + 1) + '</span>' : ''}${escapeHtml(d.name)}</h2>
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
        <div class="result-actions">
          <button type="button" class="btn btn-secondary regen-btn">同じ条件でもう一度作る</button>
        </div>
      </div>
    `;
    createNoteEl.textContent = nutritionOk
      ? '※栄養量は、AIが示した食材と重さをもとに、日本食品標準成分表(八訂)増補2023年から計算した値です。体調や好みに合わせて調整してください。'
      : '※栄養量を計算できませんでした(成分表のデータが準備できていない可能性があります)。管理者に連絡してください。';
    createNoteEl.hidden = false;
    createResultEl.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // サーバーが返した debug(管理者のみ)に、本当の問題があるかを判定する。
  //   ・warn / error のイベントがある、または最終的に目標の許容範囲に収まらなかった → 問題あり(警告として記録)
  //   ・info だけ(作り直しは入ったが、最終的に目標に収まった)→ 問題なし。警告もエラーログも出さない
  function debugHasProblem(debug, targetCheck){
    const events = debug && Array.isArray(debug.events) ? debug.events : [];
    if(events.some(ev => ev && ev.level !== 'info')) return true;
    return !!(targetCheck && targetCheck.ok === false);
  }

  async function generateRecipe(){
    const ingredientsRaw = document.getElementById('create-ingredients').value.trim();
    const moodRaw = document.getElementById('create-mood').value.trim();
    if(!isLoggedIn()){
      showCreateError('AIでレシピを作成するには、「設定」タブからパスキーでログインしてください。');
      return;
    }
    hideCreateError();
    setCreateLoading(true);
    createResultEl.hidden = true;
    createNoteEl.hidden = true;
    // 失敗したときに管理者向けエラーログ(error-log.js)へ残す情報。サーバーの debug は管理者にだけ返ってくる。
    const logContext = {};
    const startedAt = Date.now();
    // 待っている間に画面を離れた(ロック・アプリ切り替え)かを記録する。iOSはその間に通信を切ることがある
    let wasHidden = false;
    const onVisibility = () => { if(document.visibilityState === 'hidden') wasHidden = true; };
    document.addEventListener('visibilitychange', onVisibility);
    try {
      const target = getCreateTarget();
      const activeMetrics = getActiveMetrics();
      const targets = {};
      activeMetrics.forEach(m => { targets[m.id] = target[m.id]; });
      logContext.request = { ingredients: ingredientsRaw, mood: moodRaw, count: target.count, targets: targets };
      const requestBody = JSON.stringify({
        ingredients: ingredientsRaw,
        mood: moodRaw,
        count: target.count,
        targets: targets
      });
      // 応答が返る前に通信が切れた場合(iOS Safariでは TypeError "Load failed")だけ、1回だけ自動で再試行する。
      // サーバーが返したエラー(401/429/502など)は再試行しない。
      let response;
      for(let n = 1; n <= 2; n++){
        logContext.fetchAttempts = n;
        try {
          response = await fetch('/api/ai/create-recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody
          });
          break;
        } catch(netErr){
          if(!(netErr instanceof TypeError) || n === 2) throw netErr;
          logWarn('create-recipe', '通信が切れたため自動で再試行します', {
            request: logContext.request, message: netErr.message,
            elapsedMs: Date.now() - startedAt, wasHidden: wasHidden,
          });
          createLoadingTextEl.textContent = '通信が切れたため、もう一度試しています…';
        }
      }
      logContext.status = response.status;
      let rawText = '';
      try { rawText = await response.text(); } catch(e){ /* 本文が読めなければ空として扱う */ }
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch(e){
        logContext.responseText = rawText; // JSONではない応答(エラーページのHTMLなど)は原因調査のため本文も残す
      }
      if(!data || typeof data !== 'object') data = {};
      logContext.serverError = data.error;
      logContext.debug = data.debug;
      if(response.ok && data.debug && debugHasProblem(data.debug, data.targetCheck)){
        // 作成は成功したが、作り直しの失敗・栄養計算の失敗・最終的に目標に収まらなかった等の問題があった場合だけ警告にする。
        // 作り直しが入っても最終的に目標に収まった場合(debug が info だけ)は、警告にもエラーログにもしない。
        logWarn('create-recipe', '作成は成功しましたが、サーバーが問題を報告しました', {
          request: logContext.request, status: response.status, debug: data.debug,
        });
      }
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
      renderCreatedCombo(dishes, nutritionOk, data.targetCheck);
    } catch(err){
      logContext.elapsedMs = Date.now() - startedAt;
      logContext.wasHidden = wasHidden;
      logError('create-recipe', err, logContext);
      showCreateError(err.userMessage || 'レシピの作成に失敗しました。もう一度お試しください。');
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
      setCreateLoading(false);
    }
  }

  generateBtn.addEventListener('click', generateRecipe);

  // 結果カード内のボタン(保存・もう一度作る)はイベント委任で扱う
  createResultEl.addEventListener('click', (e) => {
    if(e.target.closest('.regen-btn')){
      if(!generateBtn.disabled) generateRecipe();
      return;
    }
    const btn = e.target.closest('.save-btn');
    if(!btn) return;
    const id = btn.dataset.id;
    toggleSave(id);
    const nowSaved = isSaved(id);
    btn.classList.toggle('saved', nowSaved);
    btn.textContent = nowSaved ? '★ 保存済み' : '☆ 保存する';
  });
