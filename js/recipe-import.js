// ==== レシピの取り込み(共有リンク・レシピのURL・貼り付けテキスト) ====
// 保存済み画面のタイトル行の「取り込む」ボタンから開きます。
//   ・このアプリの共有リンク(…/?share=トークン): 中身を確認して「保存済みに入れる」。ログインなしでも、この端末に保存できる
//   ・レシピサイトのURL: サーバーがページの schema.org(JSON-LD)を読んで、編集シートの下書きにする(ログイン中だけ)
//   ・貼り付けたテキスト(【材料】【作り方】の見出しつき。SNSの投稿など): 同じく下書きにする(ログイン中だけ)
// 【重要】AI(xAI・有料)は一切使いません。読み取りはサーバーの決まったルールだけで、呼ぶAPIは /api/recipes/import-url・import-text と /api/shared・/api/recipes/import だけです。
// 取り込んだURL・テキストの下書きは、グラム数が読み取れなかった食材が空欄のまま編集シートに出ます(栄養は、グラム数を入れると計算されます)。
// 共有リンクで開いたとき(?share=…)は、起動時に共有されたレシピの確認シートを自動で開きます(main.js から handleShareLinkOnLoad)。
// save.js の escapeSavedHtml / replaceSaved / addImportedRecipe / getSaved、saved-sheet.js の openSavedSheet / closeSavedSheet / savedDetailHtml、
// recipe-edit.js の openRecipeEditor、auth.js の isLoggedIn に依存します。

const SHARE_TOKEN_RE = /^[a-f0-9]{32}$/;
let importState = { tab: 'url', busy: false, message: '', error: false };
let sharedState = null; // { token, status: 'loading'|'ready'|'error', recipe, photoUrl, message, saving }

// 入力が、このアプリの共有リンク(または共有トークンそのもの)ならトークンを返す。そうでなければ ''
function extractShareToken(input){
  const v = String(input || '').trim();
  if(SHARE_TOKEN_RE.test(v)) return v;
  try {
    const u = new URL(v, location.href);
    if(u.origin === location.origin){
      const t = u.searchParams.get('share') || '';
      if(SHARE_TOKEN_RE.test(t)) return t;
    }
  } catch(e){ /* URLとして読めない */ }
  return '';
}

// ---------- 取り込みシート ----------

function importSheetHtml(st){
  const esc = escapeSavedHtml;
  const isUrl = st.tab === 'url';
  const input = isUrl
    ? '<label class="share-label" for="import-url">共有リンク・レシピのURL</label>' +
      '<input type="url" id="import-url" class="share-url" inputmode="url" placeholder="https://…" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go">' +
      '<p class="share-note">このアプリの共有リンクのほか、クックパッドなどレシピサイトのURLも取り込めます(サイトによっては読み取れないことがあります。その場合は「テキスト」から取り込めます)。</p>'
    : '<label class="share-label" for="import-text">レシピの文章</label>' +
      '<textarea id="import-text" class="import-text" rows="9" placeholder="【材料】&#10;鶏もも肉 250g&#10;醤油 大さじ2&#10;【作り方】&#10;①鶏肉を焼く。&#10;②たれを加えて煮詰める。"></textarea>' +
      '<p class="share-note">InstagramやXの投稿などをコピーして貼り付けてください。「材料」「作り方」の見出しで区切って読み取ります。</p>';
  const needLogin = !isLoggedIn();
  return '' +
    '<div class="saved-sheet-grip" aria-hidden="true"></div>' +
    '<header class="saved-sheet-head">' +
      '<h2 id="import-title">レシピを取り込む</h2>' +
      '<button type="button" class="saved-sheet-close" data-sheet-close aria-label="閉じる">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
    '</header>' +
    '<div class="saved-sheet-scroll share-body">' +
      '<div class="saved-seg import-seg" role="group" aria-label="取り込み方法">' +
        '<button type="button" data-import-tab="url" aria-pressed="' + (isUrl ? 'true' : 'false') + '">リンク(URL)</button>' +
        '<button type="button" data-import-tab="text" aria-pressed="' + (isUrl ? 'false' : 'true') + '">テキスト</button>' +
      '</div>' +
      input +
      '<p class="share-note is-error" data-import-msg role="alert"' + (st.message ? '' : ' hidden') + '>' + esc(st.message) + '</p>' +
      (needLogin ? '<p class="edit-login-hint" data-import-login>共有リンクはログインなしでも取り込めます。URL・テキストからの取り込みは、ログインすると使えます。</p>' : '') +
      '<button type="button" class="btn btn-primary" data-import-run>取り込む</button>' +
    '</div>';
}

function renderImportSheet(){
  const panel = document.getElementById('import-panel');
  if(panel) panel.innerHTML = importSheetHtml(importState);
}

function setImportMessage(text, isError){
  importState.message = text || '';
  importState.error = !!isError;
  const el = document.querySelector('#import-panel [data-import-msg]');
  if(!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

function openImportSheet(opener){
  const wrap = document.getElementById('import-sheet');
  if(!wrap) return;
  importState = { tab: 'url', busy: false, message: '', error: false }; // 開くたびに「リンク(URL)」から始める
  renderImportSheet();
  openSavedSheet(wrap, opener, '#import-url');
}

function setImportBusy(busy){
  importState.busy = busy;
  const btn = document.querySelector('#import-panel [data-import-run]');
  if(btn){ btn.disabled = busy; btn.textContent = busy ? '読み取っています…' : '取り込む'; }
}

// 下書き(サーバーの返答)を、編集シートに渡す形にして開く
function openDraftInEditor(data, fallbackSource){
  const d = data.draft;
  const lines = d.ingredients.map(i => i.line).filter(Boolean);
  closeSavedSheet(document.getElementById('import-sheet'));
  openRecipeEditor({
    mode: 'new',
    draft: {
      name: d.name,
      type: d.type || '',
      sourceUrl: d.sourceUrl || fallbackSource || '',
      ingredients: d.ingredients.map(i => ({ name: i.name, grams: i.grams == null ? '' : String(i.grams), line: i.line })),
      steps: d.steps,
    },
    importInfo: { lines, warnings: data.warnings || [], source: d.sourceUrl || fallbackSource || '' },
  });
}

async function postImport(path, payload){
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let body = null;
  try { body = await res.json(); } catch(e){ /* JSONでない応答 */ }
  if(!res.ok){
    const err = new Error((body && body.error) || '取り込めませんでした。時間をおいてもう一度お試しください');
    err.status = res.status;
    if(res.status === 401) err.message = 'ログインが切れました。ログインし直してください';
    throw err;
  }
  return body;
}

async function runImport(){
  if(importState.busy) return;
  setImportMessage('', false);
  if(importState.tab === 'url'){
    const el = document.getElementById('import-url');
    const value = el ? el.value.trim() : '';
    if(!value){ setImportMessage('URLを入力してください', true); return; }
    const token = extractShareToken(value);
    if(token){
      closeSavedSheet(document.getElementById('import-sheet'));
      openSharedRecipe(token);
      return;
    }
    if(!isLoggedIn()){ setImportMessage('レシピサイトのURLからの取り込みは、ログインすると使えます', true); return; }
    setImportBusy(true);
    try { openDraftInEditor(await postImport('/api/recipes/import-url', { url: value }), value); }
    catch(e){
      if(typeof recordSaveError === 'function') recordSaveError('import-url', e, { status: e && e.status });
      setImportMessage(e.message, true);
    }
    setImportBusy(false);
  } else {
    const el = document.getElementById('import-text');
    const value = el ? el.value : '';
    if(!value.trim()){ setImportMessage('レシピの文章を貼り付けてください', true); return; }
    if(!isLoggedIn()){ setImportMessage('テキストからの取り込みは、ログインすると使えます', true); return; }
    setImportBusy(true);
    try { openDraftInEditor(await postImport('/api/recipes/import-text', { text: value }), ''); }
    catch(e){
      if(typeof recordSaveError === 'function') recordSaveError('import-text', e, { status: e && e.status });
      setImportMessage(e.message, true);
    }
    setImportBusy(false);
  }
}

// ---------- 共有されたレシピの確認シート ----------

function sharedFootHtml(st){
  const saveBtn = st.status === 'ready'
    ? '<button type="button" class="btn btn-primary" data-shared-save' + (st.saving ? ' disabled' : '') + '>' + (st.saving ? '保存しています…' : '自分の保存済みに入れる') + '</button>'
    : '';
  return '<footer class="saved-sheet-foot shared-foot">' + saveBtn +
    '<button type="button" class="btn btn-secondary" data-sheet-close>閉じる</button></footer>' +
    (st.status === 'ready' && !isLoggedIn() ? '<p class="edit-login-hint saved-sheet-hint">ログインしていないので、この端末に保存されます。</p>' : '');
}

function sharedSheetHtml(st){
  const esc = escapeSavedHtml;
  if(st.status === 'ready'){
    return savedDetailHtml(st.recipe, isLoggedIn(), { readonly: true, photoSrc: st.photoUrl || '', titleId: 'shared-title', footHtml: sharedFootHtml(st) });
  }
  const text = st.status === 'loading' ? '共有されたレシピを読み込んでいます…' : (st.message || '共有されたレシピを開けませんでした');
  return '' +
    '<div class="saved-sheet-grip" aria-hidden="true"></div>' +
    '<header class="saved-sheet-head"><h2 id="shared-title">共有されたレシピ</h2>' +
      '<button type="button" class="saved-sheet-close" data-sheet-close aria-label="閉じる">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button></header>' +
    '<div class="saved-sheet-scroll share-body"><p class="share-note' + (st.status === 'error' ? ' is-error' : '') + '" role="' + (st.status === 'error' ? 'alert' : 'status') + '">' + esc(text) + '</p></div>';
}

function renderSharedSheet(){
  const panel = document.getElementById('shared-panel');
  if(panel && sharedState) panel.innerHTML = sharedSheetHtml(sharedState);
}

async function openSharedRecipe(token){
  const wrap = document.getElementById('shared-sheet');
  if(!wrap) return;
  sharedState = { token, status: 'loading', recipe: null, photoUrl: '', message: '', saving: false };
  renderSharedSheet();
  openSavedSheet(wrap, null, '.saved-sheet-close');
  try {
    const res = await fetch('/api/shared/' + token);
    let body = null;
    try { body = await res.json(); } catch(e){ /* JSONでない応答 */ }
    if(!sharedState || sharedState.token !== token) return;
    if(!res.ok || !body || !body.recipe){
      const err = new Error((body && body.error) || '共有されたレシピを開けませんでした');
      err.status = res.status;
      throw err;
    }
    sharedState = { token, status: 'ready', recipe: Object.assign({ id: 'shared-preview' }, body.recipe), photoUrl: body.photoUrl || '', message: '', saving: false };
  } catch(e){
    if(!sharedState || sharedState.token !== token) return;
    if(typeof recordSaveError === 'function' && e && e.status !== 404) recordSaveError('shared-open', e, { status: e && e.status });
    sharedState = { token, status: 'error', recipe: null, photoUrl: '', message: e && e.message ? e.message : '共有されたレシピを開けませんでした', saving: false };
  }
  renderSharedSheet();
}

function blobToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('写真を読み込めませんでした'));
    r.readAsDataURL(blob);
  });
}

function newLocalRecipeId(){
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  return 'r-' + rnd;
}

async function saveSharedRecipe(){
  const st = sharedState;
  if(!st || st.status !== 'ready' || st.saving) return;
  st.saving = true;
  renderSharedSheet();
  try {
    if(isLoggedIn()){
      const body = await postImport('/api/recipes/import', { token: st.token });
      replaceSaved(body.recipe);
    } else {
      const recipe = Object.assign({}, st.recipe, { id: newLocalRecipeId() });
      if(st.photoUrl){
        try {
          const pr = await fetch(st.photoUrl);
          if(pr.ok) recipe.photoData = await blobToDataUrl(await pr.blob());
        } catch(e){ /* 写真だけ取り込めなくてもレシピは保存する */ }
      }
      if(!addImportedRecipe(recipe)){
        delete recipe.photoData;
        if(!addImportedRecipe(recipe)) throw new Error('この端末の保存容量がいっぱいです');
      }
    }
    closeSavedSheet(document.getElementById('shared-sheet'));
    sharedState = null;
    clearShareParam();
    const tab = document.getElementById('tab-saved');
    if(tab) tab.click();
  } catch(e){
    if(typeof recordSaveError === 'function') recordSaveError('shared-save', e, { status: e && e.status });
    st.saving = false;
    st.status = 'ready';
    renderSharedSheet();
    const panel = document.getElementById('shared-panel');
    if(panel) panel.insertAdjacentHTML('beforeend', '<p class="share-note is-error shared-error" role="alert">' + escapeSavedHtml(e && e.message ? e.message : '保存できませんでした') + '</p>');
  }
}

function clearShareParam(){
  try {
    const u = new URL(location.href);
    if(u.searchParams.has('share')){
      u.searchParams.delete('share');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    }
  } catch(e){ /* 無視 */ }
}

// 起動時: 共有リンクから開かれていたら、確認シートを開く
function handleShareLinkOnLoad(){
  let token = '';
  try { token = new URL(location.href).searchParams.get('share') || ''; } catch(e){ return; }
  if(!SHARE_TOKEN_RE.test(token)) { if(token) clearShareParam(); return; }
  openSharedRecipe(token);
}

// ログイン状態が変わったとき(save.js の reloadSaved から)。開いている確認シートの「保存先」の文言を合わせる
function onSavedReloaded(){
  if(sharedState && sharedState.status === 'ready' && !sharedState.saving) renderSharedSheet();
}

// ---------- 画面への結線 ----------

function setupImportUi(){
  if(typeof document === 'undefined' || document.getElementById('import-sheet')) return;
  const head = document.querySelector('#view-saved .saved-head');
  if(head && !document.getElementById('import-recipe-btn')){
    const toggle = document.getElementById('saved-search-toggle');
    const html = '<button type="button" class="saved-import-btn" id="import-recipe-btn" aria-label="レシピを取り込む" title="レシピを取り込む" aria-haspopup="dialog">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>';
    if(toggle) toggle.insertAdjacentHTML('beforebegin', html); else head.insertAdjacentHTML('beforeend', html);
  }
  document.body.insertAdjacentHTML('beforeend',
    '<div id="import-sheet" class="saved-sheet-wrap" hidden>' +
      '<div class="saved-sheet-backdrop" data-sheet-close></div>' +
      '<section id="import-panel" class="saved-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title"></section>' +
    '</div>' +
    '<div id="shared-sheet" class="saved-sheet-wrap" hidden>' +
      '<div class="saved-sheet-backdrop" data-sheet-close></div>' +
      '<section id="shared-panel" class="saved-sheet" role="dialog" aria-modal="true" aria-labelledby="shared-title"></section>' +
    '</div>');

  const btn = document.getElementById('import-recipe-btn');
  if(btn) btn.addEventListener('click', () => openImportSheet(btn));

  const importWrap = document.getElementById('import-sheet');
  importWrap.addEventListener('click', (e) => {
    if(e.target.closest('[data-sheet-close]')){ closeSavedSheet(importWrap); return; }
    const tab = e.target.closest('[data-import-tab]');
    if(tab){
      importState.tab = tab.dataset.importTab;
      importState.message = '';
      renderImportSheet();
      const f = document.getElementById(importState.tab === 'url' ? 'import-url' : 'import-text');
      if(f) f.focus();
      return;
    }
    if(e.target.closest('[data-import-run]')) runImport();
  });
  importWrap.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && e.target && e.target.id === 'import-url'){
      e.preventDefault();
      runImport();
    }
  });

  const sharedWrap = document.getElementById('shared-sheet');
  sharedWrap.addEventListener('click', (e) => {
    if(e.target.closest('[data-sheet-close]')){ closeSavedSheet(sharedWrap); sharedState = null; clearShareParam(); return; }
    if(e.target.closest('[data-shared-save]')) saveSharedRecipe();
  });
}

if(typeof document !== 'undefined' && document.body) setupImportUi();
