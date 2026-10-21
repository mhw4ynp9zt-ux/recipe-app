// ==== 保存機能 ====
// ログイン中はサーバー(D1)に、未ログイン中はこの端末のlocalStorageに保存します。
// isSaved/toggleSaveは今までどおり同期関数のまま使えるように、
// savedCacheというメモリ上のキャッシュを介して読み書きします。
// utils.js の withPieceCount、config.js の NUTRIENT_METRICS、auth.js の isLoggedIn に依存します。
// replaceSaved は編集シート(recipe-edit.js)が保存に成功したときに呼びます。詳細シートの「編集」ボタンはログイン中だけ押せます。
// 保存済み一覧はタイルを2列に並べ、タップで開く詳細シート(saved-sheet.js)に7指標・材料・作り方・栄養の計算内訳を出します。
// 保存済み一覧の「栄養の計算内訳」は、create-ai.js の renderNutritionDetail/renderNutritionWarn を再利用して表示します
// (「作る」タブの結果と同じ見た目。内訳は保存時にレシピ本体と一緒に保存されたデータを使います)。
// サーバーへの保存・削除・取得の失敗は、error-log.js の logError で管理者向けエラーログに記録します
// (画面の動きは変えません。従来どおり失敗しても画面上は何も出ません)。

  // 「作る」タブでAIが生成したレシピを保持する配列(保存ボタン押下時に元データを参照するため)
  const recipes = [];

  const SAVE_KEY = 'recipeRouletteSavedV1'; // 未ログイン時(この端末だけの保存)用のキー

  let savedCache = []; // 画面表示に使う「保存済み」リストのメモリキャッシュ
  let savedSearchOpen = false; // 検索欄を開いているか(虫めがねボタンで切り替える。入力があるときは常に出る)

  function getLocalSaved(){
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e){ return []; }
  }
  // 端末に保存する。入りきらない(容量オーバー)ときなどは false を返す(写真つきのレシピは大きいため)
  function setLocalSaved(list){
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); return true; }
    catch(e){ /* 保存できない環境では無視 */ return false; }
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
    // 写真(photoData)は別のAPIで送る。表示用の付け足しはレシピ本体に含めない
    const body = Object.assign({}, recipe);
    delete body.photoData; delete body.photoUrl; delete body.shareToken;
    const res = await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    // ログイン状態が変わった(または起動時の確認が済んだ)ので、開いている共有レシピの確認シートの文言を合わせる(recipe-import.js)
    if(typeof onSavedReloaded === 'function') onSavedReloaded();
  }

  // ログイン直後に1回だけ呼ぶ。未ログイン中にこの端末に貯めていた保存済みレシピを
  // サーバー側のアカウントへ引き継ぐ(引き継いだらこの端末のlocalStorageは空にする)。
  async function migrateLocalSavedToServer(){
    const local = getLocalSaved();
    if(!local.length) return;
    for(const r of local){
      try { await saveToServer(r); } catch(e){ /* 失敗した分は次回また試す */ recordSaveError('migrate', e, { recipeId: r && r.id }); }
    }
    // 端末内の写真もサーバーへ引き継ぐ(photo.js)
    if(typeof migrateLocalPhotos === 'function') await migrateLocalPhotos(local);
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
    if(idx >= 0){
      // サーバーが返すレシピには、写真のURL・共有トークンが付かないので、今のキャッシュのものを引き継ぐ
      const old = savedCache[idx];
      ['photoUrl', 'photoData', 'shareToken'].forEach(k => { if(old[k] && recipe[k] === undefined) recipe[k] = old[k]; });
      savedCache[idx] = recipe;
    }
    else savedCache.push(recipe);
    renderSavedView();
    updateSavedCountBadge();
  }
  // 取り込んだレシピを、保存済みに追加する(共有リンクの取り込み)。ログイン中はサーバー側の保存が済んだものを渡す。
  // 未ログインのときは、この端末に保存する(入りきらなければ false)
  function addImportedRecipe(recipe){
    savedCache.push(recipe);
    if(!isLoggedIn() && !setLocalSaved(savedCache)){
      savedCache.pop();
      return false;
    }
    renderSavedView();
    updateSavedCountBadge();
    return true;
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


  // 栄養値。recipe.nutrition[id](成分表から計算した全指標)を優先し、無ければ recipe[id]。どちらも無ければ null(0 は値あり)
  function savedMetricValue(d, id){
    if(d && d.nutrition && typeof d.nutrition[id] === 'number' && isFinite(d.nutrition[id])) return d.nutrition[id];
    if(d && typeof d[id] === 'number' && isFinite(d[id])) return d[id];
    return null;
  }
  // 画面に出す文字。値が無い指標は「ー」(0 は 0g と出す)
  function savedMetricText(m, v){
    return v === null ? 'ー' : v + m.unit;
  }

  // タイルに出す数値の文字。digits=小数の桁数(幅に収めるため、塩分・食物繊維は1、ほかは0)。
  // 値が無いときは「ー」。詳細シートには従来どおり小数のまま出る
  function savedTileNum(v, unit, digits){
    if(v === null) return 'ー';
    const k = Math.pow(10, digits || 0);
    return String(Math.round(v * k) / k) + unit;
  }

  // タイルに出す6項目(この順)。どれも同じ形の色付きチップで出す
  const SAVED_TILE_CHIPS = [
    { id: 'protein', label: 'たんぱく質', digits: 0 },
    { id: 'fat',     label: '脂質',       digits: 0 },
    { id: 'carbs',   label: '糖質',       digits: 0 },
    { id: 'salt',    label: '塩分',       digits: 1 },
    { id: 'fiber',   label: '食物繊維',   digits: 1 },
    { id: 'veg',     label: '野菜',       digits: 0 },
  ];

  // 一覧のタイル1枚。「種類・料理名・カロリー・6項目のチップ(たんぱく質・脂質・糖質・塩分・食物繊維・野菜)」を出し、
  // 材料・作り方・栄養の計算内訳は、タップで開くレシピの詳細シート(saved-sheet.js)に出す
  function savedTileHtml(d){
    const esc = escapeSavedHtml;
    const kcal = savedMetricValue(d, 'calories');
    const chip = (m) => '<span class="saved-tile-chip m-' + m.id + '">' + m.label + ' ' + savedTileNum(savedMetricValue(d, m.id), 'g', m.digits) + '</span>';
    const photoSrc = typeof recipePhotoSrc === 'function' ? recipePhotoSrc(d) : '';
    return '<button type="button" class="saved-tile" data-id="' + esc(d.id) + '" aria-haspopup="dialog">' +
      (photoSrc ? '<span class="saved-tile-photo"><img src="' + esc(photoSrc) + '" alt="" loading="lazy" decoding="async"></span>' : '') +
      (d.type ? '<span class="saved-tile-kind">' + esc(d.type) + '</span>' : '') +
      '<span class="saved-tile-title">' + esc(d.name) + '</span>' +
      '<span class="saved-tile-kcal"><b>' + (kcal === null ? 'ー' : esc(kcal)) + '</b><small>kcal</small></span>' +
      '<span class="saved-tile-chips">' + SAVED_TILE_CHIPS.map(chip).join('') + '</span>' +
    '</button>';
  }

  // 一覧はタイルを2列に並べる(既定は新しく保存したものが上。並べ替えは saved-filter.js の savedSort)。
  // 検索欄・絞り込みの条件に一致するものだけを表示する。
  function renderSavedView(){
    const all = savedCache;
    const emptyEl = document.getElementById('saved-empty');
    const listEl = document.getElementById('saved-list');
    const inputEl = document.getElementById('saved-search-input');
    const countEl = document.getElementById('saved-search-count');
    const noMatchEl = document.getElementById('saved-no-match');
    const rawQuery = inputEl ? inputEl.value : '';
    // 「自作レシピを作る」ボタンの有効・無効もログイン状態に合わせる(recipe-edit.js。ログイン・ログアウトの再描画でここを通る)
    if(typeof refreshNewRecipeButton === 'function') refreshNewRecipeButton();

    if(!all.length){
      emptyEl.hidden = false;
      setHiddenById('saved-search', true);
      setHiddenById('saved-search-toggle', true);
      setHiddenById('saved-total', true);
      setHiddenById('saved-filter', true);
      setHiddenById('saved-no-match', true);
      listEl.innerHTML = '';
      if(typeof closeAllSavedSheets === 'function') closeAllSavedSheets();
      return;
    }
    emptyEl.hidden = true;
    // 検索欄は、虫めがねボタンで開いたとき、または入力があるときだけ見せる
    setHiddenById('saved-search', !(savedSearchOpen || rawQuery));
    setHiddenById('saved-search-toggle', false);
    setHiddenById('saved-filter', false);
    setHiddenById('saved-search-clear', !rawQuery);

    const tokens = parseSearchQuery(rawQuery);
    const textMatch = d => recipeMatchesQuery(d, tokens);
    // 絞り込み(系統・役割・主材料・栄養範囲)は recipe-classify.js / saved-filter.js が読み込まれているときだけ
    // (読み込み前に呼ばれても従来どおり検索だけで動く)
    const filtering = typeof applyRecipeFilters === 'function' && typeof savedFilters !== 'undefined' && !!savedFilters;
    const filterActive = filtering && hasActiveFilters(savedFilters);
    let matched, missingExcluded = 0;
    if(filtering){
      const r = applyRecipeFilters(all, savedFilters, textMatch);
      matched = r.matched;
      missingExcluded = r.missingExcluded;
    } else {
      matched = all.filter(textMatch);
    }
    const narrowed = tokens.length > 0 || filterActive;
    const totalEl = document.getElementById('saved-total');
    if(totalEl){
      totalEl.hidden = false;
      totalEl.textContent = narrowed ? matched.length + '/' + all.length + '件' : all.length + '件';
    }
    if(countEl){
      let text = narrowed ? matched.length + '件ヒット(保存' + all.length + '件中)' : '';
      if(missingExcluded > 0) text += (text ? '。' : '') + '栄養値のない' + missingExcluded + '件は除外';
      if(filterActive && rangeConflict(savedFilters)) text += (text ? '。' : '') + '最小が最大より大きい指標があります';
      countEl.textContent = text;
    }
    if(noMatchEl){
      noMatchEl.hidden = matched.length > 0;
      if(!matched.length){
        noMatchEl.textContent = filterActive
          ? '条件に一致するレシピはありません。条件を減らすか、「詳しく絞り込む」の「クリア」を押してみてください。'
          : '「' + rawQuery.trim() + '」に一致するレシピはありません。レシピ名や食材の一部を入力してみてください。';
      }
    }
    if(typeof renderSavedFilter === 'function') renderSavedFilter();

    const sortId = typeof savedSort === 'string' ? savedSort : 'new';
    const ordered = typeof sortRecipes === 'function' ? sortRecipes(matched, sortId) : matched.slice().reverse();
    listEl.innerHTML = ordered.map(savedTileHtml).join('');

    // 詳細シートを開いたまま再描画された(編集の保存・削除など)ときは、中身も最新にする
    if(typeof refreshSavedDetail === 'function') refreshSavedDetail();
  }
