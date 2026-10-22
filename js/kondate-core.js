// ==== 「今日」「週」「目標」画面の共通部品 ====
// このファイルは画面の部品だけで、AIは呼びません。AIにつながる実行ボタンは js/week.js と js/meal-photo.js にあり、
// どちらも実行前に confirmAi() で「今月の残り回数」を見せて、利用者がタップして確認してから呼びます。
(function(){
  const K = window.Kondate = {};

  K.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 通信。失敗しても例外にせず { ok, status, data } で返す(data.error は画面に出してよい日本語)
  K.api = async function(method, url, body){
    try {
      const init = { method };
      if(body !== undefined){ init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
      const res = await fetch(url, init);
      let data = null;
      try { data = await res.json(); } catch(e) { /* JSONでない応答 */ }
      return { ok: res.ok, status: res.status, data: data || {} };
    } catch(e) {
      return { ok: false, status: 0, data: { error: '通信できませんでした。電波の良いところで、もう一度お試しください' } };
    }
  };

  K.loggedIn = () => typeof isLoggedIn === 'function' && isLoggedIn();

  // 日付(日本時間)
  K.todayJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  K.addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  K.weekStart = (day) => { const dow = new Date(day + 'T00:00:00Z').getUTCDay(); return K.addDays(day, -((dow + 6) % 7)); };
  K.dayLabel = (day) => { const d = new Date(day + 'T00:00:00Z'); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + '日月火水木金土'[d.getUTCDay()] + ')'; };

  K.LABEL = { calories: 'カロリー', protein: 'たんぱく質', veg: '野菜', fat: '脂質', salt: '塩分', fiber: '食物繊維', carbs: '糖質', carbohydrate: '炭水化物' };
  K.UNIT = { calories: 'kcal' };
  K.unit = (id) => K.UNIT[id] || 'g';
  K.SLOTS = [['breakfast', '朝'], ['lunch', '昼'], ['dinner', '夜'], ['snack', '間食']];
  K.fmt = (v) => (Math.round(Number(v) * 10) / 10).toLocaleString('ja-JP');

  // ゲージ。数字を隠す設定のときは、バーと言葉だけにする。「あと◯g」のような差の数字は出さない。
  K.gaugeHtml = function(g, showNumbers){
    const id = g.id;
    const num = showNumbers && g.target
      ? '<span class="k-gauge-num">' + K.fmt(g.total) + ' / 目安 ' + K.fmt(g.target.value) + K.unit(id) + (g.target.kind === 'min' ? ' 以上' : g.target.kind === 'max' ? ' 未満' : '') + '</span>'
      : '';
    return '<div class="k-gauge k-' + K.esc(g.status) + '" data-metric="' + K.esc(id) + '">' +
      '<div class="k-gauge-head"><span class="k-gauge-label">' + K.esc(K.LABEL[id] || id) + '</span><span class="k-gauge-text">' + K.esc(g.text || '') + '</span></div>' +
      '<div class="k-bar" role="img" aria-label="' + K.esc((K.LABEL[id] || id) + ' ' + (g.text || '')) + '"><div class="k-bar-fill" style="width:' + Math.round((g.fill || 0) * 100) + '%"></div>' +
      '<div class="k-bar-mark" style="left:' + Math.round((g.mark || 0) * 100) + '%"></div></div>' + num + '</div>';
  };

  // AIを使う前の確認。今月の残り回数を見せて、「使う」をタップしたときだけ true を返す(閉じる・やめるは false)。
  K.confirmAi = function({ title, body, remaining, cap, unit, okLabel }){
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'k-sheet-wrap';
      wrap.innerHTML = '<div class="k-sheet" role="dialog" aria-modal="true" aria-label="' + K.esc(title) + '">' +
        '<h3>' + K.esc(title) + '</h3><p>' + K.esc(body) + '</p>' +
        '<p class="k-quota" data-ai-confirm>今月の残り: <strong>' + K.esc(remaining) + '</strong> / ' + K.esc(cap) + unit + '</p>' +
        '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="cancel">やめる</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok"' + (remaining <= 0 ? ' disabled' : '') + '>' + K.esc(okLabel || '使う') + '</button></div></div>';
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.addEventListener('click', (e) => {
        const a = e.target.closest('[data-act]');
        if(a) done(a.dataset.act === 'ok');
        else if(e.target === wrap) done(false);
      });
      document.body.appendChild(wrap);
      const ok = wrap.querySelector('[data-act="ok"]');
      (ok && !ok.disabled ? ok : wrap.querySelector('[data-act="cancel"]')).focus();
    });
  };

  K.needLogin = (el, what) => {
    el.innerHTML = '<div class="notice"><p><strong>ログインが必要です。</strong>' + K.esc(what) + 'は、パスキーでログインすると使えます。</p>' +
      '<button type="button" class="btn btn-small" data-goto="settings">ログインへ</button></div>';
  };
  K.unavailable = (el) => { el.innerHTML = '<p class="note">この機能は、準備が整い次第つかえるようになります(サーバーの更新待ちです)。</p>'; };

  // 他の画面(設定の目標など)が変わったことを知らせ合う
  K.refreshers = [];
  K.refreshAll = () => K.refreshers.forEach((fn) => { try { fn(); } catch(e) { /* 1つの失敗で止めない */ } });
  const prevAuth = window.onAuthChanged;
  window.onAuthChanged = function(){ if(typeof prevAuth === 'function') prevAuth.apply(this, arguments); K.refreshAll(); };
})();
