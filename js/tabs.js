// ==== タブ切り替え(作る / 保存済み / 設定) ====
// save.js の renderSavedView に依存します。

  const TABS = ['create', 'saved', 'settings'];
  function showTab(name){
    TABS.forEach(t => {
      document.getElementById('tab-' + t).classList.toggle('active', t === name);
      document.getElementById('view-' + t).hidden = (t !== name);
    });
    if(name === 'saved') renderSavedView();
  }
  document.getElementById('tab-create').addEventListener('click', () => showTab('create'));
  document.getElementById('tab-saved').addEventListener('click', () => showTab('saved'));
  document.getElementById('tab-settings').addEventListener('click', () => showTab('settings'));
