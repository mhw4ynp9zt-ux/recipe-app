// ==== レシピ作成機能(食材+雰囲気キーワード+選択した栄養指標の目標値・品数からAIがレシピを考える) ====
// config.js の NUTRIENT_METRICS、utils.js の computeEffort/withPieceCount、
// save.js の isSaved/toggleSave/recipes配列、auth.js の isLoggedIn/checkSession に依存します。
// AIの呼び出しはサーバー(/api/ai/create-recipe)が行い、生成中の内容はストリーミングで少しずつ届きます。ブラウザには食材・雰囲気・品数・栄養目標だけを送り、
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

  // ==== 作成中の進み具合(ぐるぐるアイコン・完了率・書き上がった料理名) ====
  // AIの返答はストリーミングで少しずつ届くので、届いた文字数から完了率を見積もります。
  // (AIが考えている間は届く文字がないため、時間に応じて進めます)
  // 待ち時間を短く感じてもらうため、経過秒数は出さず、文言を数秒ごとに「次の工程」へ切り替えます。
  const CHARS_PER_DISH = 650; // 1品あたりのおおよその返答文字数(完了率の見積もり用)
  const THINKING_MESSAGES = [
    '食材の組み合わせを選んでいます',
    '味付けを決めています',
    '栄養バランスを整えています',
    '分量を調整しています'
  ];
  const MESSAGE_INTERVAL_MS = 3000;
  const progressPercentEl = document.getElementById('create-progress-percent');
  const progressStatusEl = document.getElementById('create-progress-status');
  const progressDishesEl = document.getElementById('create-progress-dishes');

  function createProgress(count){
    const startedAt = Date.now();
    let phase = 'connect';   // connect → thinking → writing → done
    let thinkingSince = startedAt;
    let text = '';
    let shownPercent = 0;
    let lastDishKey = '';

    function estimate(){
      const now = Date.now();
      if(phase === 'done') return 100;
      if(phase === 'connect') return Math.min(8, (now - startedAt) / 150);
      if(phase === 'thinking'){
        // 序盤は速く進め、だんだんゆっくり40%に近づける
        const t = (now - thinkingSince) / 1000;
        return 8 + 32 * (1 - Math.exp(-t / 10));
      }
      return 40 + 57 * Math.min(1, text.length / (CHARS_PER_DISH * count));
    }

    function dishNames(){
      const names = [];
      const re = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while((m = re.exec(text)) !== null) names.push(m[1]);
      return names.slice(0, count);
    }

    function renderDishes(){
      const names = dishNames();
      const key = names.join('\u0000') + '|' + phase;
      if(key === lastDishKey) return names;
      lastDishKey = key;
      progressDishesEl.innerHTML = '';
      names.forEach((name, i) => {
        const li = document.createElement('li');
        const finished = phase === 'done' || i < names.length - 1;
        const mark = document.createElement('span');
        mark.className = 'progress-dish-mark';
        mark.textContent = finished ? '✓' : '…';
        const label = document.createElement('span');
        label.textContent = (count > 1 ? (i + 1) + '品目 ' : '') + name;
        li.classList.toggle('is-writing', !finished);
        li.append(mark, label);
        progressDishesEl.appendChild(li);
      });
      return names;
    }

    function statusText(pct, names){
      if(phase === 'done') return 'できあがりました';
      if(pct >= 85) return 'もうすぐできあがります';
      if(phase === 'connect') return '準備しています';
      if(phase === 'thinking'){
        const i = Math.floor((Date.now() - thinkingSince) / MESSAGE_INTERVAL_MS);
        return THINKING_MESSAGES[Math.min(i, THINKING_MESSAGES.length - 1)];
      }
      if(count > 1) return Math.max(1, names.length) + '品目の作り方をまとめています';
      return '作り方をまとめています';
    }

    function render(){
      // 見積もりが戻っても、完了率は後ろに下げない
      shownPercent = Math.max(shownPercent, estimate());
      const pct = Math.round(Math.min(phase === 'done' ? 100 : 97, shownPercent));
      progressPercentEl.textContent = pct + '%';
      progressPercentEl.setAttribute('aria-valuenow', String(pct));
      const names = renderDishes();
      const msg = statusText(pct, names);
      if(progressStatusEl.textContent !== msg) progressStatusEl.textContent = msg;
    }

    progressDishesEl.innerHTML = '';
    render();
    const intervalId = setInterval(render, 250);

    return {
      started(){ if(phase === 'connect'){ phase = 'thinking'; thinkingSince = Date.now(); } render(); },
      thinking(){ if(phase === 'connect'){ phase = 'thinking'; thinkingSince = Date.now(); } },
      append(chunk){ text += chunk; phase = 'writing'; },
      finish(){ phase = 'done'; render(); clearInterval(intervalId); },
      stop(){ clearInterval(intervalId); }
    };
  }

  // サーバーからのストリーミング返答(1行1イベントのJSON)を読み、最終結果の料理リストを返す
  async function readRecipeStream(response, progress){
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dishes = null;

    function handle(line){
      if(!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch(e){ return; }
      if(ev.type === 'start') progress.started();
      else if(ev.type === 'thinking') progress.thinking();
      else if(ev.type === 'delta' && typeof ev.text === 'string') progress.append(ev.text);
      else if(ev.type === 'done') dishes = ev.dishes;
      else if(ev.type === 'error'){
        const err = new Error('stream error');
        err.userMessage = ev.error;
        throw err;
      }
    }

    for(;;){
      const { done, value } = await reader.read();
      if(done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while((nl = buffer.indexOf('\n')) >= 0){
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    handle(buffer + decoder.decode());
    if(!dishes) throw new Error('stream ended without result');
    return dishes;
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

  // 指標ごとの桁数で数値を丸めて表示用の文字列にする(塩分・食物繊維は0.1g単位)
  function formatMetric(m, value){
    const decimals = m.decimals || 0;
    const p = Math.pow(10, decimals);
    return (Math.round(value * p) / p).toFixed(decimals);
  }

  function renderCreatedCombo(dishes, activeMetrics){
    // 検索条件で選んだ指標はすべて、すべての品に表示する(値はサーバーが成分表から計算済み)
    const shown = activeMetrics && activeMetrics.length
      ? activeMetrics
      : NUTRIENT_METRICS.filter(m => dishes.some(d => d[m.id] != null));
    createResultEl.hidden = false;
    createResultEl.innerHTML = `
      <div class="recipe-card">
        <p class="recipe-tag">入力した内容からAIが作成</p>
        <div class="badges">
          ${shown.map(m => {
            const total = dishes.reduce((s, d) => s + (d[m.id] || 0), 0);
            return `<span class="badge ${m.id}">${m.label}(合計) ${formatMetric(m, total)}${m.unit}</span>`;
          }).join('')}
        </div>
        ${dishes.map((d, i) => `
          <div class="dish-block">
            <div class="dish-head">
              <h2>${dishes.length > 1 ? (i + 1) + '. ' : ''}${escapeHtml(d.name)}</h2>
              <span class="dish-type-tag">${escapeHtml(d.type)}</span>
            </div>
            <p class="dish-macro">${shown.map(m => m.label + ' ' + formatMetric(m, d[m.id] || 0) + m.unit).join(' ・ ')}</p>
            ${d.nutritionNote ? `<p class="dish-nutrition-note">※${escapeHtml(d.nutritionNote)}</p>` : ''}
            <button class="save-btn${isSaved(d.id) ? ' saved' : ''}" data-id="${d.id}">${isSaved(d.id) ? '★ 保存済み' : '☆ 保存する'}</button>
            <div class="ingredients">
              <h3>材料</h3>
              <ul>${d.ingredients.map(x => '<li>' + withPieceCount(escapeHtml(x)) + '</li>').join('')}</ul>
            </div>
            <div class="steps">
              <h3>作り方</h3>
              <ol>${d.steps.map(x => '<li>' + escapeHtml(x) + '</li>').join('')}</ol>
            </div>
          </div>
        `).join('')}
      </div>
    `;
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
    const progress = createProgress(getCreateCount());
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
      const contentType = response.headers.get('Content-Type') || '';
      let items = null;
      if(response.ok && contentType.includes('ndjson') && response.body){
        // 生成中の内容を少しずつ受け取りながら進み具合を表示する
        const streamed = await readRecipeStream(response, progress);
        items = Array.isArray(streamed) ? streamed : null;
      } else {
        const data = await response.json().catch(() => ({}));
        if(!response.ok){
          // ログインの期限切れなら状態を更新し、サーバーが返した日本語メッセージ(上限到達など)をそのまま表示する
          if(response.status === 401) checkSession();
          const apiErr = new Error('API request failed: ' + response.status);
          apiErr.userMessage = data.error;
          throw apiErr;
        }
        items = Array.isArray(data.dishes) ? data.dishes : null;
      }
      if(!items || !items.length){
        throw new Error('Unexpected response shape');
      }
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
        // 選択していた指標だけ、AIの返答から数値を拾って記録する(選ばなかった指標は保存しない)
        // 選択していた指標はすべて記録する(サーバーが成分表から計算して丸めた値をそのまま使う)
        activeMetrics.forEach(m => {
          const v = Number(parsedItem[m.id]);
          recipe[m.id] = Number.isFinite(v) ? v : 0;
        });
        if(typeof parsedItem.nutritionNote === 'string' && parsedItem.nutritionNote){
          recipe.nutritionNote = parsedItem.nutritionNote;
        }
        recipes.push(recipe);
        return recipe;
      });
      progress.finish();
      renderCreatedCombo(dishes, activeMetrics);
    } catch(err){
      showCreateError(err.userMessage || 'レシピの作成に失敗しました。もう一度お試しください。');
    } finally {
      progress.stop();
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
