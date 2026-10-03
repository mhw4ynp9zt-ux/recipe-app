// ==== レシピ作成機能(食材+雰囲気キーワード+選択した栄養指標の目標値・品数からAIがレシピを考える) ====
// config.js の NUTRIENT_METRICS、utils.js の computeEffort/withPieceCount、
// save.js の isSaved/toggleSave/recipes配列、auth.js の isLoggedIn/checkSession、
// error-log.js の logError/logWarn(管理者向けエラーログ)、multi-field.js の createMultiFields(品ごとの入力欄)に依存します。
// 栄養量はAIの目分量ではなく、サーバーが日本食品標準成分表(D1)から計算した値を表示します(内訳は各品の「栄養の計算内訳」)。
// AIの呼び出しはサーバーが行います。ブラウザには食材・雰囲気・品数・栄養目標だけを送り、
// APIキー・モデル・プロンプトはサーバー側(管理者が設定)で扱うため、この画面には一切現れません。
// AIが使えるのはログイン中のユーザーだけで、アプリ全体の1日の利用回数に上限があります。
// 「使わない食材」は設定タブ(excluded-foods.js)で登録します。ブラウザからは送らず、サーバーが本人の登録を読んで自動で除外します。
// 除外したはずの食材が結果に残ってしまった場合は、サーバーが excludedHits で知らせ、結果の上に注意を表示します。
//
// 手間度(ラク/ふつう/しっかり)は、作る負担(手順の数・使う器具・洗い物)の指定です。utils.js の readEffortLevel / writeEffortLevel /
// effortOverIndexes / validEffortLevel と config.js の EFFORT_OPTIONS に依存し、無い古い画面では何も出さず・送らず従来どおり動きます。
// 選択は品ごとのカードのチップで行い、この端末に記憶し、作成要求の dishes[i].effortLevel(0〜3。0=超ラク)として送ります。AIが返した各品の effortLevel と手順の数が指定を超えていたら、
// 結果に注意を出します(作り直しはしません。AIの呼び出し回数は増えません)。パネルは index.html に無くても、ここで差し込みます。
// 以前の「所要時間」のチップは廃止しました(古い index.html に残っていれば、ここで取り除きます)。
//
// 食材・料理名/雰囲気/ジャンルは、品ごとに指定できます(2品・3品のとき)。
// 画面の入力欄は multi-field.js が作り、ここでは createMultiFields.getDishInputs(品数) で品ごとの入力を受け取って、
// 要求の dishes([{ ingredients, mood }, …]。品数と同じ数)として送ります。従来の ingredients / mood には1品目の内容も入れます(古いサーバー・古い画面との互換)。
// 品ごとの入力欄が無い古い画面(createMultiFields が無い・使えない)では、従来の「全品共通の ingredients / mood」だけを送ります。
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

  // ==== 進捗のパーセント表示 ====
  // 表示する進捗 = 「経過時間による目安」と「サーバーが知らせた実際の進捗」の大きい方。
  //   ・経過時間による目安: 見込み時間(過去の作成にかかった時間。無ければ30秒)まで一定の速さで90%まで進み、
  //     それを過ぎてもゆっくり98%に近づく。AIが「考えている間は進まず、書き始めると一気に進む」ことがあるため、
  //     実際の進捗だけだと途中で止まって見えるのを避けるためのもの。
  //   ・サーバーの進捗: AIが返答を書いた量(ストリーミング)と、栄養計算・目標チェック・作り直しの段階から計算した実際の値。
  //     目安より先に進んだときは、こちらに追いつく。
  // 表示は戻らず(単調増加)、完成するまで100%にはなりません。
  let progressTarget = 0;   // サーバーが最後に知らせた進捗(0〜99。完成時だけ100)
  let progressShown = 0;    // いま画面に出している進捗(目標へ少しずつ近づく)
  let progressClock = null; // 経過時間による目安の基準 { startedAt, duration }
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

  // 経過時間による目安(%)。見込み時間 duration までは一定の速さで90%、その後は98%へゆっくり近づく
  function timeCurve(elapsedMs, duration){
    if(elapsedMs <= 0) return 0;
    if(elapsedMs <= duration) return 90 * elapsedMs / duration;
    return 90 + 8 * (1 - Math.exp(-(elapsedMs - duration) / (duration * 0.6)));
  }

  // 過去の作成にかかった時間(品数ごとに直近5件)の中央値を、次の見込み時間にする
  const DURATION_KEY = 'recipeJobDurationsV1';
  const DEFAULT_DURATION_MS = 30000;
  function readDurations(){
    try { return JSON.parse(localStorage.getItem(DURATION_KEY) || '{}') || {}; } catch(e){ return {}; }
  }
  function expectedDuration(count){
    const list = (readDurations()[count] || []).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if(!list.length) return DEFAULT_DURATION_MS;
    return Math.max(8000, Math.min(120000, list[Math.floor(list.length / 2)]));
  }
  function recordDuration(count, ms){
    if(!(ms > 0)) return;
    const all = readDurations();
    all[count] = ((all[count] || []).concat([ms])).slice(-5);
    try { localStorage.setItem(DURATION_KEY, JSON.stringify(all)); } catch(e){ /* 保存できなければ、次回も初期の見込みを使う */ }
  }

  function tickProgress(){
    if(!loadingActive) return;
    let target = progressTarget;
    if(progressClock) target = Math.max(target, timeCurve(Date.now() - progressClock.startedAt, progressClock.duration));
    target = Math.min(target, progressTarget >= 100 ? 100 : 99);
    const gap = target - progressShown;
    if(gap > 0) progressShown = Math.min(target, progressShown + Math.max(gap * 0.25, 0.1));
    renderProgress();
    setTimeout(tickProgress, 100);
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
      progressClock = null;
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

  // ==== 品ごとの入力欄(multi-field.js)との連携 ====
  // 品ごとの入力欄が使えるときは、その入力([{ ingredients, mood }, …]。品数と同じ数)を返す。使えなければ null(従来の入力を使う)
  function readDishInputs(count){
    try {
      if(typeof createMultiFields !== 'undefined' && createMultiFields && createMultiFields.ready === true
          && typeof createMultiFields.getDishInputs === 'function'){
        const list = createMultiFields.getDishInputs(count);
        if(Array.isArray(list) && list.length === count) return list;
      }
    } catch(e){ /* 読めなければ従来の入力を使う */ }
    return null;
  }
  // 従来の全品共通の入力欄(#create-ingredients / #create-mood)の値。無い画面では空文字
  function readLegacyValue(id){
    const el = document.getElementById(id);
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }
  // 品数に合わせて、品ごとのカードを出し分ける
  function syncDishCards(){
    try {
      if(typeof createMultiFields !== 'undefined' && createMultiFields && typeof createMultiFields.setCount === 'function'){
        createMultiFields.setCount(getCreateCount());
      }
    } catch(e){ /* カードの出し分けに失敗しても、作成そのものは止めない */ }
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

  // ==== 手間度(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり。作る負担の指定。品ごとに選び、端末に記憶する。無い古い画面では何もしない) ====
  // 注意: 0(超ラク)は「指定なし(null)」とは別の値。「if(level)」ではなく「level !== null」で判定すること
  // utils.js(readEffortLevel / writeEffortLevel / effortOverIndexes / validEffortLevel)と config.js の EFFORT_OPTIONS に依存。
  // 注意: updateCreateHint() より前(最初の呼び出しの前)に宣言しておくこと
  const effortAvailable = typeof EFFORT_OPTIONS !== 'undefined' && typeof readEffortLevel === 'function';
  const MAX_EFFORT_DISHES = 3;
  // 品ごとの選択(i番目が i+1品目。null=指定なし)
  const selectedEfforts = [];
  for(let i = 0; i < MAX_EFFORT_DISHES; i++) selectedEfforts.push(effortAvailable ? readEffortLevel(localStorage, i) : null);

  // 手間度の選択肢(level)に対応する表示名。無いときは空文字
  function effortLabel(level){
    const opt = effortAvailable ? EFFORT_OPTIONS.find(o => o.level === level) : null;
    return opt ? opt.label : '';
  }

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
    const effortText = '';
    if(!active.length){
      createHintEl.textContent = '全' + t.count + '品の合計で、栄養バランスの良いレシピを考えます。' + effortText;
      return;
    }
    const parts = active.map(m => m.label + t[m.id] + m.unit);
    createHintEl.textContent = '全' + t.count + '品の合計で、' + parts.join('・') + 'を目安にレシピを考えます。' + effortText;
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

  // 手間度のチップを、品ごとのカード(#create-dish-1〜3。multi-field.js が作る)の末尾に差し込む。index.html は変更不要。
  // 以前の「所要時間」のパネルが index.html に残っていれば取り除く(時間の指定は画面から外した)。
  // カードが無い環境(古い画面・テスト)では何も出さず、手間度も送らない。失敗しても、作成そのものは止めない。
  function removeOldTimePanel(){
    try {
      const oldRow = document.getElementById('time-limit-row');
      const oldPanel = oldRow && typeof oldRow.closest === 'function' ? oldRow.closest('section') : null;
      if(oldPanel && typeof oldPanel.remove === 'function') oldPanel.remove();
    } catch(e){ /* 取り除けなくても、作成そのものは止めない */ }
  }
  function ensureEffortChips(n){
    try {
      if(document.getElementById('effort-row-' + n)) return;
      const card = document.getElementById('create-dish-' + n);
      if(!card || typeof card.insertAdjacentHTML !== 'function') return;
      card.insertAdjacentHTML('beforeend',
        '<div class="field effort-field" id="effort-field-' + n + '">' +
          '<label id="effort-label-' + n + '">手間度(任意)</label>' +
          '<div class="count-toggle effort-row" id="effort-row-' + n + '" role="group" aria-labelledby="effort-label-' + n + '"></div>' +
          '<p class="input-hint" id="effort-desc-' + n + '" aria-live="polite"></p>' +
        '</div>');
    } catch(e){ /* チップが出ないだけ。作成そのものは止めない */ }
  }
  if(effortAvailable){
    removeOldTimePanel();
    for(let n = 1; n <= MAX_EFFORT_DISHES; n++) ensureEffortChips(n);
  }
  // チップの行(i番目が i+1品目。カードが無ければ null)。チップが画面にある品の指定だけを送る
  const effortRowEls = [];
  for(let i = 0; i < MAX_EFFORT_DISHES; i++) effortRowEls.push(effortAvailable ? document.getElementById('effort-row-' + (i + 1)) : null);

  // 手間度のチップ(指定なし・超ラク・ラク・ふつう・しっかり)。選択はこの端末に記憶する
  function renderEffortToggles(i){
    const rowEl = effortRowEls[i];
    if(!rowEl) return;
    const sel = selectedEfforts[i];
    const chip = (level, label) => {
      const on = (sel === level);
      return `<button type="button" class="toggle-btn effort-btn${on ? ' active' : ''}" data-effort="${level === null ? '' : level}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
    };
    rowEl.innerHTML = chip(null, '指定なし') + EFFORT_OPTIONS.map(o => chip(o.level, o.label)).join('');
    // 選んだ手間度の説明(指定なしのときは空)
    const descEl = document.getElementById('effort-desc-' + (i + 1));
    const opt = EFFORT_OPTIONS.find(o => o.level === sel);
    if(descEl) descEl.textContent = opt ? opt.short : '';
  }
  if(effortRowEls.some(Boolean)){
    try {
      if(!document.getElementById('effort-style') && document.head && document.createElement){
        const style = document.createElement('style');
        style.id = 'effort-style';
        style.textContent = '.effort-row{grid-template-columns:repeat(5,1fr);} .effort-row .toggle-btn{font-size:12.5px; padding:0 2px;}';
        document.head.appendChild(style);
      }
    } catch(e){ /* 見た目の調整だけ。作成そのものは止めない */ }
    effortRowEls.forEach((rowEl, i) => {
      if(!rowEl) return;
      rowEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.effort-btn');
        if(!btn) return;
        const n = btn.dataset.effort === '' ? null : Number(btn.dataset.effort);
        if(n !== null && !validEffortLevel(n)) return;
        selectedEfforts[i] = n;
        writeEffortLevel(localStorage, n, i);
        renderEffortToggles(i);
      });
      renderEffortToggles(i);
    });
  }

  document.querySelectorAll('.create-count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.create-count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCreateHint();
      syncDishCards();
    });
  });
  syncDishCards();

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

  // 設定タブで「使わない食材」に登録したのに、AIが材料に入れてしまった場合の注意(サーバーが何度か作り直させても残ったときだけ届く)
  function renderExcludedWarn(hits){
    if(!Array.isArray(hits) || !hits.length) return '';
    return '<p class="nutrition-warn">「使わない食材」に登録している「' + hits.map(escapeHtml).join('」「') + '」が、材料に含まれている可能性があります。材料をご確認のうえ、もう一度作成してみてください。</p>';
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

  // 手間度の注意: AIが判定した手間度や手順の数が、指定した手間度(ラク・ふつう)を超えている品があるとき(作り直しはせず、知らせるだけ)
  // 「しっかり」・指定なしのときは出さない
  // 作成要求の控え(開き直したジョブの控えも含む)から、品ごとの手間度の指定の配列を取り出す。無ければ null
  function requestedEfforts(req, n){
    if(!req) return null;
    if(Array.isArray(req.dishEfforts)) return req.dishEfforts;
    if(typeof validEffortLevel === 'function' && validEffortLevel(req.effortLevel)) return Array.from({ length: n }, () => req.effortLevel); // 全品共通の古い控え
    return null;
  }
  // efforts: 品ごとの指定の配列(i番目が i+1品目。null=指定なし)。指定より手間が大きい品があれば、その品の番号つきで注意を出す
  function renderEffortWarn(dishes, efforts){
    if(!effortAvailable || !Array.isArray(efforts) || typeof effortOverIndexes !== 'function') return '';
    const over = effortOverIndexes(dishes, efforts);
    if(!over.length) return '';
    const names = over.map(i => (dishes.length > 1 ? (i + 1) + '品目' : 'この品') + '(指定: ' + effortLabel(efforts[i]) + ')');
    return '<p class="nutrition-warn">手間が指定より大きい品があります: ' + escapeHtml(names.join('、')) + '。もう一度作成するか、条件を変えてください。</p>';
  }

  function renderDishEffort(d){
    if(!effortAvailable) return '';
    const parts = [];
    if(validEffortLevel(d.effortLevel)) parts.push('手間 ' + escapeHtml(effortLabel(d.effortLevel)));
    if(Array.isArray(d.steps) && d.steps.length) parts.push('工程 ' + d.steps.length);
    return parts.length ? '<p class="dish-macro dish-effort">' + parts.join(' ・ ') + '</p>' : '';
  }

  function renderCreatedCombo(dishes, nutritionOk, targetCheck, excludedHits, effortSel){
    // effortSel: 品ごとの手間度の指定の配列(無ければ手間の注意は出さない)
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
        ${renderExcludedWarn(excludedHits)}
        ${nutritionOk ? renderTargetCheck(targetCheck) : ''}
        ${renderEffortWarn(dishes, effortSel)}
        ${dishes.map((d, i) => `
          <div class="dish-block">
            <div class="dish-head">
              <h2>${dishes.length > 1 ? '<span class="dish-num">' + (i + 1) + '</span>' : ''}${escapeHtml(d.name)}</h2>
              <span class="dish-type-tag">${escapeHtml(d.type)}</span>
            </div>
            <p class="dish-macro">${shown.filter(m => d[m.id] != null).map(m => m.label + ' ' + d[m.id] + m.unit).join(' ・ ')}</p>
            ${renderDishEffort(d)}
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
      // AIが付けた系統・役割(あるときだけ。検証はサーバーで済んでいる)
      if(typeof parsedItem.genre === 'string' && parsedItem.genre) recipe.genre = parsedItem.genre;
      if(typeof parsedItem.role === 'string' && parsedItem.role) recipe.role = parsedItem.role;
      // AIが付けた所要時間の目安(分。有効な値のときだけ。保存済みレシピに残すだけで、画面には出さない)
      if(typeof validMinutes === 'function' && validMinutes(parsedItem.minutes)) recipe.minutes = parsedItem.minutes;
      // AIが判定した手間度(0=超ラク / 1=ラク / 2=ふつう / 3=しっかり。有効な値のときだけ。保存済みレシピにも残る。recipe.effort とは別の項目)
      if(effortAvailable && validEffortLevel(parsedItem.effortLevel)) recipe.effortLevel = parsedItem.effortLevel;
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
    renderCreatedCombo(dishes, nutritionOk, data.targetCheck, data.excludedHits, requestedEfforts(logContext.request, dishes.length));
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
  //   ・新しく作ったジョブは、すぐ POST で動かし始める(状況を確かめてから動かすと、通信の往復が増えて遅くなるため)
  //   ・POST は完成まで待つ要求で、完成したときの状況が返る。それを直接使うので、完成を待たずに受け取れる
  //   ・1秒ごとの GET(読むだけ)で進捗%を更新する。通信が切れた・画面を離れた後は、これで続きを受け取る
  //   ・サーバーが「実行中なのに誰も処理していない(stalled)」と知らせたときも、POST で続きを動かす
  async function watchJob(job){
    watchingJobId = job.id;
    const count = job.request && job.request.count;
    progressClock = { startedAt: job.startedAt, duration: expectedDuration(count) };
    const logContext = { request: job.request, jobId: job.id, startedAt: job.startedAt, resumed: !!job.resumed };
    let wasHidden = document.visibilityState === 'hidden';
    const onVisibility = () => { if(document.visibilityState === 'hidden') wasHidden = true; };
    document.addEventListener('visibilitychange', onVisibility);
    let runInFlight = false;
    let lastRunAt = 0;
    let failures = 0;
    let polls = 0;
    let finished = false;

    // サーバーが返した状況を画面に反映する。完成・失敗で終わったら true(結果の表示・エラー表示まで行う)
    const applyState = (state) => {
      if(finished) return true;
      logContext.polls = polls;
      if(state.status === 'done'){
        finished = true;
        setProgressTarget(100);
        progressShown = 100;
        renderProgress();
        logContext.wasHidden = wasHidden;
        try {
          showJobResult(state.result || {}, logContext);
        } catch(err){
          failWatching(job.id, err, logContext);
          return true;
        }
        // 待たされた時間を、次回の進捗の見込みに使う(画面を離れていた場合は、待ち時間として正しくないので使わない)
        if(!job.resumed && !wasHidden) recordDuration(count, Date.now() - job.startedAt);
        endWatching(job.id);
        return true;
      }
      if(state.status === 'error'){
        finished = true;
        logContext.status = state.httpStatus;
        logContext.serverError = state.error;
        logContext.debug = state.debug;
        logContext.wasHidden = wasHidden;
        const apiErr = new Error('API request failed: ' + state.httpStatus);
        apiErr.userMessage = state.error;
        failWatching(job.id, apiErr, logContext);
        return true;
      }
      // 作成中: 進捗%と段階を更新し、誰も処理していなければ続きを動かす
      setProgressTarget(state.progress);
      setLoadingSub(stageText(state));
      if(state.stalled && !runInFlight && Date.now() - lastRunAt >= RUN_RETRY_GAP_MS) kickRun();
      return false;
    };

    function kickRun(){
      runInFlight = true;
      lastRunAt = Date.now();
      logContext.runRequests = (logContext.runRequests || 0) + 1;
      // 完了まで待つ要求。切れても(画面を離れた・iOSが通信を切った)、サーバーは続き、状況はGETで分かる
      fetch('/api/ai/jobs/' + encodeURIComponent(job.id), { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(res => (res.ok ? readJson(res) : null))
        .then(body => { runInFlight = false; if(body && body.data && body.data.status) applyState(body.data); })
        .catch(() => { runInFlight = false; /* 通信が切れただけ。状況はGETで確認する */ })
        .then(() => { if(wakeWatcher) wakeWatcher(); });
    }

    try {
      if(!job.resumed) kickRun();
      while(watchingJobId === job.id && !finished){
        try {
          const res = await fetch('/api/ai/jobs/' + encodeURIComponent(job.id), { cache: 'no-store' });
          polls++;
          const body = await readJson(res);
          logContext.status = res.status;
          if(finished) return; // 待っている間に、実行要求の応答で完成していた
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
          failures = 0;
          if(applyState(body.data)) return;
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
        await sleepOrWake(document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
      }
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
    }
  }

  let creatingJob = false;     // ジョブを作る要求の最中(この間の二重タップは無視する)

  async function generateRecipe(){
    if(watchingJobId || creatingJob) return; // すでに作成中(二重に押してもAIを重ねて呼ばない)
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
      // 食材・料理名/雰囲気/ジャンルは、品ごとの入力欄があればその内容(品ごとの dishes)を送る。
      // 従来の ingredients / mood には、1品目の内容(品ごとの入力欄が無い古い画面では、全品共通の入力欄の内容)を入れる。
      const dishInputs = readDishInputs(target.count);
      const ingredientsRaw = dishInputs ? dishInputs[0].ingredients : readLegacyValue('create-ingredients');
      const moodRaw = dishInputs ? dishInputs[0].mood : readLegacyValue('create-mood');
      logContext.request = { ingredients: ingredientsRaw, mood: moodRaw, count: target.count, targets: targets };
      const body = {
        ingredients: ingredientsRaw,
        mood: moodRaw,
        count: target.count,
        targets: targets
      };
      if(dishInputs){
        // 手間度は品ごとの指定(チップが画面にある品だけ。指定なしの品は項目を付けない)。0(超ラク)も有効な指定
        const dishEfforts = dishInputs.map((d, i) => (effortRowEls[i] && selectedEfforts[i] !== null) ? selectedEfforts[i] : null);
        body.dishes = dishInputs.map((d, i) => dishEfforts[i] !== null ? Object.assign({}, d, { effortLevel: dishEfforts[i] }) : d);
        logContext.request.dishes = body.dishes;
        // ジョブの控え(logContext.request)にも入れ、開き直した後の超過判定でも使う
        if(dishEfforts.some(v => v !== null)) logContext.request.dishEfforts = dishEfforts;
      }
      const requestBody = JSON.stringify(body);
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
      const resBody = await readJson(response);
      if(resBody.notJson) logContext.responseText = resBody.text; // JSONではない応答(エラーページのHTMLなど)は原因調査のため本文も残す
      logContext.serverError = resBody.data.error;
      logContext.debug = resBody.data.debug;
      if(!response.ok){
        // ログインの期限切れなら状態を更新し、サーバーが返した日本語メッセージ(上限到達など)をそのまま表示する
        if(response.status === 401) checkSession();
        const apiErr = new Error('API request failed: ' + response.status);
        apiErr.userMessage = resBody.data.error;
        throw apiErr;
      }
      if(typeof resBody.data.jobId !== 'string') throw new Error('Unexpected response shape');
      started = { id: resBody.data.jobId, request: logContext.request, startedAt: Date.now(), resumed: !!resBody.data.resumed };
      if(resBody.data.resumed){
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
