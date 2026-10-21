// ==== 画面全体のイベント結線(初期化処理) ====
// save.js の updateSavedCountBadge/renderSavedView、saved-sheet.js の setupSavedDetail に依存します。

  // 一覧のタイルをタップして開く詳細シート(材料・作り方・栄養・編集・削除)。保存済み画面の下から出る(saved-sheet.js)
  if(typeof setupSavedDetail === 'function') setupSavedDetail();

  // 保存済み一覧の検索欄(レシピ名・食材の部分一致)。
  // 「保存済み」画面の、タイトル行と一覧の間にここで差し込みます。
  // 欄の表示・非表示と絞り込みは save.js の renderSavedView が行います。普段は隠れていて、タイトル行の虫めがねボタンで開きます
  // (入力があるときは常に出ます。保存済みが0件のときは欄ごと隠れます)。
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

    // 虫めがねボタン。開いているときに押すと、入力を消して閉じる(隠れた条件が残らないように)
    const toggle = document.getElementById('saved-search-toggle');
    if(toggle) toggle.addEventListener('click', () => {
      const open = !(savedSearchOpen || input.value);
      if(!open) input.value = '';
      savedSearchOpen = open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      renderSavedView();
      if(open) input.focus();
    });
  })();

  // 系統・役割・主材料のチップと栄養範囲の絞り込み欄(saved-filter.js)。検索欄の直後に差し込む
  if(typeof setupSavedFilter === 'function') setupSavedFilter();

  // 保存済みバッジの初期表示
  updateSavedCountBadge();
  // 起動中、create-ai.js の読み込みや検索欄の差し込みより先に一覧が描画されていても、
  // 栄養の計算内訳と検索欄が出るように、最後にもう一度描画する
  renderSavedView();
