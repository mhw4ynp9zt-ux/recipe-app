// ==== レシピ作成機能(食材+雰囲気キーワード+選択した栄養指標の目標値・品数からAIがレシピを考える) ====
// config.js の NUTRIENT_METRICS、utils.js の computeEffort/withPieceCount、
// save.js の isSaved/toggleSave/recipes配列、auth.js の isLoggedIn/checkSession、
// error-log.js の logError/logWarn(管理者向けエラーログ)に依存します。
// 栄養量はAIの目分量ではなく、サーバーが日本食品標準成分表(D1)から計算した値を表示します(内訳は各品の「栄養の計算内訳」)。
// AIの呼び出しはサーバーが行います。ブラウザには食材・雰囲気・品数・栄養目標だけを送り、
// APIキー・モデル・プロンプトはサーバー側(管理者が設定)で扱うため、この画面には一切現れません。
// AIが使えるのはログイン中のユーザーだけで、アプリ全体の1日の利用回数に上限があります。
//
// 作成は「ジョブ」としてサーバーで進みます(functions/_lib/recipe-job.js)。
//   1. POST /api/ai/create-recipe   … ジョブを作るだけ(AIは呼ばれない)。jobId を受け取り、この端末に控える
//   2. POST /api/ai/jobs/{jobId}    … ジョブを最後まで動かす(完了まで待つ。切れてもサーバーは続ける)
//   3. GET  /api/ai/jobs/{jobId}    … 1秒ごとに進捗%・結果を受け取る(読むだけ。AIは呼ばれない)
// アプリを切り替える・画面をロックする・ページを開き直す、のあとでも、控えたjobIdで続きの進捗や結果を受け取れます。
// 「実行中なのに誰も処理していない」とサーバーが知らせてきたときだけ、画面側が 2. を呼んで続きを動かします。

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
  const CREATE_LOADING_TEXT = 'レシピを考えています…';
  const CREATE_LOADING_NOTE = '画面を離れても大丈夫です。戻ると続きが表示されます。';

  // ==== 進捗のパーセント表示(サーバーが返す進捗%を、なめらかに追いかけて表示する) ====
  // 進捗%は、AIが返答を書いた量(ストリーミング)と、栄養計算・目標チェック・作り直しの段階から、サーバーが計算します。
  // 画面側の表示は戻らず(単調増加)、完成するまで100%にはなりません。
  let progressTarget = 0;   // サーバーが最後に知らせた進捗(0〜99。完成時だけ100)
  let progressShown = 0;    // いま画面に出している進捗(目標へ少しずつ近づく)
  let progressFillEl = null;
  let progressPctEl = null;
  let progressTrackEl = null;
  let loadingActive = false;

  // 進捗バー用のスタイルと部品(HTML/CSSファイルを増やさず、この画面の部品として持つ)。
  // 進捗バーが作れなくても、レシピの作成そのものは止めない(パーセントの文字が出ないだけ)。
  function ensureProgressUi(){
    if(progressFillEl) return;
    try {
      if(!document.getElementById('progress-style') && document.head && document.createElement){
        const style = document.createElement('style');
        style.id = 'progress-style';
        style.textContent =
          '.loading-card > div{flex:1; min-width:0;}' +
          '.progress{display:flex; align-items:center; gap:10px; margin-top:8px;}' +
          '.progress-track{flex:1; height:8px; border-radius:999px; background:var(--brand-soft); overflow:hidden;}' +
          '.progress-fill{height:100%; width:0; border-radius:999px; background:var(--brand); transition:width .2s linear;}' +
          '.progress-pct{min-width:3.4em; text-align:right; font-size:14px; font-weight:700; color:var(--ink); font-variant-numeric:tabular-nums;}';
        document.head.appendChild(style);
      }
      const box = document.createElement('div');
      box.className = 'progress';
      box.innerHTML = '<div class="progress-track" role="progressbar" aria-label="レシピ作成の進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill"></div></div><span class="progress-pct">0%</span>';
      const host = (createLoadingSubEl && createLoadingSubEl.parentNode) || createLoadingEl;
      host.appendChild(box);
      progressTrackEl = box.querySelector('.progress-track');
      progressFillEl = box.querySelector('.progress-fill');
      progressPctEl = box.querySelector('.progress-pct');
      if(!progressTrackEl || !progressFillEl || !progressPctEl) progressFillEl = null;
    } catch(e){
      progressFillEl = null;
    }
  }

  function renderProgress(){
    if(!progressFillEl) return;
    const pct = Math.floor(progressShown);
    progressFillEl.style.width = pct + '%';
    progressPctEl.textContent = pct + '%';
    progressTrackEl.setAttribute('aria-valuenow', String(pct));
  }

  // サーバーの進捗を受け取る。値は戻さない(通信のタイミングで一瞬小さい値が来ても、表示は下がらない)
  function setProgressTarget(pct){
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    if(v > progressTarget) progressTarget = v;
  }

  function tickProgress(){
    if(!loadingActive) return;
    const gap = progressTarget - progressShown;
    if(gap > 0) progressShown = Math.min(progressTarget, progressShown + Math.max(gap * 0.12, 0.2));
    renderProgress();
    setTimeout(tickProgress, 120);
  }

  // 進捗の段階の文言(サーバーの stage と、ここまでに成功したAI呼び出しの回数 attempt から)
  function stageText(state){
    switch(state && state.stage){
      case 'queued': return '準備しています';
      case 'nutrition': return '成分表で栄養を計算しています';
      case 'retry': return '目標との差を確認して、作り直します';
      case 'ai':
      default:
        return state && state.attempt > 0
          ? '目標に合わせてレシピを作り直しています(' + (state.attempt + 1) + '回目)'
          : 'AIがレシピを考えています';
    }
  }

  function setLoadingSub(text){
    if(createLoadingSubEl) createLoadingSubEl.textContent = text;
  }

  function setCreateLoading(isLoading){
    if(isLoading) createLoadingTextEl.textContent = CREATE_LOADING_TEXT;
    createLoadingEl.hidden = !isLoading;
    generateBtn.disabled = isLoading;
    generateBtn.textContent = isLoading ? '作成中…' : 'レシピを作成する';
    const wasActive = loadingActive;
    loadingActive = isLoading;
    if(isLoading && !wasActive){
      ensureProgressUi();
      progressTarget = 0;
      progressShown = 0;
      renderProgress();
      setLoadingSub(CREATE_LOADING_NOTE);
      tickProgress();
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

  // ==== 作成ジョブ(サーバー側で進み、戻ってきたときに続きを受け取る) ====
  const JOB_KEY = 'recipeJobV1';               // 作成中のジョブを控える場所(この端末のlocalStorage)
  const JOB_KEEP_MS = 30 * 60 * 1000;          // これより古い控えは捨てる(サーバー側も1日で消える)
  const POLL_VISIBLE_MS = 1000;                // 画面が見えている間の確認間隔(読むだけ。AIは呼ばれない)
  const POLL_HIDDEN_MS = 4000;
  const RUN_RETRY_GAP_MS = 4000;               // 「続きを動かす」要求を出し直すまでの最短間隔
  const MAX_POLL_FAILURES = 40;                // 状況を取れない状態がこの回数続いたら、あきらめて案内を出す

  function saveJobNote(job){
    try { localStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch(e){ /* 保存できない環境では、ページを開き直した復帰だけできない */ }
  }
  function loadJobNote(){
    try {
      const job = JSON.parse(localStorage.getItem(JOB_KEY) || 'null');
      if(job && typeof job.id === 'string' && Date.now() - job.startedAt < JOB_KEEP_MS) return job;
    } catch(e){ /* 読めなければ無いものとして扱う */ }
    return null;
  }
  function clearJobNote(){
    try { localStorage.removeItem(JOB_KEY); } catch(e){ /* 無視 */ }
  }

  let watchingJobId = null;    // いま画面で追っているジョブ
  let wakeWatcher = null;      // 待機中の確認ループを今すぐ起こす関数

  function sleepOrWake(ms){
    return new Promise(resolve => {
      const timer = setTimeout(done, ms);
      function done(){ clearTimeout(timer); wakeWatcher = null; resolve(); }
      wakeWatcher = done;
    });
  }

  // 画面に戻ってきたら、すぐ状況を確認する(ロック・アプリ切替のあと、待たずに続きを受け取る)
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && wakeWatcher) wakeWatcher();
  });

  async function readJson(response){
    let text = '';
    try { text = await response.text(); } catch(e){ /* 本文が読めなければ空として扱う */ }
    let data = {};
    let notJson = false;
    try { data = text ? JSON.parse(text) : {}; } catch(e){ notJson = true; }
    if(!data || typeof data !== 'object') data = {};
    return { data: data, text: text, notJson: notJson };
  }

  // 成功: サーバーが返した結果(dishes など)を画面に出す
  function showJobResult(data, logContext){
    logContext.debug = data.debug;
    if(data.debug && debugHasProblem(data.debug, data.targetCheck)){
      // 作成は成功したが、作り直しの失敗・栄養計算の失敗・最終的に目標に収まらなかった等の問題があった場合だけ警告にする。
      // 作り直しが入っても最終的に目標に収まった場合(debug が info だけ)は、警告にもエラーログにもしない。
      logWarn('create-recipe', '作成は成功しましたが、サーバーが問題を報告しました', {
        request: logContext.request, jobId: logContext.jobId, debug: data.debug,
      });
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
      //   選択していた指標は従来どおり recipe[指標ID] に(保存済みレシピの表示でも使う。サーバーは選択した指標だけを入れて返す)
      //   全指標・照合の内訳は nutrition / ingredientDetails / nutritionCheck に
      if(nutritionOk){
        NUTRIENT_METRICS.forEach(m => {
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
  }

  // 終了処理(成功・失敗どちらでも)。ジョブの控えを消し、待機表示を閉じる
  function endWatching(jobId){
    if(watchingJobId === jobId) watchingJobId = null;
    clearJobNote();
    setCreateLoading(false);
  }

  function failWatching(jobId, err, logContext, userMessage){
    logContext.elapsedMs = Date.now() - logContext.startedAt;
    logError('create-recipe', err, logContext);
    endWatching(jobId);
    showCreateError(userMessage || err.userMessage || 'レシピの作成に失敗しました。もう一度お試しください。');
  }

  // ジョブの進捗を追い、完成・失敗まで見届ける。
  //   ・1秒ごとにGET(読むだけ)で進捗%を更新する
  //   ・サーバーが「実行中なのに誰も処理していない(stalled)」と知らせたときだけ、POSTで続きを動かす
  async function watchJob(job){
    watchingJobId = job.id;
    const logContext = { request: job.request, jobId: job.id, startedAt: job.startedAt, resumed: !!job.resumed };
    let wasHidden = document.visibilityState === 'hidden';
    const onVisibility = () => { if(document.visibilityState === 'hidden') wasHidden = true; };
    document.addEventListener('visibilitychange', onVisibility);
    let runInFlight = false;
    let lastRunAt = 0;
    let failures = 0;
    let polls = 0;

    const kickRun = () => {
      runInFlight = true;
      lastRunAt = Date.now();
      logContext.runRequests = (logContext.runRequests || 0) + 1;
      // 完了まで待つ要求。切れても(画面を離れた・iOSが通信を切った)、サーバーは続き、状況はGETで分かる
      fetch('/api/ai/jobs/' + encodeURIComponent(job.id), { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .catch(() => { /* 通信が切れただけ。状況はGETで確認する */ })
        .then(() => { runInFlight = false; if(wakeWatcher) wakeWatcher(); });
    };

    try {
      while(watchingJobId === job.id){
        let state = null;
        try {
          const res = await fetch('/api/ai/jobs/' + encodeURIComponent(job.id), { cache: 'no-store' });
          polls++;
          const body = await readJson(res);
          logContext.status = res.status;
          if(res.status === 401){
            checkSession();
            logContext.serverError = body.data.error;
            failWatching(job.id, new Error('Job polling unauthorized'), logContext, 'ログインの有効期限が切れました。もう一度ログインしてからお試しください。');
            return;
          }
          if(res.status === 404){
            logContext.serverError = body.data.error;
            failWatching(job.id, new Error('Job not found'), logContext, '作成中のレシピが見つかりませんでした。もう一度作成してください。');
            return;
          }
          if(!res.ok) throw new Error('Job polling failed: ' + res.status);
          state = body.data;
          failures = 0;
        } catch(netErr){
          // 通信が切れている間(圏外・ロック中など)は、つながるまで待つ。サーバー側の作成は止まらない
          failures++;
          logContext.lastPollError = netErr && netErr.message;
          if(failures >= MAX_POLL_FAILURES){
            failWatching(job.id, netErr, logContext, '通信が不安定で、作成の状況を確認できませんでした。電波の良い場所で、少し待ってからもう一度お試しください。');
            return;
          }
          setLoadingSub('通信を待っています…つながると続きを受け取ります');
        }

        if(state){
          logContext.polls = polls;
          if(state.status === 'done'){
            setProgressTarget(100);
            progressShown = 100;
            renderProgress();
            await sleepOrWake(250); // 100% を一瞬見せてから結果へ
            logContext.wasHidden = wasHidden;
            try {
              showJobResult(state.result || {}, logContext);
            } catch(err){
              failWatching(job.id, err, logContext);
              return;
            }
            endWatching(job.id);
            return;
          }
          if(state.status === 'error'){
            logContext.status = state.httpStatus;
            logContext.serverError = state.error;
            logContext.debug = state.debug;
            logContext.wasHidden = wasHidden;
            const apiErr = new Error('API request failed: ' + state.httpStatus);
            apiErr.userMessage = state.error;
            failWatching(job.id, apiErr, logContext);
            return;
          }
          // 作成中: 進捗%と段階を更新し、誰も処理していなければ続きを動かす
          setProgressTarget(state.progress);
          setLoadingSub(stageText(state));
          if(state.stalled && !runInFlight && Date.now() - lastRunAt >= RUN_RETRY_GAP_MS) kickRun();
        }
        await sleepOrWake(document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
      }
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  let creatingJob = false;     // ジョブを作る要求の最中(この間の二重タップは無視する)

  async function generateRecipe(){
    if(watchingJobId || creatingJob) return; // すでに作成中(二重に押してもAIを重ねて呼ばない)
    const ingredientsRaw = document.getElementById('create-ingredients').value.trim();
    const moodRaw = document.getElementById('create-mood').value.trim();
    if(!isLoggedIn()){
      showCreateError('AIでレシピを作成するには、「設定」タブからパスキーでログインしてください。');
      return;
    }
    creatingJob = true;
    hideCreateError();
    setCreateLoading(true);
    createResultEl.hidden = true;
    createNoteEl.hidden = true;
    // 失敗したときに管理者向けエラーログ(error-log.js)へ残す情報。サーバーの debug は管理者にだけ返ってくる。
    const logContext = { startedAt: Date.now() };
    let wasHidden = false;
    const onVisibility = () => { if(document.visibilityState === 'hidden') wasHidden = true; };
    document.addEventListener('visibilitychange', onVisibility);
    let started = null;
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
      // ジョブを作るだけの短い要求(AIは呼ばれない)。応答が返る前に通信が切れた場合(iOS Safariでは TypeError "Load failed")だけ、
      // 1回だけ自動で再試行する。再試行しても、サーバーは実行中のジョブを重ねて作らない。
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
            elapsedMs: Date.now() - logContext.startedAt, wasHidden: wasHidden,
          });
          setLoadingSub('通信が切れたため、もう一度試しています…');
        }
      }
      logContext.status = response.status;
      const body = await readJson(response);
      if(body.notJson) logContext.responseText = body.text; // JSONではない応答(エラーページのHTMLなど)は原因調査のため本文も残す
      logContext.serverError = body.data.error;
      logContext.debug = body.data.debug;
      if(!response.ok){
        // ログインの期限切れなら状態を更新し、サーバーが返した日本語メッセージ(上限到達など)をそのまま表示する
        if(response.status === 401) checkSession();
        const apiErr = new Error('API request failed: ' + response.status);
        apiErr.userMessage = body.data.error;
        throw apiErr;
      }
      if(typeof body.data.jobId !== 'string') throw new Error('Unexpected response shape');
      started = { id: body.data.jobId, request: logContext.request, startedAt: Date.now(), resumed: !!body.data.resumed };
      if(body.data.resumed){
        // すでに作成中のものがあった(二重タップ・開き直しなど)。新しく作らず、その続きを表示する
        setLoadingSub('作成中のレシピがあるため、その続きを表示します');
      }
    } catch(err){
      logContext.elapsedMs = Date.now() - logContext.startedAt;
      logContext.wasHidden = wasHidden;
      logError('create-recipe', err, logContext);
      showCreateError(err.userMessage || 'レシピの作成に失敗しました。もう一度お試しください。');
      setCreateLoading(false);
      return;
    } finally {
      creatingJob = false;
      document.removeEventListener('visibilitychange', onVisibility);
    }
    saveJobNote(started);
    await watchJob(started);
  }

  // ページを開き直した・アプリに戻ったときに、作成中だったジョブの続きを受け取る
  function resumePendingJob(){
    if(watchingJobId) return;
    const job = loadJobNote();
    if(!job) return;
    hideCreateError();
    setCreateLoading(true);
    createResultEl.hidden = true;
    createNoteEl.hidden = true;
    setLoadingSub('前回の作成の続きを確認しています…');
    job.resumed = true;
    watchJob(job);
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

  resumePendingJob();
