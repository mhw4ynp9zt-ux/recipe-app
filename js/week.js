// ==== 「週」タブ:1週間の夕食プラン・買い物リスト ====
// ★「夕食を考える」ボタン(/api/week/plan/:id/run)だけが、AI(有料)につながります。★
//   ・押すと、まず confirmAi()(今月の残り回数を見せる確認)が出て、「使う」をタップしたときだけ呼びます。
//   ・プランの枠づくり・外食にする・作らない日・保存済みレシピへの差し替え・買い物のチェックは、AIを使いません。
// kondate-core.js の Kondate、save.js(レシピの保存)に依存します。
(function(){
  const K = window.Kondate;
  const root = document.getElementById('view-week');
  if(!root) return;
  let ws = K.weekStart(K.todayJst());
  let data = null;
  let pane = 'plan';
  let draft = null;       // 新しく作るときの、日ごとの選択 { 日付: 'cook'|'outing'|'off' }
  let showNumbers = true;
  let recipes = null;

  const KIND = { cook: '作る', outing: '外食', off: '作らない' };

  function ensureDraft(){
    if(draft && draft._ws === ws) return;
    draft = { _ws: ws };
    const today = K.todayJst();
    for(let i = 0; i < 7; i++){ const d = K.addDays(ws, i); draft[d] = d < today ? 'off' : 'cook'; }
  }

  function summaryHtml(s){
    if(!s.cookedDays) return '';
    const a = s.average;
    const nums = showNumbers ? '<p class="input-hint">1日あたりの平均(作る日): ' + ['calories', 'protein', 'fiber', 'salt'].filter((k) => a[k] != null).map((k) => K.LABEL[k] + ' ' + K.fmt(a[k]) + K.unit(k)).join(' ・ ') + '</p>' : '';
    return '<div class="k-summary"><p>' + s.cookedDays + '日ぶんの夕食が決まっています。' + (s.outingDays ? '外食の日は、ほかの日で整います。' : '') + '</p>' + nums + '</div>';
  }

  function dayCard(d){
    const label = K.dayLabel(d.date);
    const today = K.todayJst();
    const past = d.date < today;
    let body = '';
    if(d.kind === 'outing') body = '<p class="k-day-note">外食の予定。ほかの日で栄養を整えられます。</p><div class="k-day-actions"><button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="cook" data-date="' + d.date + '">作る日にする</button></div>';
    else if(d.kind === 'off') body = '<p class="k-day-note">作らない日</p>' + (past ? '' : '<div class="k-day-actions"><button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="cook" data-date="' + d.date + '">作る日にする</button></div>');
    else if(d.recipe){
      const r = d.recipe;
      body = '<p class="k-day-name">' + K.esc(r.name) + (r.source === 'ai' ? ' <span class="k-tag">AIの提案</span>' : '') + '</p>' +
        '<p class="k-day-meta">' + [r.minutes ? K.esc(r.minutes) + '分' : '', r.nutrition && r.nutrition.calories != null && showNumbers ? K.fmt(r.nutrition.calories) + 'kcal' : ''].filter(Boolean).join(' ・ ') + '</p>' +
        '<div class="k-day-actions">' + (r.source === 'ai' ? '<button type="button" class="btn btn-small btn-secondary" data-act="save-recipe" data-date="' + d.date + '">保存する</button>' : '') +
        '<button type="button" class="btn btn-small btn-ghost" data-act="swap" data-date="' + d.date + '">別の料理に</button>' +
        '<button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="outing" data-date="' + d.date + '">外食にする</button></div>';
    } else body = '<p class="k-day-note">まだ決まっていません</p><div class="k-day-actions"><button type="button" class="btn btn-small btn-ghost" data-act="swap" data-date="' + d.date + '">保存したレシピから</button>' +
      '<button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="outing" data-date="' + d.date + '">外食にする</button></div>';
    return '<div class="k-day k-kind-' + d.kind + '" data-date="' + d.date + '"><h4>' + K.esc(label) + (d.date === today ? ' <span class="k-tag">今日</span>' : '') + '</h4>' + body + '</div>';
  }

  function planHtml(){
    const p = data.plan;
    const pending = (p.pending || []).filter((x) => p.days.some((d) => d.date === x && d.kind === 'cook' && !d.recipe)).length;
    const aiBtn = pending ? '<div class="k-ai-box"><button type="button" class="btn btn-primary" data-act="run">決まっていない' + pending + '日の夕食を考える</button>' +
      '<p class="input-hint">AIを使います(今月の残り ' + data.quota.remaining + ' / ' + data.quota.cap + '回)。押すと確認が出ます。</p></div>' : '';
    const err = p.status === 'error' ? '<p class="note k-err">うまく作れませんでした。もう一度お試しください(うまくいかなかった分の回数は戻っています)。</p>' : '';
    return summaryHtml(data.summary) + err + aiBtn + '<div class="k-days">' + p.days.map(dayCard).join('') + '</div>' +
      '<div class="btn-row"><button type="button" class="btn btn-ghost btn-small" data-act="delete-plan">この週のプランを消す</button></div>';
  }

  function shoppingHtml(){
    const s = data.shopping;
    if(!data.plan) return '<p class="note">先に週プランを作ると、ここに買い物リストが出ます。</p>';
    const secs = s.sections.map((sec) => '<section class="panel k-shop"><h3>' + K.esc(sec.label) + '</h3>' + sec.items.map((i) =>
      '<label class="k-check' + (i.checked ? ' done' : '') + '"><input type="checkbox" data-act="check" data-key="' + K.esc(i.key) + '"' + (i.checked ? ' checked' : '') + '> <span>' + K.esc(i.name) + '</span> <span class="k-amount">' + K.esc(i.amount) + '</span></label>').join('') + '</section>').join('');
    const have = s.have.length ? '<section class="panel"><h3>家にあるもの</h3><p class="input-hint">買うものから外しています。</p>' + s.have.map((i) => '<span class="k-chip">' + K.esc(i.name) + '</span>').join('') + '</section>' : '';
    return (secs || '<p class="note">買うものはありません。</p>') + have +
      '<section class="panel"><h3>家にある食材を登録</h3><p class="input-hint">登録した食材は、買い物リストから外れます(調味料など)。</p><div id="k-pantry"></div>' +
      '<div class="k-irow"><input type="text" id="k-pantry-in" maxlength="30" placeholder="例: しょうゆ" aria-label="家にある食材"><button type="button" class="btn btn-small btn-secondary" data-act="pantry-add">追加</button></div></section>';
  }

  function render(){
    if(!K.loggedIn()){ K.needLogin(root, '週プランと買い物リスト'); return; }
    if(!data){ root.innerHTML = '<p class="note">読み込んでいます…</p>'; return; }
    if(data.unavailable){ K.unavailable(root); return; }
    const thisWs = K.weekStart(K.todayJst());
    const head = '<div class="k-head"><button type="button" class="k-nav" data-act="wprev" aria-label="前の週"' + (ws <= thisWs ? ' disabled' : '') + '>‹</button>' +
      '<h2 class="view-title">' + (ws === thisWs ? '今週' : ws === K.addDays(thisWs, 7) ? '来週' : K.dayLabel(ws) + 'の週') + 'の夕食</h2>' +
      '<button type="button" class="k-nav" data-act="wnext" aria-label="次の週"' + (ws >= K.addDays(thisWs, 7) ? ' disabled' : '') + '>›</button></div>';
    let body;
    if(!data.plan){
      ensureDraft();
      body = '<section class="panel"><h3>1週間の夕食を考えます</h3><p class="input-hint">外食や作らない日を選んでから、押してください。外食の日は、ほかの日で栄養が整うように考えます。</p><div class="k-draft">' +
        Array.from({ length: 7 }, (_, i) => K.addDays(ws, i)).map((d) => '<div class="k-draft-day"><span>' + K.esc(K.dayLabel(d)) + '</span><button type="button" class="k-kind k-kind-' + draft[d] + '" data-act="kind" data-date="' + d + '" aria-label="' + K.esc(K.dayLabel(d)) + ': ' + KIND[draft[d]] + '(タップで切り替え)">' + KIND[draft[d]] + '</button></div>').join('') + '</div>' +
        '<button type="button" class="btn btn-primary" data-act="create">夕食を考える</button>' +
        '<p class="input-hint">AIを使います(今月の残り ' + data.quota.remaining + ' / ' + data.quota.cap + '回)。押すと確認が出ます。</p></section>';
    } else {
      body = '<div class="k-seg" role="tablist"><button type="button" data-pane="plan" class="' + (pane === 'plan' ? 'active' : '') + '">プラン</button><button type="button" data-pane="shop" class="' + (pane === 'shop' ? 'active' : '') + '">買い物</button></div>' +
        (pane === 'plan' ? planHtml() : shoppingHtml());
    }
    root.innerHTML = head + body;
    if(data.plan && pane === 'shop') renderPantry();
  }

  async function renderPantry(){
    const r = await K.api('GET', '/api/user/pantry');
    const el = document.getElementById('k-pantry'); if(!el || !r.ok) return;
    el.innerHTML = r.data.items.map((n) => '<span class="k-chip">' + K.esc(n) + ' <button type="button" class="k-x" data-act="pantry-del" data-name="' + K.esc(n) + '" aria-label="' + K.esc(n) + 'を外す">×</button></span>').join('') || '<p class="input-hint">まだ登録がありません。</p>';
    el._items = r.data.items;
  }

  async function load(){
    if(!K.loggedIn()){ render(); return; }
    const r = await K.api('GET', '/api/week?week=' + ws);
    data = r.ok && r.data && r.data.quota ? r.data : (r.status === 503 ? { unavailable: true } : { plan: null, quota: { remaining: 0, cap: 0 }, shopping: { sections: [], have: [] }, summary: { cookedDays: 0 } });
    const t = await K.api('GET', '/api/user/targets');
    if(t.ok) showNumbers = t.data.showNumbers !== false;
    render();
  }

  async function runAi(planId){
    const ok = await K.confirmAi({
      title: '夕食をAIに考えてもらいます',
      body: '決まっていない日の夕食を、1回の依頼でまとめて考えます。うまくいかなかったときは、回数は戻ります。',
      remaining: data.quota.remaining, cap: data.quota.cap, unit: '回', okLabel: '考えてもらう',
    });
    if(!ok) return false;
    root.insertAdjacentHTML('afterbegin', '<p class="k-toast" id="k-busy">夕食を考えています…(1分ほどかかります)</p>');
    const r = await K.api('POST', '/api/week/plan/' + encodeURIComponent(planId) + '/run');
    const b = document.getElementById('k-busy'); if(b) b.remove();
    if(!r.ok) K.toast(r.data.error || 'うまく作れませんでした。もう一度お試しください');
    else if(r.data.skipped && r.data.skipped.length) K.toast('一部の日は決まりませんでした(使わない食材が入っていたため)。もう一度お試しください');
    await load();
    return r.ok;
  }

  async function swapSheet(date){
    if(!recipes){ const r = await K.api('GET', '/api/recipes'); recipes = r.ok && r.data.recipes ? r.data.recipes.filter((x) => x.nutrition) : []; }
    const wrap = document.createElement('div'); wrap.className = 'k-sheet-wrap';
    wrap.innerHTML = '<div class="k-sheet" role="dialog" aria-modal="true" aria-label="保存したレシピから選ぶ"><h3>' + K.esc(K.dayLabel(date)) + 'の夕食を選ぶ</h3>' +
      (recipes.length ? '<div class="k-list">' + recipes.map((r) => '<button type="button" class="k-pickrow" data-id="' + K.esc(r.id) + '">' + K.esc(r.name) + '</button>').join('') + '</div>' : '<p class="input-hint">栄養の入った保存済みレシピがありません。</p>') +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', async (e) => {
      const row = e.target.closest('.k-pickrow');
      if(row){ const r = await K.api('PATCH', '/api/week/plan/' + encodeURIComponent(data.plan.id), { action: 'swap', date, recipeId: row.dataset.id }); wrap.remove(); if(!r.ok) K.toast(r.data.error || '変えられませんでした'); load(); }
      else if(e.target.closest('[data-act="close"]') || e.target === wrap) wrap.remove();
    });
  }

  root.addEventListener('click', async (e) => {
    const seg = e.target.closest('[data-pane]'); if(seg){ pane = seg.dataset.pane; render(); return; }
    const a = e.target.closest('[data-act]'); if(!a) return;
    const act = a.dataset.act;
    if(act === 'wprev'){ ws = K.addDays(ws, -7); data = null; load(); }
    else if(act === 'wnext'){ ws = K.addDays(ws, 7); data = null; load(); }
    else if(act === 'kind'){ const d = a.dataset.date; draft[d] = draft[d] === 'cook' ? 'outing' : draft[d] === 'outing' ? 'off' : 'cook'; render(); }
    else if(act === 'create'){
      const days = Array.from({ length: 7 }, (_, i) => K.addDays(ws, i));
      const r = await K.api('POST', '/api/week/plan', { weekStart: ws, outingDays: days.filter((d) => draft[d] === 'outing'), offDays: days.filter((d) => draft[d] === 'off') });
      if(!r.ok){ K.toast(r.data.error || '作れませんでした'); return; }
      await load();            // 枠までは無料。ここでAIの確認を出す(やめても、枠は残る)
      await runAi(r.data.id);
    }
    else if(act === 'run'){ await runAi(data.plan.id); }
    else if(act === 'day'){
      const r = await K.api('PATCH', '/api/week/plan/' + encodeURIComponent(data.plan.id), { action: a.dataset.do, date: a.dataset.date });
      if(!r.ok) K.toast(r.data.error || '変えられませんでした'); load();
    }
    else if(act === 'swap'){ swapSheet(a.dataset.date); }
    else if(act === 'save-recipe'){
      const d = data.plan.days.find((x) => x.date === a.dataset.date); if(!d || !d.recipe) return;
      const r0 = d.recipe;
      const rec = { id: 'r-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()), name: r0.name, type: r0.type || '', ingredients: r0.ingredients, ingredientDetails: r0.ingredientDetails, steps: r0.steps, nutrition: r0.nutrition, nutritionCheck: r0.nutritionCheck, minutes: r0.minutes };
      Object.assign(rec, r0.nutrition);
      const r = await K.api('POST', '/api/recipes', rec);
      K.toast(r.ok ? '保存しました' : (r.data.error || '保存できませんでした'));
      if(r.ok){ recipes = null; if(typeof updateSavedCountBadge === 'function') { try { updateSavedCountBadge(); } catch(err) { /* 表示だけの更新 */ } } }
    }
    else if(act === 'delete-plan'){ const r = await K.api('DELETE', '/api/week/plan/' + encodeURIComponent(data.plan.id)); if(r.ok){ draft = null; load(); } else K.toast(r.data.error || '消せませんでした'); }
    else if(act === 'check'){ await K.api('PATCH', '/api/week/plan/' + encodeURIComponent(data.plan.id), { action: 'check', key: a.dataset.key, checked: a.checked }); a.closest('label').classList.toggle('done', a.checked); }
    else if(act === 'pantry-add' || act === 'pantry-del'){
      const box = document.getElementById('k-pantry'); let items = (box && box._items) || [];
      if(act === 'pantry-add'){ const inp = document.getElementById('k-pantry-in'); const v = inp.value.trim(); if(!v) return; items = items.concat([v]); }
      else items = items.filter((n) => n !== a.dataset.name);
      const r = await K.api('PUT', '/api/user/pantry', { items });
      if(!r.ok) K.toast(r.data.error || '保存できませんでした'); else load();
    }
  });

  K.showWeek = () => { data = null; load(); };
  K.refreshers.push(() => { if(!root.hidden){ data = null; load(); } });
  render();
})();
