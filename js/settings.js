// ==== 「設定」タブ:使わない食材・個人的な要望の登録(ログイン中の全員)/ 外部AI(Grok)の管理(管理者専用) ====
// 「使わない食材」「個人的な要望」はログインしているとき、外部AIの管理欄は管理者としてログインしているときだけ表示されます
// (どちらも auth.js の renderAuthUI から onAuthChanged() が呼ばれます)。
// APIキー・モデル・1日の上限はサーバー(/api/admin/ai-settings など)に保存され、この端末には保存しません。
// 表示・非表示はあくまで見た目の制御で、実際の権限チェックはすべてサーバー側で行われます。
// auth.js の isLoggedIn()/isAdmin()、error-log.js の logError/renderLogControls(管理者向けエラーログ)に依存します。
// (error-log.js が無い環境でも動くよう、記録の呼び出しは recordAdminError 経由にしています)

  // 以前のバージョンでこの端末のlocalStorageに保存していたキー(移行後に削除します)
  const LEGACY_GROK_SETTINGS_KEY = 'recipeRouletteGrokSettingsV1';

  const adminSectionEl = document.getElementById('admin-section');
  const grokApiKeyEl = document.getElementById('grok-api-key');
  const grokKeyStateEl = document.getElementById('grok-key-state');
  const grokModelEl = document.getElementById('grok-model');
  const grokLimitEl = document.getElementById('grok-daily-limit');
  const grokUsageEl = document.getElementById('grok-usage');
  const grokTestBtn = document.getElementById('btn-grok-test');
  const grokSaveBtn = document.getElementById('btn-grok-save');
  const grokStatusEl = document.getElementById('grok-test-status');

  function showGrokStatus(msg, isError){
    grokStatusEl.textContent = msg;
    grokStatusEl.hidden = false;
    grokStatusEl.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }

  // 管理者向けエラーログへ記録する(error-log.js が読み込まれていない環境では何もしない)
  function recordAdminError(source, error, extra){
    if(typeof logError === 'function') logError(source, error, extra);
  }
  function refreshLogControls(){
    if(typeof renderLogControls === 'function') renderLogControls();
  }

  // 管理者用APIを呼ぶ共通処理。失敗時はサーバーが返した日本語メッセージで例外にする。
  // 失敗はエラーログに記録し、例外に logged = true を付ける(呼び出し側で二重に記録しないため)。
  // リクエスト本文(APIキーを含みうる)は記録しない。サーバーが返す detail は管理者専用APIなので記録してよい。
  async function adminFetch(url, options){
    const method = (options && options.method) || 'GET';
    let res;
    try {
      res = await fetch(url, options);
    } catch(e){
      recordAdminError('admin-api', e, { url: url, method: method });
      e.logged = true;
      throw e;
    }
    let data = {};
    try { data = await res.json(); } catch(e){ /* 空のレスポンス */ }
    if(!data || typeof data !== 'object') data = {};
    if(!res.ok){
      const err = new Error(data.error || '通信に失敗しました(' + res.status + ')');
      recordAdminError('admin-api', err, { url: url, method: method, status: res.status, serverError: data.error, detail: data.detail });
      err.logged = true;
      throw err;
    }
    return data;
  }

  // モデルのプルダウンの中身を入れ替える(selectedIdがあればそれを選択状態にする)
  function setModelOptions(modelIds, selectedId){
    grokModelEl.innerHTML = '';
    modelIds.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      if(id === selectedId) opt.selected = true;
      grokModelEl.appendChild(opt);
    });
  }

  function readLegacyGrokSettings(){
    try {
      const raw = localStorage.getItem(LEGACY_GROK_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }
  function clearLegacyGrokSettings(){
    try { localStorage.removeItem(LEGACY_GROK_SETTINGS_KEY); } catch(e){ /* 無視 */ }
  }

  async function loadAdminSettings(){
    try {
      const data = await adminFetch('/api/admin/ai-settings');
      setModelOptions([data.model], data.model);
      grokLimitEl.value = data.dailyLimit;
      grokUsageEl.textContent = '本日の利用回数: ' + data.usedToday + ' / ' + data.dailyLimit + '(アプリ全体で共通。日本時間で毎日リセットされます)';

      if(data.keyError){
        grokKeyStateEl.textContent = '保存済みのAPIキーを復号できません。SETTINGS_ENC_KEYが変更された可能性があります。APIキーを入力し直して保存してください。';
      } else if(data.configured){
        grokKeyStateEl.textContent = 'APIキーは設定済みです(' + data.keyHint + ')。変更する場合だけ、下に新しいキーを入力してください。';
      } else {
        grokKeyStateEl.textContent = 'APIキーはまだ設定されていません。';
      }
      if(!data.encryptionReady){
        showGrokStatus('サーバーに SETTINGS_ENC_KEY が設定されていないため、APIキーを保存できません。READMEの手順を確認してください。', true);
      }

      // 旧バージョンでこの端末に保存していた設定の引き継ぎ
      const legacy = readLegacyGrokSettings();
      if(legacy && legacy.apiKey){
        if(data.configured){
          clearLegacyGrokSettings(); // サーバーに設定済みなら、端末側の古いキーは不要なので削除
        } else {
          grokApiKeyEl.value = legacy.apiKey;
          if(legacy.model) setModelOptions([legacy.model], legacy.model);
          showGrokStatus('この端末に保存されていた旧設定を読み込みました。「設定を保存」を押すとサーバーへ移行され、端末側のキーは削除されます。', false);
        }
      }
    } catch(err){
      if(!err.logged) recordAdminError('admin-settings-load', err);
      showGrokStatus(err.message, true);
    }
  }

  async function testGrokConnection(){
    const typedKey = grokApiKeyEl.value.trim();
    grokTestBtn.disabled = true;
    grokTestBtn.textContent = '接続中…';
    showGrokStatus('接続を確認しています…', false);
    try {
      const data = await adminFetch('/api/admin/ai-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typedKey ? { apiKey: typedKey } : {}),
      });
      const ids = data.models;
      const current = grokModelEl.value;
      const selected = ids.includes(current) ? current : (ids.find(id => id.indexOf('grok-4') === 0) || ids[0]);
      setModelOptions(ids, selected);
      showGrokStatus('接続に成功しました(' + ids.length + '件のモデルが見つかりました)。使うモデルを選んで「設定を保存」を押してください。', false);
    } catch(err){
      if(!err.logged) recordAdminError('admin-ai-test', err);
      showGrokStatus(err.message, true);
    } finally {
      grokTestBtn.disabled = false;
      grokTestBtn.textContent = '接続テスト・モデルを取得';
    }
  }

  async function saveAdminSettings(){
    const payload = {};
    if(grokModelEl.value) payload.model = grokModelEl.value;
    const typedKey = grokApiKeyEl.value.trim();
    if(typedKey) payload.apiKey = typedKey; // 空欄なら保存済みのキーを維持する
    const limitRaw = grokLimitEl.value.trim();
    if(limitRaw !== '') payload.dailyLimit = Number(limitRaw);

    grokSaveBtn.disabled = true;
    grokSaveBtn.textContent = '保存中…';
    try {
      await adminFetch('/api/admin/ai-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      grokApiKeyEl.value = '';      // 入力したキーは画面に残さない
      clearLegacyGrokSettings();    // 旧バージョンの端末保存分も削除
      await loadAdminSettings();
      showGrokStatus('設定を保存しました。', false);
    } catch(err){
      if(!err.logged) recordAdminError('admin-settings-save', err);
      showGrokStatus(err.message, true);
    } finally {
      grokSaveBtn.disabled = false;
      grokSaveBtn.textContent = '設定を保存';
    }
  }

  // ==== 成分表の登録(管理者専用) ====
  // data/foods.json(日本食品標準成分表)を100件ずつサーバー(/api/admin/import-foods)へ送ってD1に登録する。
  // 何度実行しても上書きされるだけ(INSERT OR REPLACE)。栄養計算(nutrition.js)がこのデータを使います。
  const FOODS_TOTAL = 2538;
  const FOODS_CHUNK = 100;
  const foodsStatusEl = document.getElementById('foods-status');
  const foodsImportBtn = document.getElementById('btn-foods-import');
  const foodsMsgEl = document.getElementById('foods-import-msg');

  function showFoodsMsg(msg, isError){
    foodsMsgEl.textContent = msg;
    foodsMsgEl.hidden = false;
    foodsMsgEl.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }

  async function loadFoodsStatus(){
    try {
      const data = await adminFetch('/api/admin/import-foods');
      foodsStatusEl.textContent = '現在の登録数: ' + data.total + ' 件' +
        (data.total >= FOODS_TOTAL ? '(登録済みです)' : '(未登録、または一部のみです。下のボタンで登録してください)');
    } catch(err){
      if(!err.logged) recordAdminError('foods-status', err);
      foodsStatusEl.textContent = err.message;
    }
  }

  async function importFoods(){
    foodsImportBtn.disabled = true;
    foodsImportBtn.textContent = '登録中…';
    showFoodsMsg('データを読み込んでいます…', false);
    let importedRows = 0; // 登録を送り終えた件数(失敗したときにどこまで進んだかをログに残す)
    try {
      const fileRes = await fetch('/data/foods.json');
      if(!fileRes.ok) throw new Error('data/foods.json が見つかりません。GitHubにアップロードされているか確認してください。');
      const rows = (await fileRes.json()).rows;
      if(!Array.isArray(rows) || !rows.length) throw new Error('data/foods.json の形式が正しくありません。');
      let total = 0;
      for(let i = 0; i < rows.length; i += FOODS_CHUNK){
        showFoodsMsg('登録中… ' + Math.min(i + FOODS_CHUNK, rows.length) + ' / ' + rows.length + ' 件', false);
        const data = await adminFetch('/api/admin/import-foods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init: i === 0, rows: rows.slice(i, i + FOODS_CHUNK) }),
        });
        total = data.total;
        importedRows = Math.min(i + FOODS_CHUNK, rows.length);
      }
      showFoodsMsg('完了しました(登録数: ' + total + ' 件)。「作る」タブでレシピを作成して確認してください。', false);
      await loadFoodsStatus();
    } catch(err){
      // 原因は adminFetch が記録済みの場合でも、どこまで進んだかは別に残す
      recordAdminError('import-foods', err.logged ? new Error('成分表の取り込みが途中で止まりました(原因は直前の admin-api のログ)') : err, { importedRows: importedRows });
      showFoodsMsg('失敗しました: ' + err.message + '(もう一度押すと、最初からやり直せます)', true);
    } finally {
      foodsImportBtn.disabled = false;
      foodsImportBtn.textContent = '成分表を登録する';
    }
  }

  // ==== 使わない食材の登録(ログイン中の全員。ユーザーごとにサーバーへ保存) ====
  // 苦手・避けたい食材を登録しておくと、レシピを作るたびに自動でAIの条件に加わります(検索のたびに入力する必要はありません)。
  //   ・登録内容はサーバー(GET/PUT /api/user/excluded-foods)に保存され、ログインしていれば別の端末でも同じ内容になります
  //   ・追加・削除のたびに自動で保存します(「保存」ボタンはありません)
  //   ・レシピ作成のときにブラウザから送る必要はなく、サーバーが本人の登録を読んで使います(functions/_lib/recipe-job.js の startJob)
  //   ・この画面の操作では、AIは呼ばれません(=費用は発生しません)
  // 設定欄(HTML)・スタイル・「作る」タブのお知らせは、index.html / style.css を増やさず、ここで作ります
  // (create-ai.js の進捗バーと同じ方針)。作れなくても、レシピ作成や管理者向けの機能は止めません。
  const EXCLUDED_URL = '/api/user/excluded-foods';

  const EXCLUDED_CSS =
    '#excluded-section .view-title{margin-top:28px;}' +
    '.excluded-add{display:flex; gap:8px; align-items:stretch;}' +
    '.excluded-add input{flex:1; min-width:0;}' +
    '.excluded-add .btn{flex:0 0 auto; min-height:48px;}' +
    '.excluded-list{list-style:none; margin:16px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:8px;}' +
    '.excluded-empty{font-size:13px; color:var(--ink-faint); padding:2px 2px 0;}' +
    '.excluded-chip{display:inline-flex; align-items:center; max-width:100%; padding:2px 3px 2px 14px; border-radius:100px;' +
      ' background:var(--accent-soft); border:1.5px solid rgba(217,100,63,.28); color:var(--ink); font-size:14px; font-weight:700; line-height:1.4;}' +
    '.excluded-chip span{min-width:0; overflow-wrap:anywhere;}' +
    '.excluded-remove{flex:0 0 auto; width:38px; height:38px; margin-left:2px; display:grid; place-items:center; border:none; border-radius:50%;' +
      ' background:transparent; color:var(--accent); cursor:pointer;}' +
    '.excluded-remove svg{width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:2.4; stroke-linecap:round;}' +
    '.excluded-remove:active{background:rgba(217,100,63,.16);}' +
    '#excluded-section .stat-line{font-weight:500; color:var(--ink-soft); font-size:12.5px;}' +
    '#excluded-section .status-line{text-align:left;}' +
    '.excluded-note{margin-top:14px;}' +
    '.excluded-hint{margin-top:12px;}' +
    '.link-btn{display:inline; margin-left:4px; padding:4px 2px; border:none; background:none; color:var(--brand); font:inherit; font-weight:700; text-decoration:underline; cursor:pointer;}';

  const EXCLUDED_HTML =
    '<h2 class="view-title">レシピの設定</h2>' +
    '<section class="panel">' +
      '<div class="panel-head"><h3>使わない食材</h3></div>' +
      '<p class="input-hint">苦手な食材や避けたい食材を登録しておくと、レシピを作るたびに自動で除外されます。検索のたびに入力する必要はありません。</p>' +
      '<div class="field">' +
        '<label for="excluded-input">食材を追加</label>' +
        '<div class="excluded-add">' +
          '<input type="text" id="excluded-input" placeholder="例: パクチー なす" autocomplete="off" autocapitalize="none" enterkeyhint="done">' +
          '<button type="button" class="btn btn-secondary btn-small" id="btn-excluded-add">追加</button>' +
        '</div>' +
        '<p class="input-hint">スペースや「、」で区切ると、まとめて追加できます。「豚肉」のように大きな分類でも登録できます。</p>' +
      '</div>' +
      '<ul class="excluded-list" id="excluded-list" aria-label="使わない食材の一覧"></ul>' +
      '<p class="stat-line" id="excluded-count"></p>' +
      '<p id="excluded-status" class="status-line" hidden></p>' +
      '<p class="input-hint excluded-note">追加・削除すると自動で保存されます。AIが指示を守れないことも稀にあるため、アレルギーなど重要な場合は、材料もご自身で確認してください。</p>' +
    '</section>';

  let excludedSectionEl = null;
  let excludedInputEl = null;
  let excludedListEl = null;
  let excludedCountEl = null;
  let excludedStatusEl = null;
  let createExcludedHintEl = null;

  let excludedFoods = [];                                 // いま画面に出している登録内容
  let excludedLimits = { max: 30, maxLength: 20 };        // サーバーの上限(読み込み時に更新される)
  let excludedSaving = false;                             // 保存の通信の最中か
  let excludedDirty = false;                              // 保存の最中にさらに変更されたか(終わったらもう一度保存する)

  function showExcludedStatus(msg, isError){
    if(!excludedStatusEl) return;
    excludedStatusEl.textContent = msg;
    excludedStatusEl.hidden = !msg;
    excludedStatusEl.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }

  function recordExcludedError(err, extra){
    if(typeof logError === 'function') logError('excluded-foods', err, extra);
  }

  // 重複の判定用に、表記ゆれをならす(サーバーの matchKey と同じ考え方: 全角半角・大文字小文字・カタカナ→ひらがな・空白)
  function excludedKey(text){
    return String(text).normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/\s+/g, '');
  }

  // 入力欄の文字を、食材ごとに分ける(スペース・「、」・カンマ区切りでまとめて追加できる)
  function splitExcludedInput(text){
    return String(text).split(/[\s、,，;；]+/).map(s => s.trim()).filter(Boolean);
  }

  function renderExcluded(){
    if(!excludedListEl) return;
    excludedListEl.textContent = '';
    if(!excludedFoods.length){
      const empty = document.createElement('li');
      empty.className = 'excluded-empty';
      empty.textContent = 'まだ登録がありません';
      excludedListEl.appendChild(empty);
    }
    excludedFoods.forEach(name => {
      const li = document.createElement('li');
      li.className = 'excluded-chip';
      const label = document.createElement('span');
      label.textContent = name;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'excluded-remove';
      btn.dataset.name = name;
      btn.setAttribute('aria-label', '「' + name + '」を使わない食材から外す');
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
      li.appendChild(label);
      li.appendChild(btn);
      excludedListEl.appendChild(li);
    });
    if(excludedCountEl) excludedCountEl.textContent = '登録済み: ' + excludedFoods.length + ' / ' + excludedLimits.max + ' 件';
    renderCreateExcludedHint();
  }

  // 「作る」タブのお知らせ。登録があるときだけ、何件が自動で除外されるかを知らせる
  function renderCreateExcludedHint(){
    if(!createExcludedHintEl) return;
    createExcludedHintEl.textContent = '';
    if(!isLoggedIn() || !excludedFoods.length){
      createExcludedHintEl.hidden = true;
      return;
    }
    const shown = excludedFoods.slice(0, 5).join('、') + (excludedFoods.length > 5 ? ' ほか' : '');
    createExcludedHintEl.appendChild(document.createTextNode('使わない食材 ' + excludedFoods.length + '件(' + shown + ')は、自動で除外されます。'));
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'link-btn';
    link.dataset.goto = 'settings';
    link.textContent = '変更する';
    createExcludedHintEl.appendChild(link);
    createExcludedHintEl.hidden = false;
  }

  // 失敗時はサーバーが返した日本語メッセージで例外にする(エラーログにも残す)
  async function excludedFetch(options){
    const method = (options && options.method) || 'GET';
    let res;
    try {
      res = await fetch(EXCLUDED_URL, options);
    } catch(e){
      recordExcludedError(e, { method: method });
      throw new Error('通信に失敗しました。電波の良い場所でもう一度お試しください。');
    }
    let data = {};
    try { data = await res.json(); } catch(e){ /* 空のレスポンス */ }
    if(!data || typeof data !== 'object') data = {};
    if(!res.ok){
      const err = new Error(data.error || '通信に失敗しました(' + res.status + ')');
      recordExcludedError(err, { method: method, status: res.status, serverError: data.error });
      throw err;
    }
    return data;
  }

  function applyExcludedData(data){
    if(Array.isArray(data.foods)) excludedFoods = data.foods.filter(x => typeof x === 'string');
    if(data.max) excludedLimits = { max: data.max, maxLength: data.maxLength || excludedLimits.maxLength };
    renderExcluded();
  }

  async function loadExcluded(){
    if(excludedSaving) return; // 保存の最中は、古い内容で上書きしない
    try {
      applyExcludedData(await excludedFetch());
    } catch(err){
      showExcludedStatus(err.message, true);
    }
  }

  // 保存(一覧をまるごと置き換え)。保存の最中にさらに変更されたら、終わったあとにもう一度保存する。
  async function saveExcluded(){
    if(excludedSaving){ excludedDirty = true; return; }
    excludedSaving = true;
    showExcludedStatus('保存しています…', false);
    try {
      do {
        excludedDirty = false;
        const data = await excludedFetch({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ foods: excludedFoods }),
        });
        if(!excludedDirty) applyExcludedData(data); // サーバーが整えた内容(空白除去など)に合わせる
      } while(excludedDirty);
      showExcludedStatus('保存しました。次のレシピ作成から自動で除外されます。', false);
    } catch(err){
      excludedDirty = false;
      excludedSaving = false;
      showExcludedStatus(err.message, true); // サーバーのメッセージは「保存できませんでした。…」と、そのまま読める文になっている
      await loadExcluded(); // サーバーに保存されている内容に戻す
      return;
    }
    excludedSaving = false;
  }

  function addExcludedFromInput(){
    const tokens = splitExcludedInput(excludedInputEl.value);
    if(!tokens.length) return;
    const keys = new Set(excludedFoods.map(excludedKey));
    const added = [];
    let duplicated = 0;
    for(const name of tokens){
      if(name.length > excludedLimits.maxLength){
        showExcludedStatus('「' + name.slice(0, 8) + '…」は長すぎます(1件' + excludedLimits.maxLength + '文字までです)。', true);
        return;
      }
      const key = excludedKey(name);
      if(keys.has(key)){ duplicated++; continue; }
      keys.add(key);
      added.push(name);
    }
    if(excludedFoods.length + added.length > excludedLimits.max){
      showExcludedStatus('登録できるのは' + excludedLimits.max + '件までです。不要なものを外してから追加してください。', true);
      return;
    }
    excludedInputEl.value = '';
    if(!added.length){
      showExcludedStatus(duplicated ? 'すでに登録されています。' : '', false);
      return;
    }
    excludedFoods = excludedFoods.concat(added);
    renderExcluded();
    saveExcluded();
  }

  function removeExcluded(name){
    const next = excludedFoods.filter(x => x !== name);
    if(next.length === excludedFoods.length) return;
    excludedFoods = next;
    renderExcluded();
    saveExcluded();
  }

  // 設定欄・スタイル・「作る」タブのお知らせを作って、操作を結びつける(最初に1回)
  function initExcludedFoods(){
    try {
      if(typeof document.createElement !== 'function' || !document.head) return; // 画面部品が使えない環境では何もしない
      const view = document.getElementById('view-settings');
      if(!view || !adminSectionEl) return;

      const style = document.createElement('style');
      style.id = 'excluded-style';
      style.textContent = EXCLUDED_CSS;
      document.head.appendChild(style);

      excludedSectionEl = document.createElement('div');
      excludedSectionEl.id = 'excluded-section';
      excludedSectionEl.hidden = true;
      excludedSectionEl.innerHTML = EXCLUDED_HTML;
      view.insertBefore(excludedSectionEl, adminSectionEl); // アカウントの下・管理者設定の上

      excludedInputEl = document.getElementById('excluded-input');
      excludedListEl = document.getElementById('excluded-list');
      excludedCountEl = document.getElementById('excluded-count');
      excludedStatusEl = document.getElementById('excluded-status');

      // 「作る」タブ: 雰囲気・ジャンル欄の下に、登録件数のお知らせ(登録があるときだけ表示)
      const moodEl = document.getElementById('create-mood');
      const moodField = moodEl && moodEl.closest ? moodEl.closest('.field') : null;
      if(moodField && moodField.parentNode){
        createExcludedHintEl = document.createElement('p');
        createExcludedHintEl.className = 'input-hint excluded-hint';
        createExcludedHintEl.id = 'create-excluded-hint';
        createExcludedHintEl.hidden = true;
        moodField.parentNode.insertBefore(createExcludedHintEl, moodField.nextSibling);
      }

      document.getElementById('btn-excluded-add').addEventListener('click', addExcludedFromInput);
      excludedInputEl.addEventListener('keydown', (e) => {
        // 日本語入力の変換を確定するEnterでは追加しない
        if(e.key === 'Enter' && !e.isComposing && e.keyCode !== 229){
          e.preventDefault();
          addExcludedFromInput();
        }
      });
      excludedListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.excluded-remove');
        if(btn) removeExcluded(btn.dataset.name);
      });
      renderExcluded();
    } catch(err){
      excludedSectionEl = null; // 作れなかったときは、この機能だけ使わない(ほかの機能は止めない)
      recordExcludedError(err, { step: 'init' });
    }
  }

  // ログイン状態が変わるたびに onAuthChanged から呼ばれる。ログイン中だけ設定欄を表示し、登録内容を読み込む
  function onExcludedFoodsAuthChanged(){
    if(!excludedSectionEl) return;
    const loggedIn = isLoggedIn();
    excludedSectionEl.hidden = !loggedIn;
    if(loggedIn){
      loadExcluded();
    } else {
      excludedFoods = [];
      excludedInputEl.value = '';
      showExcludedStatus('', false);
      renderExcluded();
    }
  }

  // ==== 個人的な要望の登録(ログイン中の全員。ユーザーごとにサーバーへ保存) ====
  // 調理環境や好み(例: 「コンロが1つなので、ガスコンロを使うレシピは1提案につき1つまで」
  // 「〇〇社のスープポットを使っているので、スープ系はそのスープポットで作れるレシピに」)を自由に書いておくと、
  // レシピを作るたびに自動でAIの条件に加わります(検索のたびに入力する必要はありません)。
  //   ・1行に1つの要望を書く(最大10行・1行150文字。サーバーの上限は読み込み時に受け取る)
  //   ・登録内容はサーバー(GET/PUT /api/user/personal-notes)に保存され、ログインしていれば別の端末でも同じ内容になります
  //   ・文章を打っている途中で保存が走らないよう、「保存」ボタンを押したときに保存します(「使わない食材」は自動保存)
  //   ・レシピ作成のときにブラウザから送る必要はなく、サーバーが本人の要望を読んで使います(functions/_lib/recipe-job.js の startJob)
  //   ・この画面の操作では、AIは呼ばれません(=費用は発生しません)
  // 設定欄(HTML)とスタイルは、「使わない食材」と同じく index.html / style.css を増やさず、ここで作ります。
  // 作れなくても、レシピ作成や他の設定は止めません。
  const NOTES_URL = '/api/user/personal-notes';

  const NOTES_CSS =
    '#personal-notes-section{margin-top:16px;}' +
    '#personal-notes-section textarea{display:block; width:100%; box-sizing:border-box; min-height:150px; padding:12px 14px; resize:vertical;' +
      ' border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px; line-height:1.6;}' +
    '#personal-notes-section .notes-actions{display:flex; align-items:center; gap:12px; margin-top:12px;}' +
    '#personal-notes-section .notes-actions .btn{flex:0 0 auto; min-height:48px;}' +
    '#personal-notes-section .stat-line{margin:0; font-weight:500; color:var(--ink-soft); font-size:12.5px;}' +
    '#personal-notes-section .status-line{text-align:left;}' +
    '.notes-note{margin-top:14px;}';

  const NOTES_HTML =
    '<section class="panel">' +
      '<div class="panel-head"><h3>個人的な要望</h3></div>' +
      '<p class="input-hint">お使いの調理環境や好みを書いておくと、レシピを作るたびに自動で考慮されます。検索のたびに入力する必要はありません。</p>' +
      '<div class="field">' +
        '<label for="notes-input">要望(1行に1つ)</label>' +
        '<textarea id="notes-input" rows="6" autocomplete="off" autocapitalize="none" ' +
          'placeholder="例:&#10;コンロが1つなので、ガスコンロを使うレシピは1提案につき1つまでにする&#10;〇〇社のスープポットを使っているので、スープ系のレシピはそのスープポットで作れるものにする"></textarea>' +
        '<p class="input-hint">1行に1つの要望を書いてください(最大10行・1行150文字まで)。</p>' +
      '</div>' +
      '<div class="notes-actions">' +
        '<button type="button" class="btn btn-secondary" id="btn-notes-save">保存</button>' +
        '<p class="stat-line" id="notes-count"></p>' +
      '</div>' +
      '<p id="notes-status" class="status-line" hidden></p>' +
      '<p class="input-hint notes-note">保存した内容は、次のレシピ作成から反映されます。AIが要望を守れないことも稀にあります。栄養の目標や「使わない食材」など、アプリ側の条件を変えるような内容は反映されません。</p>' +
    '</section>';

  let notesSectionEl = null;
  let notesInputEl = null;
  let notesCountEl = null;
  let notesStatusEl = null;
  let notesSaveBtn = null;

  let notesSaved = [];                                  // サーバーに保存されている内容(未保存の変更があるかの判定用)
  let notesLimits = { maxLines: 10, maxLength: 150 };   // サーバーの上限(読み込み時に更新される)
  let notesSaving = false;                              // 保存の通信の最中か

  function showNotesStatus(msg, isError){
    if(!notesStatusEl) return;
    notesStatusEl.textContent = msg;
    notesStatusEl.hidden = !msg;
    notesStatusEl.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }

  function recordNotesError(err, extra){
    if(typeof logError === 'function') logError('personal-notes', err, extra);
  }

  // 入力欄の文字を、1行=1要望に分ける(空行は除く。行の中の連続する空白は1つにまとめる)
  function splitNotesInput(text){
    return String(text).split(/\r\n|\r|\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  // 行数の表示と、未保存の変更の表示
  function renderNotesMeta(){
    if(!notesCountEl) return;
    const lines = splitNotesInput(notesInputEl.value);
    const dirty = lines.join('\n') !== notesSaved.join('\n');
    notesCountEl.textContent = lines.length + ' / ' + notesLimits.maxLines + ' 行' + (dirty ? '(未保存の変更があります)' : '');
    notesSaveBtn.disabled = notesSaving;
  }

  // 失敗時はサーバーが返した日本語メッセージで例外にする(エラーログにも残す)
  async function notesFetch(options){
    const method = (options && options.method) || 'GET';
    let res;
    try {
      res = await fetch(NOTES_URL, options);
    } catch(e){
      recordNotesError(e, { method: method });
      throw new Error('通信に失敗しました。電波の良い場所でもう一度お試しください。');
    }
    let data = {};
    try { data = await res.json(); } catch(e){ /* 空のレスポンス */ }
    if(!data || typeof data !== 'object') data = {};
    if(!res.ok){
      const err = new Error(data.error || '通信に失敗しました(' + res.status + ')');
      recordNotesError(err, { method: method, status: res.status, serverError: data.error });
      throw err;
    }
    return data;
  }

  function applyNotesData(data){
    if(Array.isArray(data.notes)) notesSaved = data.notes.filter(x => typeof x === 'string');
    if(data.maxLines) notesLimits = { maxLines: data.maxLines, maxLength: data.maxLength || notesLimits.maxLength };
    notesInputEl.value = notesSaved.join('\n'); // サーバーが整えた内容(空行・重複の除去など)に合わせる
  }

  async function loadNotes(){
    if(notesSaving) return; // 保存の最中は、古い内容で上書きしない
    try {
      applyNotesData(await notesFetch());
    } catch(err){
      showNotesStatus(err.message, true);
    }
    renderNotesMeta();
  }

  async function saveNotes(){
    if(notesSaving) return;
    const lines = splitNotesInput(notesInputEl.value);
    // 通信する前に、画面でも上限を確認する(サーバーも同じ確認をする)
    if(lines.length > notesLimits.maxLines){
      showNotesStatus('登録できるのは' + notesLimits.maxLines + '行までです。' + (lines.length - notesLimits.maxLines) + '行ぶん減らしてください。', true);
      return;
    }
    const tooLong = lines.find(l => l.length > notesLimits.maxLength);
    if(tooLong){
      showNotesStatus('「' + tooLong.slice(0, 8) + '…」は長すぎます(1行' + notesLimits.maxLength + '文字までです)。', true);
      return;
    }
    notesSaving = true;
    notesSaveBtn.disabled = true;
    notesSaveBtn.textContent = '保存中…';
    showNotesStatus('保存しています…', false);
    try {
      applyNotesData(await notesFetch({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: lines }),
      }));
      showNotesStatus('保存しました。次のレシピ作成から反映されます。', false);
    } catch(err){
      showNotesStatus(err.message, true); // 失敗しても、入力した文章は消さない
    } finally {
      notesSaving = false;
      notesSaveBtn.textContent = '保存';
      renderNotesMeta();
    }
  }

  // 設定欄とスタイルを作って、操作を結びつける(最初に1回)
  function initPersonalNotes(){
    try {
      if(typeof document.createElement !== 'function' || !document.head) return; // 画面部品が使えない環境では何もしない
      const view = document.getElementById('view-settings');
      if(!view || !adminSectionEl) return;

      const style = document.createElement('style');
      style.id = 'personal-notes-style';
      style.textContent = NOTES_CSS;
      document.head.appendChild(style);

      notesSectionEl = document.createElement('div');
      notesSectionEl.id = 'personal-notes-section';
      notesSectionEl.hidden = true;
      notesSectionEl.innerHTML = NOTES_HTML;
      view.insertBefore(notesSectionEl, adminSectionEl); // 「使わない食材」の下・管理者設定の上

      notesInputEl = document.getElementById('notes-input');
      notesCountEl = document.getElementById('notes-count');
      notesStatusEl = document.getElementById('notes-status');
      notesSaveBtn = document.getElementById('btn-notes-save');

      notesSaveBtn.addEventListener('click', saveNotes);
      notesInputEl.addEventListener('input', renderNotesMeta);
      renderNotesMeta();
    } catch(err){
      notesSectionEl = null; // 作れなかったときは、この機能だけ使わない(ほかの機能は止めない)
      recordNotesError(err, { step: 'init' });
    }
  }

  // ログイン状態が変わるたびに onAuthChanged から呼ばれる。ログイン中だけ設定欄を表示し、登録内容を読み込む
  function onPersonalNotesAuthChanged(){
    if(!notesSectionEl) return;
    const loggedIn = isLoggedIn();
    notesSectionEl.hidden = !loggedIn;
    if(loggedIn){
      loadNotes();
    } else {
      notesSaved = [];
      notesInputEl.value = '';
      showNotesStatus('', false);
      renderNotesMeta();
    }
  }

  // ログイン状態が変わるたびに auth.js から呼ばれる。ログイン中は「使わない食材」「個人的な要望」を、管理者のときだけ管理者用の設定欄を表示する。
  function onAuthChanged(){
    refreshLogControls();
    onExcludedFoodsAuthChanged();
    onPersonalNotesAuthChanged();
    if(isAdmin()){
      adminSectionEl.hidden = false;
      loadAdminSettings();
      loadFoodsStatus();
    } else {
      adminSectionEl.hidden = true;
      grokApiKeyEl.value = '';
      grokStatusEl.hidden = true;
      foodsMsgEl.hidden = true;
    }
  }

  grokTestBtn.addEventListener('click', testGrokConnection);
  grokSaveBtn.addEventListener('click', saveAdminSettings);
  foodsImportBtn.addEventListener('click', importFoods);

  initExcludedFoods();
  initPersonalNotes();
  onAuthChanged();
