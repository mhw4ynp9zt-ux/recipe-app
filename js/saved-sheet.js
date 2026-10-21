// ==== 保存済みタブの「下から出るシート」の共通処理と、レシピの詳細シート ====
// 一覧のタイルをタップすると、このシートに8指標・材料・作り方・栄養の計算内訳と、編集・削除ボタンが出ます。
// 絞り込みシート(saved-filter.js)も、開閉はここの openSavedSheet / closeSavedSheet を使います。
// save.js の escapeSavedHtml / savedMetricValue / savedMetricText / renderSavedNutrition / getSaved / removeSaved、
// config.js の NUTRIENT_METRICS、utils.js の withPieceCount、auth.js の isLoggedIn、recipe-edit.js の openRecipeEditor に依存します
// (どれも呼ぶのはタップされたときなので、読み込み順は save.js より後であればOKです)。
// このファイルは通信をしません(削除は save.js の removeSaved が、編集は recipe-edit.js が、写真は photo.js が、共有は recipe-share.js が行います)。
// 詳細シートは、写真の表示と追加・変更・削除、共有ボタン、取り込み元のリンクも出します。savedDetailHtml の opts.readonly は、共有リンクの表示(recipe-import.js)で使います。
// 見た目は css/saved.css です。

let savedSheetOpener = null; // シートを開いたボタン(閉じたらフォーカスを戻す)
let savedDetailId = null;    // 詳細シートで開いているレシピのid

function savedAppRoot(){
  return typeof document !== 'undefined' ? document.querySelector('.app') : null;
}

// シートを開く。後ろの画面(.app)は操作できないようにして、画面のスクロールも止める
function openSavedSheet(wrap, opener, focusSelector){
  if(!wrap) return;
  wrap.hidden = false;
  savedSheetOpener = opener || null;
  document.body.classList.add('saved-sheet-open');
  const app = savedAppRoot();
  if(app) app.inert = true;
  const target = focusSelector ? wrap.querySelector(focusSelector) : null;
  if(target && typeof target.focus === 'function') target.focus();
}

// シートを閉じる。開いたボタンへフォーカスを戻す(一覧が描き直されていたら、同じidのタイルへ)
function closeSavedSheet(wrap){
  if(!wrap || wrap.hidden) return;
  wrap.hidden = true;
  if(!document.querySelector('.saved-sheet-wrap:not([hidden])')){
    document.body.classList.remove('saved-sheet-open');
    const app = savedAppRoot();
    if(app) app.inert = false;
  }
  const opener = savedSheetOpener;
  savedSheetOpener = null;
  if(!opener) return;
  let el = opener;
  if(!document.contains(el) && opener.dataset && opener.dataset.id){
    el = Array.from(document.querySelectorAll('#saved-list .saved-tile')).find(t => t.dataset.id === opener.dataset.id) || null;
  }
  if(el && !el.disabled && typeof el.focus === 'function') el.focus();
}

function closeAllSavedSheets(){
  if(typeof document === 'undefined') return;
  document.querySelectorAll('.saved-sheet-wrap').forEach(closeSavedSheet);
}

// ---- レシピの詳細シート ----

// 取り込み元URLの表示用(ドメインだけ)。http(s)以外は出さない
function savedSourceHtml(d){
  const esc = escapeSavedHtml;
  if(!d || typeof d.sourceUrl !== 'string' || !/^https?:\/\//i.test(d.sourceUrl)) return '';
  let host = '';
  try { host = new URL(d.sourceUrl).hostname; } catch(e){ return ''; }
  return '<p class="recipe-source">取り込み元: <a href="' + esc(d.sourceUrl) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(host) + '</a></p>';
}

// 料理の写真と、写真・共有の操作(photo.js / recipe-share.js)。読み取り専用(共有リンクの表示)では操作を出さない
function savedPhotoHtml(d, loggedIn, opts){
  const esc = escapeSavedHtml;
  const src = opts && opts.readonly ? (opts.photoSrc || '') : (typeof recipePhotoSrc === 'function' ? recipePhotoSrc(d) : '');
  const img = src ? '<img class="recipe-photo" src="' + esc(src) + '" alt="' + esc(d.name) + 'の写真">' : '';
  if(opts && opts.readonly) return img ? '<div class="recipe-photo-block">' + img + '</div>' : '';
  const pick = '<label class="btn btn-ghost btn-small photo-pick-btn">' + (src ? '写真を変更' : '写真を追加') +
    '<input type="file" accept="image/*" data-photo-input hidden></label>';
  const remove = src ? '<button type="button" class="btn btn-ghost btn-small" data-photo-remove="' + esc(d.id) + '">写真を削除</button>' : '';
  const share = '<button type="button" class="btn btn-ghost btn-small share-saved-btn" data-share-id="' + esc(d.id) + '"' + (loggedIn ? '' : ' disabled') + '>' +
    (d.shareToken ? '共有中' : '共有') + '</button>';
  return '<div class="recipe-photo-block">' + img +
    '<div class="recipe-photo-actions">' + pick + remove + share + '</div>' +
    '<p class="recipe-photo-msg" data-photo-msg role="status"></p>' +
    (loggedIn ? '' : '<p class="edit-login-hint">ログインすると、レシピを共有リンクで送れます(写真はこの端末に保存されます)</p>') +
  '</div>';
}

function savedDetailHtml(d, loggedIn, opts){
  const esc = escapeSavedHtml;
  const readonly = !!(opts && opts.readonly);
  const titleId = (opts && opts.titleId) || 'saved-detail-title';
  const calories = NUTRIENT_METRICS.find(m => m.id === 'calories');
  // 8指標は、検索・絞り込みの条件に関わらず、いつも全部出す(値の無い指標は「ー」)
  const cell = (m) => '<div class="saved-nutri m-' + esc(m.id) + '"><dt>' + esc(m.label) + '</dt><dd>' + esc(savedMetricText(m, savedMetricValue(d, m.id))) + '</dd></div>';
  const tags = (d.type ? '<span class="dish-type-tag">' + esc(d.type) + '</span>' : '') +
    (typeof classifyTagsHtml === 'function' && typeof effectiveMain === 'function' ? classifyTagsHtml(d) : '');
  return '' +
    '<div class="saved-sheet-grip" aria-hidden="true"></div>' +
    '<header class="saved-sheet-head">' +
      '<h2 id="' + titleId + '">' + esc(d.name) + '</h2>' +
      '<button type="button" class="saved-sheet-close" data-sheet-close aria-label="閉じる">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
    '</header>' +
    '<div class="saved-sheet-scroll">' +
      savedPhotoHtml(d, loggedIn, opts) +
      '<div class="saved-detail-tags">' + tags + '</div>' +
      '<dl class="saved-nutri-grid">' + NUTRIENT_METRICS.filter(m => m.id !== 'calories').map(cell).join('') + (calories ? cell(calories) : '') + '</dl>' +
      '<div class="saved-body">' +
        '<div class="ingredients"><h3>材料</h3><ul>' + (d.ingredients || []).map(x => '<li>' + withPieceCount(esc(x)) + '</li>').join('') + '</ul></div>' +
        '<div class="steps"><h3>作り方</h3><ol>' + (d.steps || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol></div>' +
        savedSourceHtml(d) +
        renderSavedNutrition(d) +
      '</div>' +
    '</div>' +
    (readonly ? (opts.footHtml || '') :
    '<footer class="saved-sheet-foot">' +
      '<button type="button" class="edit-saved-btn" data-edit-id="' + esc(d.id) + '"' + (loggedIn ? '' : ' disabled') + '>編集</button>' +
      '<button type="button" class="remove-saved-btn" data-remove-id="' + esc(d.id) + '">このレシピを削除</button>' +
    '</footer>' +
    (loggedIn ? '' : '<p class="edit-login-hint saved-sheet-hint">ログインすると編集できます</p>'));
}

function savedDetailPanel(){
  return document.getElementById('saved-detail-panel');
}

function renderSavedDetail(){
  const panel = savedDetailPanel();
  if(!panel) return false;
  const d = getSaved().find(r => r.id === savedDetailId);
  if(!d) return false;
  // 栄養の計算内訳を開いていたら、描き直しても開いたままにする
  const nutritionOpen = !!panel.querySelector('.nutrition-detail[open]');
  panel.innerHTML = savedDetailHtml(d, isLoggedIn());
  if(nutritionOpen){
    const nd = panel.querySelector('.nutrition-detail');
    if(nd) nd.open = true;
  }
  return true;
}

function openSavedDetail(id, opener){
  const wrap = document.getElementById('saved-detail');
  if(!wrap) return;
  savedDetailId = id;
  if(!renderSavedDetail()){ savedDetailId = null; return; }
  openSavedSheet(wrap, opener, '.saved-sheet-close');
  const scroller = wrap.querySelector('.saved-sheet-scroll');
  if(scroller) scroller.scrollTop = 0;
}

// 一覧が描き直されたとき(編集の保存・削除・ログイン状態の変化)に、開いている詳細シートの中身を最新にする。
// 開いているレシピが無くなっていたら閉じる
function refreshSavedDetail(){
  const wrap = document.getElementById('saved-detail');
  if(!wrap || wrap.hidden) return;
  if(!renderSavedDetail()){
    savedDetailId = null;
    closeSavedSheet(wrap);
  }
}

function setupSavedDetail(){
  if(typeof document === 'undefined' || document.getElementById('saved-detail')) return;
  document.body.insertAdjacentHTML('beforeend',
    '<div id="saved-detail" class="saved-sheet-wrap" hidden>' +
      '<div class="saved-sheet-backdrop" data-sheet-close></div>' +
      '<section id="saved-detail-panel" class="saved-sheet" role="dialog" aria-modal="true" aria-labelledby="saved-detail-title"></section>' +
    '</div>');
  const wrap = document.getElementById('saved-detail');

  // 一覧のタイル → 詳細シート(イベント委任)
  const list = document.getElementById('saved-list');
  if(list){
    list.addEventListener('click', (e) => {
      const tile = e.target.closest('.saved-tile');
      if(tile) openSavedDetail(tile.dataset.id, tile);
    });
  }

  // 写真の追加・差し替え(photo.js)。同じ写真をもう一度選べるように、選んだあとに値を空にする
  wrap.addEventListener('change', (e) => {
    const input = e.target.closest('[data-photo-input]');
    if(!input) return;
    const file = input.files && input.files[0];
    input.value = '';
    if(file && typeof setRecipePhoto === 'function' && savedDetailId) setRecipePhoto(savedDetailId, file);
  });

  wrap.addEventListener('click', (e) => {
    if(e.target.closest('[data-sheet-close]')){ closeSavedSheet(wrap); return; }

    const removePhoto = e.target.closest('[data-photo-remove]');
    if(removePhoto){
      if(typeof removeRecipePhoto === 'function') removeRecipePhoto(removePhoto.dataset.photoRemove);
      return;
    }

    // 共有ボタン。共有リンクはサーバーで作るので、ログイン中だけ押せる(recipe-share.js)
    const shareBtn = e.target.closest('.share-saved-btn');
    if(shareBtn){
      if(shareBtn.disabled || !isLoggedIn()) return;
      if(typeof openShareSheet === 'function') openShareSheet(shareBtn.dataset.shareId, shareBtn);
      return;
    }

    // 編集ボタン。編集シートは recipe-edit.js。ログイン中だけ開く(詳細シートは開いたままにして、保存後に最新の中身へ)
    const edit = e.target.closest('.edit-saved-btn');
    if(edit){
      if(edit.disabled || !isLoggedIn()) return;
      const recipe = getSaved().find(r => r.id === edit.dataset.editId);
      if(recipe) openRecipeEditor({ mode: 'edit', recipe });
      return;
    }

    // 削除ボタン。誤タップで消えないように確認してから削除する
    const remove = e.target.closest('.remove-saved-btn');
    if(remove){
      const titleEl = wrap.querySelector('#saved-detail-title');
      const name = titleEl ? titleEl.textContent : 'このレシピ';
      if(!window.confirm('「' + name + '」を保存済みから削除しますか?')) return;
      savedDetailId = null;
      closeSavedSheet(wrap);
      removeSaved(remove.dataset.removeId);
    }
  });
}

// Escキー(外付けキーボード)で、開いているシートを閉じる。レシピの編集シートが開いているときは、編集シートを優先する
if(typeof document !== 'undefined' && typeof document.addEventListener === 'function'){
  document.addEventListener('keydown', (e) => {
    if(e.key !== 'Escape' || document.body.classList.contains('re-open')) return;
    closeAllSavedSheets();
  });
}
