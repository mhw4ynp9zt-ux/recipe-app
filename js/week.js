// ==== 「週」タブ:1週間の食事(朝食・昼食・夕食)プラン・買い物リスト ====
// ★「献立を考える」ボタン(/api/week/plan/:id/run)だけが、AI(有料)につながります。★
//   ・押すと、まず confirmAi()(今月の残り回数と、今回使う回数を見せる確認)が出て、「使う」をタップしたときだけ呼びます。
//   ・AIへの依頼は「食事ごとに1回」(朝食・昼食・夕食=最大3回)。順番に1回ずつ呼び、1回失敗したらそこで止めます(再試行しない)。
//   ・今月の残り回数より多くは呼びません(残りが2回なら、先頭の2食ぶんまで)。
//   ・プランの枠づくり・外食にする・作らない食事・保存済みレシピへの差し替え・買い物のチェックは、AIを使いません。
// kondate-core.js の Kondate、save.js(レシピの保存)に依存します。
(function(){
  const K = window.Kondate;
  const root = document.getElementById('view-week');
  if(!root) return;
  let ws = K.weekStart(K.todayJst());
  let data = null;
  let pane = 'plan';
  let draft = null;       // 新しく作るときの選択 { slots: {食事: true/false}, kinds: { '日付:食事': 'cook'|'outing'|'off' } }
  let showNumbers = true;
  let recipes = null;

  const KIND = { cook: '作る', outing: '外食', off: '作らない' };
  const SLOTS = ['breakfast', 'lunch', 'dinner'];
  const MEAL = { breakfast: '朝食', lunch: '昼食', dinner: '夕食' };
  const MEAL_SHORT = { breakfast: '朝', lunch: '昼', dinner: '夕' };
  const MAX_AI_RUNS = 3;    // 1回の「考える」で、AIを呼ぶ最大回数(食事の数)

  // 今日の、すでに過ぎた時間帯の食事は、はじめから「作らない」にしておく(タップで変えられる)
  function slotPassed(slot){
    const h = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    return slot === 'breakfast' ? h >= 10 : slot === 'lunch' ? h >= 15 : h >= 21;
  }
  function ensureDraft(){
    if(draft && draft._ws === ws) return;
    draft = { _ws: ws, slots: { breakfast: true, lunch: true, dinner: true }, kinds: {} };
    const today = K.todayJst();
    for(let i = 0; i < 7; i++){
      const d = K.addDays(ws, i);
      SLOTS.forEach((sl) => { draft.kinds[d + ':' + sl] = (d < today || (d === today && slotPassed(sl))) ? 'off' : 'cook'; });
    }
  }
  const pendingEntries = (p) => p.days.filter((d) => d.kind === 'cook' && !d.recipe && (p.pending || []).includes(d.date + ':' + d.slot));
  const slotsOf = (entries) => SLOTS.filter((sl) => entries.some((d) => d.slot === sl));

  function summaryHtml(s){
    if(!s.cookedDays) return '';
    const a = s.average;
    const nums = showNumbers ? '<p class="input-hint">1日あたりの平均(決まっている食事の合計): ' + ['calories', 'protein', 'fiber', 'salt'].filter((k) => a[k] != null).map((k) => K.LABEL[k] + ' ' + K.fmt(a[k]) + K.unit(k)).join(' ・ ') + '</p>' : '';
    return '<div class="k-summary"><p>' + s.cookedDays + '日ぶん' + (s.cookedMeals ? '(' + s.cookedMeals + '食)' : '') + 'の食事が決まっています。' + (s.outingDays ? '外食の食事は、ほかの食事で整います。' : '') + '</p>' + nums + '</div>';
  }

  function mealRow(d){
    const today = K.todayJst();
    const past = d.date < today;
    const at = ' data-date="' + d.date + '" data-slot="' + d.slot + '"';
    let body = '';
    if(d.kind === 'outing') body = '<p class="k-day-note">外食の予定。ほかの食事で栄養を整えられます。</p><div class="k-day-actions"><button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="cook"' + at + '>作る食事にする</button></div>';
    else if(d.kind === 'off') body = '<p class="k-day-note">作らない</p>' + (past ? '' : '<div class="k-day-actions"><button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="cook"' + at + '>作る食事にする</button></div>');
    else if(d.recipe){
      const r = d.recipe;
      body = '<p class="k-day-name">' + K.esc(r.name) + (r.source === 'ai' ? ' <span class="k-tag">AIの提案</span>' : '') + '</p>' +
        '<p class="k-day-meta">' + [r.minutes ? K.esc(r.minutes) + '分' : '', r.nutrition && r.nutrition.calories != null && showNumbers ? K.fmt(r.nutrition.calories) + 'kcal' : ''].filter(Boolean).join(' ・ ') + '</p>' +
        '<div class="k-day-actions">' + (r.source === 'ai' ? '<button type="button" class="btn btn-small btn-secondary" data-act="save-recipe"' + at + '>保存する</button>' : '') +
        '<button type="button" class="btn btn-small btn-ghost" data-act="swap"' + at + '>別の料理に</button>' +
        '<button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="outing"' + at + '>外食にする</button></div>';
    } else body = '<p class="k-day-note">まだ決まっていません</p><div class="k-day-actions"><button type="button" class="btn btn-small btn-ghost" data-act="swap"' + at + '>保存したレシピから</button>' +
      '<button type="button" class="btn btn-small btn-ghost" data-act="day" data-do="outing"' + at + '>外食にする</button></div>';
    return '<div class="k-meal-row k-kind-' + d.kind + '"' + at + '><h5 class="k-slot-name">' + MEAL[d.slot] + '</h5>' + body + '</div>';
  }

  function dayCard(date, entries){
    const today = K.todayJst();
    return '<div class="k-day" data-date="' + date + '"><h4>' + K.esc(K.dayLabel(date)) + (date === today ? ' <span class="k-tag">今日</span>' : '') + '</h4>' + entries.map(mealRow).join('') + '</div>';
  }

  function planHtml(){
    const p = data.plan;
    const pend = pendingEntries(p);
    const nSlots = slotsOf(pend).length;
    const aiBtn = pend.length ? '<div class="k-ai-box"><button type="button" class="btn btn-primary" data-act="run">決まっていない' + pend.length + '食の献立を考える</button>' +
      '<p class="input-hint">AIを使います(今月の残り ' + data.quota.remaining + ' / ' + data.quota.cap + '回)。食事ごとに1回ずつ使うので、今回は' + nSlots + '回ぶんです。押すと確認が出ます。</p></div>' : '';
    const err = p.status === 'error' ? '<p class="note k-err">うまく作れませんでした。もう一度お試しください(うまくいかなかった分の回数は戻っています)。</p>' : '';
    const dates = []; const by = {};
    p.days.forEach((d) => { if(!by[d.date]){ by[d.date] = []; dates.push(d.date); } by[d.date].push(d); });
    return summaryHtml(data.summary) + err + aiBtn + '<div class="k-days">' + dates.map((dt) => dayCard(dt, by[dt])).join('') + '</div>' +
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
      '<h2 class="view-title">' + (ws === thisWs ? '今週' : ws === K.addDays(thisWs, 7) ? '来週' : K.dayLabel(ws) + 'の週') + 'の食事</h2>' +
      '<button type="button" class="k-nav" data-act="wnext" aria-label="次の週"' + (ws >= K.addDays(thisWs, 7) ? ' disabled' : '') + '>›</button></div>';
    let body;
    if(!data.plan){
      ensureDraft();
      const chosen = SLOTS.filter((sl) => draft.slots[sl]);
      body = '<section class="panel"><h3>1週間の食事を考えます</h3><p class="input-hint">考えてほしい食事を選び、外食や作らない食事を切り替えてから押してください。外食の食事は、ほかの食事で栄養が整うように考えます。</p>' +
        '<div class="k-slotpick" role="group" aria-label="考える食事">' + SLOTS.map((sl) => '<button type="button" class="k-slotbtn" data-act="slot" data-slot="' + sl + '" aria-pressed="' + (draft.slots[sl] ? 'true' : 'false') + '">' + MEAL[sl] + '</button>').join('') + '</div>' +
        '<div class="k-draft">' +
        Array.from({ length: 7 }, (_, i) => K.addDays(ws, i)).map((d) => '<div class="k-draft-day"><span>' + K.esc(K.dayLabel(d)) + '</span><span class="k-draft-meals">' +
          chosen.map((sl) => { const k = draft.kinds[d + ':' + sl]; return '<button type="button" class="k-kind k-kind-' + k + '" data-act="kind" data-date="' + d + '" data-slot="' + sl + '" aria-label="' + K.esc(K.dayLabel(d) + ' ' + MEAL[sl] + ': ' + KIND[k]) + '(タップで切り替え)">' + MEAL_SHORT[sl] + ' ' + KIND[k] + '</button>'; }).join('') + '</span></div>').join('') + '</div>' +
        '<button type="button" class="btn btn-primary" data-act="create">献立を考える</button>' +
        '<p class="input-hint">AIを使います(今月の残り ' + data.quota.remaining + ' / ' + data.quota.cap + '回)。選んだ食事ごとに1回ずつ使います(最大' + chosen.length + '回)。押すと確認が出ます。</p></section>';
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
    const slots = data.plan ? slotsOf(pendingEntries(data.plan)) : [];
    if(!slots.length) return false;
    const remaining = data.quota.remaining;
    const runnable = slots.slice(0, Math.min(MAX_AI_RUNS, Math.max(0, remaining)));   // 今月の残り回数より多くは呼ばない
    const names = runnable.map((sl) => MEAL[sl]).join('・');
    const ok = await K.confirmAi({
      title: '献立をAIに考えてもらいます',
      body: '決まっていない' + names + 'を、食事ごとに1回ずつ(今回は最大' + runnable.length + '回)依頼します。順番に進み、途中でうまくいかなかったときは、そこで止めます(できた分は残り、うまくいかなかった回の回数は戻ります)。' +
        (runnable.length < slots.length ? '今月の残りが少ないため、' + names + 'までです。' : ''),
      remaining, cap: data.quota.cap, unit: '回', okLabel: '考えてもらう',
    });
    if(!ok || !runnable.length) return false;
    let good = true;
    for(let i = 0; i < runnable.length; i++){
      root.insertAdjacentHTML('afterbegin', '<p class="k-toast" id="k-busy">' + MEAL[runnable[i]] + 'を考えています…(' + (i + 1) + '/' + runnable.length + ')</p>');
      const r = await K.api('POST', '/api/week/plan/' + encodeURIComponent(planId) + '/run', { slot: runnable[i] });
      const b = document.getElementById('k-busy'); if(b) b.remove();
      if(!r.ok){ K.toast(r.data.error || 'うまく作れませんでした。もう一度お試しください'); good = false; await load(); break; }  // 失敗したら、そこで止める(再試行しない)
      if(r.data.skipped && r.data.skipped.length) K.toast('一部の食事は決まりませんでした(使わない食材が入っていたため)。もう一度お試しください');
      await load();   // 1食ぶんできるたびに、画面を更新する
    }
    return good;
  }

  async function swapSheet(date, slot){
    if(!recipes){ const r = await K.api('GET', '/api/recipes'); recipes = r.ok && r.data.recipes ? r.data.recipes.filter((x) => x.nutrition) : []; }
    const wrap = document.createElement('div'); wrap.className = 'k-sheet-wrap';
    wrap.innerHTML = '<div class="k-sheet" role="dialog" aria-modal="true" aria-label="保存したレシピから選ぶ"><h3>' + K.esc(K.dayLabel(date)) + 'の' + MEAL[slot] + 'を選ぶ</h3>' +
      (recipes.length ? '<div class="k-list">' + recipes.map((r) => '<button type="button" class="k-pickrow" data-id="' + K.esc(r.id) + '">' + K.esc(r.name) + '</button>').join('') + '</div>' : '<p class="input-hint">栄養の入った保存済みレシピがありません。</p>') +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', async (e) => {
      const row = e.target.closest('.k-pickrow');
      if(row){ const r = await K.api('PATCH', '/api/week/plan/' + encodeURIComponent(data.plan.id), { action: 'swap', date, slot, recipeId: row.dataset.id }); wrap.remove(); if(!r.ok) K.toast(r.data.error || '変えられませんでした'); load(); }
      else if(e.target.closest('[data-act="close"]') || e.target === wrap) wrap.remove();
    });
  }

  root.addEventListener('click', async (e) => {
    const seg = e.target.closest('[data-pane]'); if(seg){ pane = seg.dataset.pane; render(); return; }
    const a = e.target.closest('[data-act]'); if(!a) return;
    const act = a.dataset.act;
    if(act === 'wprev'){ ws = K.addDays(ws, -7); data = null; load(); }
    else if(act === 'wnext'){ ws = K.addDays(ws, 7); data = null; load(); }
    else if(act === 'kind'){ const k = a.dataset.date + ':' + a.dataset.slot; draft.kinds[k] = draft.kinds[k] === 'cook' ? 'outing' : draft.kinds[k] === 'outing' ? 'off' : 'cook'; render(); }
    else if(act === 'slot'){
      const sl = a.dataset.slot;
      if(draft.slots[sl] && SLOTS.filter((x) => draft.slots[x]).length === 1) return;   // 食事は1つ以上選ぶ
      draft.slots[sl] = !draft.slots[sl]; render();
    }
    else if(act === 'create'){
      const days = Array.from({ length: 7 }, (_, i) => K.addDays(ws, i));
      const slots = SLOTS.filter((sl) => draft.slots[sl]);
      const keys = days.flatMap((d) => slots.map((sl) => d + ':' + sl));
      const r = await K.api('POST', '/api/week/plan', { weekStart: ws, slots, outingMeals: keys.filter((k) => draft.kinds[k] === 'outing'), offMeals: keys.filter((k) => draft.kinds[k] === 'off') });
      if(!r.ok){ K.toast(r.data.error || '作れませんでした'); return; }
      await load();            // 枠までは無料。ここでAIの確認を出す(やめても、枠は残る)
      await runAi(r.data.id);
    }
    else if(act === 'run'){ await runAi(data.plan.id); }
    else if(act === 'day'){
      const r = await K.api('PATCH', '/api/week/plan/' + encodeURIComponent(data.plan.id), { action: a.dataset.do, date: a.dataset.date, slot: a.dataset.slot });
      if(!r.ok) K.toast(r.data.error || '変えられませんでした'); load();
    }
    else if(act === 'swap'){ swapSheet(a.dataset.date, a.dataset.slot); }
    else if(act === 'save-recipe'){
      const d = data.plan.days.find((x) => x.date === a.dataset.date && x.slot === a.dataset.slot); if(!d || !d.recipe) return;
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
