// ==== 画面全体のイベント結線(初期化処理) ====
// save.js の removeSaved/updateSavedCountBadge/renderSavedView に依存します。

  // 削除ボタン(保存済み一覧、イベント委任)。誤タップで消えないように確認してから削除する
  document.getElementById('saved-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-saved-btn');
    if(!btn) return;
    const card = btn.closest('.saved-card');
    const titleEl = card && card.querySelector('h2');
    const name = titleEl ? titleEl.textContent : 'このレシピ';
    if(!window.confirm('「' + name + '」を保存済みから削除しますか?')) return;
    removeSaved(btn.dataset.removeId);
  });

  // 編集ボタン(保存済み一覧、イベント委任)。編集シートは recipe-edit.js。ログイン中だけ開く
  document.getElementById('saved-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.edit-saved-btn');
    if(!btn || btn.disabled || !isLoggedIn()) return;
    const recipe = getSaved().find(r => r.id === btn.dataset.editId);
    if(recipe) openRecipeEditor({ mode: 'edit', recipe });
  });

  // 保存済み一覧の検索欄(レシピ名・食材の部分一致)。
  // 「保存済み」画面の、タイトルと一覧の間にここで差し込みます(index.html は変更不要)。
  // 欄の表示・非表示と絞り込みは save.js の renderSavedView が行います(保存済みが0件のときは欄ごと隠れます)。
  (function setupSavedSearch(){
    const emptyEl = document.getElementById('saved-empty');
    if(!emptyEl || document.getElementById('saved-search')) return;
    emptyEl.insertAdjacentHTML('beforebegin', `
      <div id="saved-search" class="saved-search" hidden>
        <label class="visually-hidden" for="saved-search-input">保存したレシピをレシピ名・食材で検索</label>
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
          <input type="search" id="saved-search-input" placeholder="レシピ名・食材で検索" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="search">
          <button type="button" class="search-clear" id="saved-search-clear" aria-label="検索をクリア" hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <p class="input-hint" id="saved-search-count" aria-live="polite"></p>
      </div>
    `);
    emptyEl.insertAdjacentHTML('afterend', '<p id="saved-no-match" class="saved-no-match" hidden></p>');

    const input = document.getElementById('saved-search-input');
    const clearBtn = document.getElementById('saved-search-clear');
    // 入力するたびに絞り込む
    input.addEventListener('input', () => renderSavedView());
    // キーボードの「検索」キーで入力を確定してキーボードを閉じる(日本語変換の確定のEnterは除く)
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.isComposing && e.keyCode !== 229){
        e.preventDefault();
        input.blur();
      }
    });
    clearBtn.addEventListener('click', () => {
      input.value = '';
      renderSavedView();
      input.focus();
    });
  })();

  // 系統・役割・主材料のチップと栄養範囲の絞り込み欄(saved-filter.js)。検索欄の直後に差し込む
  if(typeof setupSavedFilter === 'function') setupSavedFilter();

  // 保存済みバッジの初期表示
  updateSavedCountBadge();
  // 起動中、create-ai.js の読み込みや検索欄の差し込みより先に一覧が描画されていても、
  // 栄養の計算内訳と検索欄が出るように、最後にもう一度描画する
  renderSavedView();
