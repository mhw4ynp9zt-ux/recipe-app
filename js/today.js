// ==== 「今日」タブ:食べたものの記録・今日のバランス・次の食事のおすすめ・週の振り返り ====
// 呼ぶAPI: /api/today /api/meals /api/week/review /api/recipes(いずれもAIは呼びません)。写真からの記録は js/meal-photo.js。
// 文言は「足りない」を避け、「まだ伸ばせます」「ちょうど良い」の言い方にそろえています(サーバー側 kondate-messages.js と同じ方針)。
(function(){
  const K = window.Kondate;
  const root = document.getElementById('view-today');
  if(!root) return;
  let day = K.todayJst();
  let state = null;
  let savedRecipes = null;

  function slotDefault(){
    const h = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
  }

  function render(){
    if(!K.loggedIn()){ K.needLogin(root, '食事の記録とバランス'); return; }
    if(!state){ root.innerHTML = '<p class="note">読み込んでいます…</p>'; return; }
    if(state.unavailable){ K.unavailable(root); return; }
    const isToday = day === K.todayJst();
    const b = state.balance;
    const head = '<div class="k-head"><button type="button" class="k-nav" data-act="prev" aria-label="前の日"' + (day <= K.addDays(K.todayJst(), -34) ? ' disabled' : '') + '>‹</button>' +
      '<h2 class="view-title">' + (isToday ? '今日' : K.esc(K.dayLabel(day))) + 'のバランス</h2>' +
      '<button type="button" class="k-nav" data-act="next" aria-label="次の日"' + (isToday ? ' disabled' : '') + '>›</button></div>';
    let gauges = '';
    if(!state.hasTargets) gauges = '<div class="notice"><p>目標の目安を設定すると、ここにバランスが出ます。</p><button type="button" class="btn btn-small" data-act="goto-targets">目標を設定する</button></div>';
    else if(b.empty) gauges = '<p class="note k-empty">' + K.esc(b.empty) + '</p>';
    else gauges = '<div class="k-gauges">' + b.gauges.map((g) => K.gaugeHtml(g, b.showNumbers)).join('') + '</div>' +
      (b.showNumbers ? '' : '<p class="k-okline">' + K.esc('バランス良好') + '</p>') +
      (b.approxText ? '<p class="input-hint">' + K.esc(b.approxText) + '</p>' : '') + '<p class="input-hint">' + K.esc(b.help) + '</p>';

    const meals = K.SLOTS.map(([id, label]) => {
      const list = state.meals.filter((m) => m.slot === id);
      if(!list.length) return '';
      return '<div class="k-slot"><h4>' + label + '</h4>' + list.map((m) => '<div class="k-meal" data-id="' + K.esc(m.id) + '"><span class="k-meal-name">' + K.esc(m.name) + (m.approx ? ' <span class="k-tag">おおよそ</span>' : '') + '</span>' +
        (b.showNumbers && m.nutrition.calories != null ? '<span class="k-meal-kcal">' + K.fmt(m.nutrition.calories) + 'kcal</span>' : '') +
        '<button type="button" class="k-x" data-act="del" aria-label="' + K.esc(m.name) + 'の記録を消す">×</button></div>').join('') + '</div>';
    }).join('');

    let next = '';
    if(state.next) next = '<section class="panel k-next"><h3>' + K.esc(state.next.title) + '</h3>' +
      (state.next.picks.length ? state.next.picks.map((p) => '<div class="k-pick"><span>' + K.esc(p.name) + '</span><button type="button" class="btn btn-small btn-secondary" data-act="log-pick" data-id="' + K.esc(p.recipeId) + '">食べた</button></div>').join('') : '<p class="input-hint">無理に足さなくて大丈夫です。</p>') + '</section>';

    root.innerHTML = head + '<section class="panel">' + gauges + '</section>' +
      '<section class="panel"><div class="panel-head"><h3>食べたもの</h3><button type="button" class="btn btn-small btn-primary" data-act="add">＋ 記録する</button></div>' +
      (meals || '<p class="input-hint">まだ記録がありません。</p>') + '</section>' + next + '<div id="k-review"></div>';
    loadReview();
  }

  async function load(){
    if(!K.loggedIn()){ render(); return; }
    const r = await K.api('GET', '/api/today?day=' + day);
    state = r.ok && r.data && r.data.balance ? r.data : (r.status === 503 ? { unavailable: true } : { meals: [], balance: { gauges: [], showNumbers: true }, hasTargets: false, error: r.data.error });
    render();
  }

  async function loadReview(){
    const box = document.getElementById('k-review');
    if(!box || day !== K.todayJst()) return;
    const r = await K.api('GET', '/api/week/review');
    if(!r.ok || !box.isConnected) return;
    const v = r.data;
    let h = '<section class="panel k-review"><h3>' + K.esc(v.title) + '</h3>';
    if(v.few) h += '<p>' + K.esc(v.few) + '</p>';
    else {
      h += '<ul class="k-positives">' + v.positives.map((p) => '<li>' + K.esc(p) + '</li>').join('') + '</ul>';
      if(v.summary) h += '<p>' + K.esc(v.summary) + '</p>';
      if(v.hint){
        h += '<div class="k-hint"><p>' + K.esc(v.hint.text) + '</p>' +
          (v.hint.action ? '<button type="button" class="btn btn-small btn-secondary" data-act="favor" data-metric="' + K.esc(v.hint.action.metric) + '">来週の提案に入れる</button>' : '') + '</div>';
      }
    }
    h += '<p class="input-hint">' + v.notes.map(K.esc).join(' ') + '</p></section>';
    box.innerHTML = h;
  }

  async function ensureRecipes(){
    if(savedRecipes) return savedRecipes;
    const r = await K.api('GET', '/api/recipes');
    savedRecipes = r.ok && Array.isArray(r.data.recipes) ? r.data.recipes : [];
    return savedRecipes;
  }

  async function post(body){
    const r = await K.api('POST', '/api/meals', Object.assign({ day }, body));
    if(!r.ok){ alertMsg(r.data.error || '記録できませんでした'); return false; }
    await load();
    return true;
  }
  function alertMsg(msg){ const el = document.createElement('p'); el.className = 'k-toast'; el.setAttribute('role', 'status'); el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 4000); }
  K.toast = alertMsg;

  // 記録するシート(保存済みレシピ / 食材のグラム / かんたん入力 / 写真)
  async function openAdd(){
    const recipes = await ensureRecipes();
    const wrap = document.createElement('div');
    wrap.className = 'k-sheet-wrap';
    const slotOpts = K.SLOTS.map(([id, l]) => '<option value="' + id + '"' + (id === slotDefault() ? ' selected' : '') + '>' + l + '</option>').join('');
    wrap.innerHTML = '<div class="k-sheet" role="dialog" aria-modal="true" aria-label="食べたものを記録"><h3>食べたものを記録</h3>' +
      '<div class="field"><label for="k-slot">いつ</label><select id="k-slot">' + slotOpts + '</select></div>' +
      '<div class="k-seg" role="tablist"><button type="button" class="active" data-mode="recipe">保存したレシピ</button><button type="button" data-mode="ingredients">食材から</button><button type="button" data-mode="quick">かんたん</button><button type="button" data-mode="photo">写真</button></div>' +
      '<div class="k-mode" data-mode="recipe">' + (recipes.length
        ? '<div class="field"><label for="k-recipe">レシピ</label><select id="k-recipe">' + recipes.map((r) => '<option value="' + K.esc(r.id) + '">' + K.esc(r.name) + '</option>').join('') + '</select></div>' +
          '<div class="field"><label for="k-portion">量</label><select id="k-portion"><option value="0.5">0.5人前</option><option value="1" selected>1人前</option><option value="1.5">1.5人前</option><option value="2">2人前</option><option value="3">3人前</option></select></div>'
        : '<p class="input-hint">保存したレシピがまだありません。「食材から」や「かんたん」で記録できます。</p>') + '</div>' +
      '<div class="k-mode" data-mode="ingredients" hidden><div class="field"><label for="k-iname">料理名</label><input id="k-iname" type="text" maxlength="60" placeholder="例: 朝ごはん"></div>' +
      '<div class="field"><label>食材とグラム</label><div id="k-irows"></div><button type="button" class="btn btn-small btn-ghost" data-act="add-row">＋ 食材を足す</button></div></div>' +
      '<div class="k-mode" data-mode="quick" hidden><div class="field"><label for="k-qname">料理名</label><input id="k-qname" type="text" maxlength="60" placeholder="例: コンビニのおにぎり"></div>' +
      ['calories:カロリー(kcal)', 'protein:たんぱく質(g)', 'fat:脂質(g)', 'carbs:糖質(g)', 'salt:塩分(g)', 'fiber:食物繊維(g)', 'veg:野菜(g)'].map((x) => { const [id, l] = x.split(':'); return '<div class="field k-q"><label for="k-q-' + id + '">' + l + '</label><input id="k-q-' + id + '" data-q="' + id + '" type="number" inputmode="decimal" min="0" step="any"></div>'; }).join('') +
      '<p class="input-hint">わかる項目だけで大丈夫です。おおよその値として記録されます。</p></div>' +
      '<div class="k-mode" data-mode="photo" hidden><p class="input-hint">写真から料理と量をAIが推定します(おおよその値です)。写真は保存されません。</p>' +
      '<button type="button" class="btn btn-secondary" data-act="photo">写真を選ぶ</button></div>' +
      '<p class="k-sheet-msg" id="k-sheet-msg" role="status"></p>' +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button><button type="button" class="btn btn-primary" data-act="save">記録する</button></div></div>';
    document.body.appendChild(wrap);
    let mode = 'recipe';
    const q = (s) => wrap.querySelector(s);
    const addRow = () => { const row = document.createElement('div'); row.className = 'k-irow'; row.innerHTML = '<input type="text" maxlength="40" placeholder="食材名" aria-label="食材名" data-f="name"><input type="number" inputmode="decimal" min="1" max="3000" placeholder="g" aria-label="グラム" data-f="grams">'; q('#k-irows').appendChild(row); };
    addRow(); addRow();
    const setMode = (m) => { mode = m; wrap.querySelectorAll('.k-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m)); wrap.querySelectorAll('.k-mode').forEach((el) => { el.hidden = el.dataset.mode !== m; }); q('[data-act="save"]').hidden = m === 'photo'; };
    wrap.addEventListener('click', async (e) => {
      const seg = e.target.closest('.k-seg button'); if(seg){ setMode(seg.dataset.mode); return; }
      const a = e.target.closest('[data-act]');
      if(!a){ if(e.target === wrap) wrap.remove(); return; }
      const msg = q('#k-sheet-msg');
      if(a.dataset.act === 'close'){ wrap.remove(); }
      else if(a.dataset.act === 'add-row'){ addRow(); }
      else if(a.dataset.act === 'photo'){ wrap.remove(); if(window.KondatePhoto) window.KondatePhoto.start({ day, slot: q('#k-slot') ? q('#k-slot').value : slotDefault(), reload: load }); }
      else if(a.dataset.act === 'save'){
        const slot = q('#k-slot').value; let body;
        if(mode === 'recipe'){ if(!q('#k-recipe')){ msg.textContent = '保存したレシピがありません'; return; } body = { slot, recipeId: q('#k-recipe').value, portion: Number(q('#k-portion').value) }; }
        else if(mode === 'ingredients'){
          const list = [...wrap.querySelectorAll('.k-irow')].map((r) => ({ name: r.querySelector('[data-f="name"]').value.trim(), grams: Number(r.querySelector('[data-f="grams"]').value) })).filter((x) => x.name || x.grams);
          body = { slot, name: q('#k-iname').value.trim() || '食事', ingredients: list };
        } else {
          const nutrition = {}; wrap.querySelectorAll('[data-q]').forEach((i) => { if(i.value !== '') nutrition[i.dataset.q] = Number(i.value); });
          body = { slot, name: q('#k-qname').value.trim(), nutrition };
        }
        a.disabled = true;
        const r = await K.api('POST', '/api/meals', Object.assign({ day }, body));
        a.disabled = false;
        if(r.ok){ wrap.remove(); await load(); } else msg.textContent = r.data.error || '記録できませんでした';
      }
    });
  }

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]'); if(!a) return;
    const act = a.dataset.act;
    if(act === 'prev'){ day = K.addDays(day, -1); state = null; load(); }
    else if(act === 'next'){ day = K.addDays(day, 1); if(day > K.todayJst()) day = K.todayJst(); state = null; load(); }
    else if(act === 'add'){ openAdd(); }
    else if(act === 'del'){
      const id = a.closest('.k-meal').dataset.id;
      const r = await K.api('DELETE', '/api/meals/' + encodeURIComponent(id));
      if(r.ok) load(); else alertMsg(r.data.error || '消せませんでした');
    }
    else if(act === 'log-pick'){ await post({ slot: slotDefault(), recipeId: a.dataset.id, portion: 1 }); }
    else if(act === 'goto-targets'){ document.getElementById('tab-settings').click(); const t = document.getElementById('panel-targets'); if(t) t.scrollIntoView(); }
    else if(act === 'favor'){
      const w = await K.api('GET', '/api/week');
      if(w.ok && w.data.plan){
        const r = await K.api('PATCH', '/api/week/plan/' + encodeURIComponent(w.data.plan.id), { action: 'favor', metric: a.dataset.metric });
        alertMsg(r.ok ? '来週の提案に入れました' : (r.data.error || '保存できませんでした'));
      } else alertMsg('「週」タブで週プランを作るときに、反映されます');
    }
  });

  K.showToday = () => { day = K.todayJst(); state = null; load(); };
  K.refreshers.push(() => { if(!root.hidden) { state = null; load(); } });
  render();
})();
