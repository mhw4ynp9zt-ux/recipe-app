// ==== 画面全体のイベント結線(初期化処理) ====
// save.js の removeSaved/updateSavedCountBadge に依存します。

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

  // 保存済みバッジの初期表示
  updateSavedCountBadge();
