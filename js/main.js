// ==== 画面全体のイベント結線(初期化処理) ====
// save.js の removeSaved/updateSavedCountBadge に依存します。

  // 削除ボタン(保存済み一覧、イベント委任)
  document.getElementById('saved-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-saved-btn');
    if(!btn) return;
    removeSaved(btn.dataset.removeId);
  });

  // 保存済みバッジの初期表示
  updateSavedCountBadge();
