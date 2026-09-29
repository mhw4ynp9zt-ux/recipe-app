// ==== 「設定」タブ:外部AI(Grok)の管理(管理者専用) ====
// 管理者としてログインしているときだけ表示されます(auth.js の renderAuthUI から onAuthChanged() が呼ばれます)。
// APIキー・モデル・1日の上限はサーバー(/api/admin/ai-settings など)に保存され、この端末には保存しません。
// 表示・非表示はあくまで見た目の制御で、実際の権限チェックはすべてサーバー側で行われます。
// auth.js の isAdmin() に依存します。

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

  // 管理者用APIを呼ぶ共通処理。失敗時はサーバーが返した日本語メッセージで例外にする。
  async function adminFetch(url, options){
    const res = await fetch(url, options);
    let data = {};
    try { data = await res.json(); } catch(e){ /* 空のレスポンス */ }
    if(!res.ok) throw new Error(data.error || '通信に失敗しました(' + res.status + ')');
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
      showGrokStatus(err.message, true);
    } finally {
      grokSaveBtn.disabled = false;
      grokSaveBtn.textContent = '設定を保存';
    }
  }

  // ログイン状態が変わるたびに auth.js から呼ばれる。管理者のときだけ設定欄を表示する。
  function onAuthChanged(){
    if(isAdmin()){
      adminSectionEl.hidden = false;
      loadAdminSettings();
    } else {
      adminSectionEl.hidden = true;
      grokApiKeyEl.value = '';
      grokStatusEl.hidden = true;
    }
  }

  grokTestBtn.addEventListener('click', testGrokConnection);
  grokSaveBtn.addEventListener('click', saveAdminSettings);

  onAuthChanged();
