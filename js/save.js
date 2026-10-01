// ==== 保存機能 ====
// ログイン中はサーバー(D1)に、未ログイン中はこの端末のlocalStorageに保存します。
// isSaved/toggleSaveは今までどおり同期関数のまま使えるように、
// savedCacheというメモリ上のキャッシュを介して読み書きします。
// utils.js の withPieceCount、config.js の NUTRIENT_METRICS、auth.js の isLoggedIn に依存します。
// サーバーへの保存・削除・取得の失敗は、error-log.js の logError で管理者向けエラーログに記録します
// (画面の動きは変えません。従来どおり失敗しても画面上は何も出ません)。

  // 「作る」タブでAIが生成したレシピを保持する配列(保存ボタン押下時に元データを参照するため)
  const recipes = [];

  const SAVE_KEY = 'recipeRouletteSavedV1'; // 未ログイン時(この端末だけの保存)用のキー

  let savedCache = []; // 画面表示に使う「保存済み」リストのメモリキャッシュ

  function getLocalSaved(){
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e){ return []; }
  }
  function setLocalSaved(list){
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); } catch(e){ /* 保存できない環境では無視 */ }
  }

  // 管理者向けエラーログへ記録する(error-log.js が無い環境では何もしない)
  function recordSaveError(step, err, extra){
    if(typeof logError === 'function') logError('save-' + step, err, extra);
  }
  // サーバーが失敗(HTTPエラー)を返したときの記録。サーバーのエラーメッセージも添える
  async function recordServerFailure(step, res, extra){
    let serverError;
    try { serverError = (await res.json()).error; } catch(e){ /* JSONでない応答 */ }
    recordSaveError(step, new Error('サーバーが失敗を返しました(' + res.status + ')'),
      Object.assign({ status: res.status, serverError: serverError }, extra));
  }

  async function fetchServerSaved(){
    const res = await fetch('/api/recipes');
    if(!res.ok){
      const err = new Error('failed to fetch recipes');
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.recipes || [];
  }
  async function saveToServer(recipe){
    const res = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    });
    if(!res.ok) await recordServerFailure('save', res, { recipeId: recipe && recipe.id });
  }
  async function deleteFromServer(id){
    const res = await fetch('/api/recipes/' + encodeURIComponent(id), { method: 'DELETE' });
    if(!res.ok) await recordServerFailure('delete', res, { recipeId: id });
  }

  // ログイン状態が変わった時・アプリ起動時に呼ぶ。savedCacheを最新化して画面に反映する。
  async function reloadSaved(){
    if(isLoggedIn()){
      try { savedCache = await fetchServerSaved(); }
      catch(e){ recordSaveError('fetch', e, { status: e && e.status }); savedCache = []; }
    } else {
      savedCache = getLocalSaved();
    }
    renderSavedView();
    updateSavedCountBadge();
  }

  // ログイン直後に1回だけ呼ぶ。未ログイン中にこの端末に貯めていた保存済みレシピを
  // サーバー側のアカウントへ引き継ぐ(引き継いだらこの端末のlocalStorageは空にする)。
  async function migrateLocalSavedToServer(){
    const local = getLocalSaved();
    if(!local.length) return;
    for(const r of local){
      try { await saveToServer(r); } catch(e){ /* 失敗した分は次回また試す */ recordSaveError('migrate', e, { recipeId: r && r.id }); }
    }
    setLocalSaved([]);
  }

  function getSaved(){
    return savedCache;
  }
  function isSaved(id){
    return savedCache.some(r => r.id === id);
  }
  function toggleSave(id){
    const recipe = recipes.find(r => r.id === id);
    if(!recipe) return;
    const idx = savedCache.findIndex(r => r.id === id);
    if(idx >= 0){
      savedCache.splice(idx, 1);
      if(isLoggedIn()) deleteFromServer(id).catch(e => recordSaveError('delete', e, { recipeId: id }));
      else setLocalSaved(savedCache);
    } else {
      savedCache.push(recipe);
      if(isLoggedIn()) saveToServer(recipe).catch(e => recordSaveError('save', e, { recipeId: id }));
      else setLocalSaved(savedCache);
    }
    updateSavedCountBadge();
  }
  function removeSaved(id){
    savedCache = savedCache.filter(r => r.id !== id);
    if(isLoggedIn()) deleteFromServer(id).catch(e => recordSaveError('delete', e, { recipeId: id }));
    else setLocalSaved(savedCache);
    renderSavedView();
    updateSavedCountBadge();
  }
  function updateSavedCountBadge(){
    const count = savedCache.length;
    const badge = document.getElementById('saved-count');
    if(count > 0){ badge.textContent = count; badge.hidden = false; }
    else { badge.hidden = true; }
  }
  function renderSavedView(){
    const list = savedCache;
    const emptyEl = document.getElementById('saved-empty');
    const listEl = document.getElementById('saved-list');
    if(!list.length){
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    listEl.innerHTML = list.map(d => `
      <div class="saved-card">
        <div class="saved-card-head">
          <h2>${d.name}</h2>
          <span class="dish-type-tag">${d.type}</span>
        </div>
        <p class="saved-macro">${NUTRIENT_METRICS.filter(m => d[m.id] != null).map(m => m.label + ' ' + d[m.id] + m.unit).join(' ・ ')}</p>
        <div class="ingredients">
          <h3>材料</h3>
          <ul>${d.ingredients.map(x => '<li>' + withPieceCount(x) + '</li>').join('')}</ul>
        </div>
        <div class="steps">
          <h3>作り方</h3>
          <ol>${d.steps.map(x => '<li>' + x + '</li>').join('')}</ol>
        </div>
        <button class="remove-saved-btn" data-remove-id="${d.id}">削除する</button>
      </div>
    `).join('');
  }
