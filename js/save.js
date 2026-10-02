// ==== 保存機能 ====
// ログイン中はサーバー(D1)に、未ログイン中はこの端末のlocalStorageに保存します。
// isSaved/toggleSaveは今までどおり同期関数のまま使えるように、
// savedCacheというメモリ上のキャッシュを介して読み書きします。
// utils.js の withPieceCount、config.js の NUTRIENT_METRICS、auth.js の isLoggedIn に依存します。
// replaceSaved は編集シート(recipe-edit.js)が保存に成功したときに呼びます。カードの「編集」ボタンはログイン中だけ押せます。
// 保存済み一覧の「栄養の計算内訳」は、create-ai.js の renderNutritionDetail/renderNutritionWarn を再利用して表示します
// (「作る」タブの結果と同じ見た目。内訳は保存時にレシピ本体と一緒に保存されたデータを使います)。
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
  // 編集シートで保存したレシピ(サーバーが再計算して返したもの)に、キャッシュの同じidの要素を置き換える。
  // 無ければ新規として追加する(一覧は新しいものが上に出る)。サーバーへの保存は呼び出し側が済ませている。
  function replaceSaved(recipe){
    const idx = savedCache.findIndex(r => r.id === recipe.id);
    if(idx >= 0) savedCache[idx] = recipe;
    else savedCache.push(recipe);
    renderSavedView();
    updateSavedCountBadge();
  }
  function updateSavedCountBadge(){
    const count = savedCache.length;
    const badge = document.getElementById('saved-count');
    if(count > 0){ badge.textContent = count; badge.hidden = false; }
    else { badge.hidden = true; }
  }

  // 保存済み一覧の表示用にHTMLの特殊文字を無害化する
  function escapeSavedHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  // ==== 保存済み一覧の検索(レシピ名・食材の部分一致) ====
  // 全角/半角・大文字/小文字・ひらがな/カタカナの違いは区別せずに照合する
  // (例: 「ニンジン」「にんじん」「人参」のうち、前の2つは互いにヒットする)。
  function normalizeSearchText(str){
    return String(str == null ? '' : str)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }
  // 入力をスペース(全角も可)で区切ったキーワードの配列にする。空なら絞り込まない
  function parseSearchQuery(raw){
    return normalizeSearchText(raw).split(/\s+/).filter(Boolean);
  }
  // 全てのキーワードが、レシピ名か材料のどれかに含まれていればヒット(キーワード同士はAND)
  function recipeMatchesQuery(recipe, tokens){
    if(!tokens.length) return true;
    const targets = [recipe.name].concat(Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(normalizeSearchText);
    return tokens.every(tok => targets.some(t => t.includes(tok)));
  }

  function setHiddenById(id, hidden){
    const el = document.getElementById(id);
    if(el) el.hidden = hidden;
  }

  // 保存済みレシピの栄養の計算内訳(「作る」タブと同じ表示)。
  // 内訳(ingredientDetails/nutrition)が保存されていない古いレシピには、その旨を表示する。
  // 注意: ページ読み込み中にcreate-ai.jsより先に呼ばれることがあるため、関数の有無を確認する
  // (その場合は、main.jsの最後の再描画で表示される)
  function renderSavedNutrition(d){
    if(typeof renderNutritionDetail !== 'function') return '';
    const detail = renderNutritionDetail(d);
    if(!detail) return '<p class="saved-nutrition-none">このレシピには栄養の計算内訳が保存されていません。</p>';
    return (typeof renderNutritionWarn === 'function' ? renderNutritionWarn(d) : '') + detail;
  }

  // 一覧は「料理名・種類・栄養」だけを並べ、タップで材料・作り方・栄養の計算内訳を開く(新しく保存したものが上)
  // 検索欄に入力があれば、レシピ名・食材に一致するものだけを表示する。
  function renderSavedView(){
    const all = savedCache;
    const emptyEl = document.getElementById('saved-empty');
    const listEl = document.getElementById('saved-list');
    const inputEl = document.getElementById('saved-search-input');
    const countEl = document.getElementById('saved-search-count');
    const noMatchEl = document.getElementById('saved-no-match');
    const rawQuery = inputEl ? inputEl.value : '';
    const loggedIn = isLoggedIn();
    // 「自作レシピを作る」ボタンの有効・無効もログイン状態に合わせる(recipe-edit.js。ログイン・ログアウトの再描画でここを通る)
    if(typeof refreshNewRecipeButton === 'function') refreshNewRecipeButton();

    if(!all.length){
      emptyEl.hidden = false;
      setHiddenById('saved-search', true);
      setHiddenById('saved-no-match', true);
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    setHiddenById('saved-search', false);
    setHiddenById('saved-search-clear', !rawQuery);

    const tokens = parseSearchQuery(rawQuery);
    const matched = all.filter(d => recipeMatchesQuery(d, tokens));
    if(countEl) countEl.textContent = tokens.length ? matched.length + '件ヒット(保存' + all.length + '件中)' : '';
    if(noMatchEl){
      noMatchEl.hidden = matched.length > 0;
      if(!matched.length) noMatchEl.textContent = '「' + rawQuery.trim() + '」に一致するレシピはありません。レシピ名や食材の一部を入力してみてください。';
    }

    // 再描画しても、開いていたカード・栄養の計算内訳は開いたままにする
    const openCards = new Set();
    const openNutrition = new Set();
    listEl.querySelectorAll('.saved-card[open]').forEach(c => openCards.add(c.dataset.id));
    listEl.querySelectorAll('.saved-card .nutrition-detail[open]').forEach(n => {
      const card = n.closest('.saved-card');
      if(card) openNutrition.add(card.dataset.id);
    });

    listEl.innerHTML = matched.slice().reverse().map(d => `
      <details class="saved-card" data-id="${escapeSavedHtml(d.id)}">
        <summary>
          <div class="saved-card-head">
            <h2>${escapeSavedHtml(d.name)}</h2>
            <span class="dish-type-tag">${escapeSavedHtml(d.type)}</span>
          </div>
          <p class="saved-macro">${NUTRIENT_METRICS.filter(m => d[m.id] != null).map(m => m.label + ' ' + d[m.id] + m.unit).join(' ・ ')}</p>
          <span class="chev" aria-hidden="true"></span>
        </summary>
        <div class="saved-body">
          <div class="ingredients">
            <h3>材料</h3>
            <ul>${(d.ingredients || []).map(x => '<li>' + withPieceCount(escapeSavedHtml(x)) + '</li>').join('')}</ul>
          </div>
          <div class="steps">
            <h3>作り方</h3>
            <ol>${(d.steps || []).map(x => '<li>' + escapeSavedHtml(x) + '</li>').join('')}</ol>
          </div>
          ${renderSavedNutrition(d)}
          <div class="saved-actions">
            <button type="button" class="edit-saved-btn" data-edit-id="${escapeSavedHtml(d.id)}"${loggedIn ? '' : ' disabled'}>編集</button>
            <button type="button" class="remove-saved-btn" data-remove-id="${escapeSavedHtml(d.id)}">このレシピを削除</button>
          </div>
          ${loggedIn ? '' : '<p class="edit-login-hint">ログインすると編集できます</p>'}
        </div>
      </details>
    `).join('');

    listEl.querySelectorAll('.saved-card').forEach(card => {
      if(openCards.has(card.dataset.id)) card.open = true;
      const nd = card.querySelector('.nutrition-detail');
      if(nd && openNutrition.has(card.dataset.id)) nd.open = true;
    });
  }
