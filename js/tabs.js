// ==== タブ切り替え(作る / 今日 / 週 / 保存済み / 設定) ====
// save.js の renderSavedView に依存します。
// 画面下のタブバーのほか、data-goto="タブ名" を付けたボタン(お知らせの「ログインへ」など)からも切り替えられます。

  const TABS = ['create', 'today', 'week', 'saved', 'settings'];
  function showTab(name){
    TABS.forEach(t => {
      const tab = document.getElementById('tab-' + t);
      tab.classList.toggle('active', t === name);
      tab.setAttribute('aria-selected', t === name ? 'true' : 'false');
      document.getElementById('view-' + t).hidden = (t !== name);
    });
    if(name === 'saved') renderSavedView();
    if(name === 'today' && window.Kondate) window.Kondate.showToday();
    if(name === 'week' && window.Kondate) window.Kondate.showWeek();
    window.scrollTo(0, 0);
  }
  document.getElementById('tab-create').addEventListener('click', () => showTab('create'));
  document.getElementById('tab-today').addEventListener('click', () => showTab('today'));
  document.getElementById('tab-week').addEventListener('click', () => showTab('week'));
  document.getElementById('tab-saved').addEventListener('click', () => showTab('saved'));
  document.getElementById('tab-settings').addEventListener('click', () => showTab('settings'));

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-goto]');
    if(btn && TABS.includes(btn.dataset.goto)) showTab(btn.dataset.goto);
  });
