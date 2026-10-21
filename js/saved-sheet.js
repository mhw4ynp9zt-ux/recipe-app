// ==== 保存済みタブの「下から出るシート」の共通処理と、レシピの詳細シート ====
// 一覧のタイルをタップすると、このシートに7指標・材料・作り方・栄養の計算内訳と、編集・削除ボタンが出ます。
// 絞り込みシート(saved-filter.js)も、開閉はここの openSavedSheet / closeSavedSheet を使います。
// save.js の escapeSavedHtml / savedMetricValue / savedMetricText / renderSavedNutrition / getSaved / removeSaved、
// config.js の NUTRIENT_METRICS、utils.js の withPieceCount、auth.js の isLoggedIn、recipe-edit.js の openRecipeEditor に依存します
// (どれも呼ぶのはタップされたときなので、読み込み順は save.js より後であればOKです)。
// このファイルは通信をしません(削除は save.js の removeSaved が、編集は recipe-edit.js が行います)。
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

function savedDetailHtml(d, loggedIn){
  const esc = escapeSavedHtml;
  const calories = NUTRIENT_METRICS.find(m => m.id === 'calories');
  // 7指標は、検索・絞り込みの条件に関わらず、いつも全部出す(値の無い指標は「ー」)
  const cell = (m) => '<div class="saved-nutri m-' + esc(m.id) + '"><dt>' + esc(m.label) + '</dt><dd>' + esc(savedMetricText(m, savedMetricValue(d, m.id))) + '</dd></div>';
  const tags = (d.type ? '<span class="dish-type-tag">' + esc(d.type) + '</span>' : '') +
    (typeof classifyTagsHtml === 'function' && typeof effectiveMain === 'function' ? classifyTagsHtml(d) : '');
  return '' +
    '<div class="saved-sheet-grip" aria-hidden="true"></div>' +
    '<header class="saved-sheet-head">' +
      '<h2 id="saved-detail-title">' + esc(d.name) + '</h2>' +
      '<button type="button" class="saved-sheet-close" data-sheet-close aria-label="閉じる">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
    '</header>' +
    '<div class="saved-sheet-scroll">' +
      '<div class="saved-detail-tags">' + tags + '</div>' +
      '<dl class="saved-nutri-grid">' + NUTRIENT_METRICS.filter(m => m.id !== 'calories').map(cell).join('') + (calories ? cell(calories) : '') + '</dl>' +
      '<div class="saved-body">' +
        '<div class="ingredients"><h3>材料</h3><ul>' + (d.ingredients || []).map(x => '<li>' + withPieceCount(esc(x)) + '</li>').join('') + '</ul></div>' +
        '<div class="steps"><h3>作り方</h3><ol>' + (d.steps || []).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol></div>' +
        renderSavedNutrition(d) +
      '</div>' +
    '</div>' +
    '<footer class="saved-sheet-foot">' +
      '<button type="button" class="edit-saved-btn" data-edit-id="' + esc(d.id) + '"' + (loggedIn ? '' : ' disabled') + '>編集</button>' +
      '<button type="button" class="remove-saved-btn" data-remove-id="' + esc(d.id) + '">このレシピを削除</button>' +
    '</footer>' +
    (loggedIn ? '' : '<p class="edit-login-hint saved-sheet-hint">ログインすると編集できます</p>');
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

  wrap.addEventListener('click', (e) => {
    if(e.target.closest('[data-sheet-close]')){ closeSavedSheet(wrap); return; }

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
