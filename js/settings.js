// ==== 「設定」タブ:外部AI(Grok)のAPIキー・使用モデルの管理 ====
// config.js の DEFAULT_GROK_MODEL に依存します。
// ここで保存する値(localStorage)は create-ai.js からも参照されます。

  const GROK_SETTINGS_KEY = 'recipeRouletteGrokSettingsV1';

  const grokApiKeyEl = document.getElementById('grok-api-key');
  const grokModelEl = document.getElementById('grok-model');
  const grokTestBtn = document.getElementById('btn-grok-test');
  const grokTestStatusEl = document.getElementById('grok-test-status');

  // モデルのプルダウンの中身を入れ替える(selectedIdがあればそれを選択状態にする)
  function setModelOptions(modelIds, selectedId){
    grokModelEl.innerHTML = modelIds.map(id =>
      `<option value="${id}"${id === selectedId ? ' selected' : ''}>${id}</option>`
    ).join('');
  }

  function loadGrokSettings(){
    let saved = null;
    try {
      const raw = localStorage.getItem(GROK_SETTINGS_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch(e){ /* 復元できない環境では無視 */ }
    grokApiKeyEl.value = (saved && saved.apiKey) || '';
    const savedModel = (saved && saved.model) || DEFAULT_GROK_MODEL;
    // まだモデル一覧を取得していない状態でも、前回保存した(または初期値の)モデル名を選択肢として表示しておく
    setModelOptions([savedModel], savedModel);
  }
  function saveGrokSettings(){
    try {
      localStorage.setItem(GROK_SETTINGS_KEY, JSON.stringify({
        apiKey: grokApiKeyEl.value.trim(),
        model: grokModelEl.value,
      }));
    } catch(e){ /* 保存できない環境では無視 */ }
  }

  function showGrokTestStatus(msg, isError){
    grokTestStatusEl.textContent = msg;
    grokTestStatusEl.hidden = false;
    grokTestStatusEl.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }

  async function testGrokConnection(){
    const apiKey = grokApiKeyEl.value.trim();
    if(!apiKey){
      showGrokTestStatus('APIキーを入力してください。', true);
      return;
    }
    grokTestBtn.disabled = true;
    grokTestBtn.textContent = '接続中…';
    showGrokTestStatus('接続を確認しています…', false);
    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      });
      if(!response.ok) throw new Error('status ' + response.status);
      const data = await response.json();
      const ids = (data.data || []).map(m => m.id).filter(Boolean).sort();
      if(!ids.length) throw new Error('no models');
      const current = grokModelEl.value;
      const selected = ids.includes(current) ? current : (ids.find(id => id.indexOf('grok-4') === 0) || ids[0]);
      setModelOptions(ids, selected);
      saveGrokSettings();
      showGrokTestStatus('接続に成功しました(' + ids.length + '件のモデルが見つかりました)', false);
    } catch(err){
      showGrokTestStatus('接続に失敗しました。APIキーをご確認ください。', true);
    } finally {
      grokTestBtn.disabled = false;
      grokTestBtn.textContent = '接続テスト・モデルを取得';
    }
  }

  grokTestBtn.addEventListener('click', testGrokConnection);
  grokApiKeyEl.addEventListener('change', saveGrokSettings);
  grokModelEl.addEventListener('change', saveGrokSettings);

  loadGrokSettings();
