// ==== 「週」タブ:1週間の食事(朝食・昼食・夕食)プラン・買い物リスト ====
// ★「献立を考える」ボタン(/api/week/plan/:id/run)だけが、AI(有料)につながります。★
//   ・押すと、まず confirmAi()(今月の残り回数と、今回使う回数を見せる確認)が出て、「使う」をタップしたときだけ呼びます。
//   ・AIへの依頼は「食事ごとに1回」(朝食・昼食・夕食=最大3回)。順番に1回ずつ呼び、1回失敗したらそこで止めます(再試行しない)。
//   ・今月の残り回数より多くは呼びません(残りが2回なら、先頭の2食ぶんまで)。
//   ・プランの枠づくり・外食にする・作らない食事・保存済みレシピへの差し替え・「食べた」の記録・レシピの編集(栄養は成分表からサーバーがコードで再計算)・
//     その日のバランス・買い物のチェックは、AIを使いません。
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
  let selDate = null;     // 週ページで見ている日(日付の帯で選ぶ)
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

  const ATTR = (d) => ' data-date="' + d.date + '" data-slot="' + d.slot + '"';
  const findDay = (date, slot) => data.plan.days.find((x) => x.date === date && x.slot === slot);

  function mealRow(d){
    const past = d.date < K.todayJst();
    const at = ATTR(d);
    const change = '<button type="button" class="btn btn-small btn-ghost" data-act="change"' + at + '>変更する</button>';
    let body = '';
    if(d.kind === 'outing') body = '<p class="k-day-note">外食の予定。ほかの食事で栄養を整えられます。</p><div class="k-day-actions">' + change + '</div>';
    else if(d.kind === 'off') body = '<p class="k-day-note">作らない</p>' + (past ? '' : '<div class="k-day-actions">' + change + '</div>');
    else if(d.recipe){
      const r = d.recipe;
      const tag = r.source === 'ai' ? ' <span class="k-tag">AIの提案</span>' : r.edited ? ' <span class="k-tag">編集済み</span>' : '';
      body = '<button type="button" class="k-name-btn" data-act="detail"' + at + ' aria-label="' + K.esc(r.name) + 'の詳細を見る">' + K.esc(r.name) + '</button>' + tag + (d.eaten ? ' <span class="k-tag k-eaten-tag">食べた</span>' : '') +
        '<p class="k-day-meta">' + [r.minutes ? K.esc(r.minutes) + '分' : '', r.nutrition && r.nutrition.calories != null && showNumbers ? K.fmt(r.nutrition.calories) + 'kcal' : '', 'タップで詳細'].filter(Boolean).join(' ・ ') + '</p>' +
        '<div class="k-day-actions"><button type="button" class="btn btn-small ' + (d.eaten ? 'btn-ghost' : 'btn-primary') + '" data-act="eaten" data-eaten="' + (d.eaten ? 'false' : 'true') + '"' + at + '>' + (d.eaten ? '食べた ✓(取り消す)' : '食べた') + '</button>' + change +
        (r.source === 'ai' || r.edited ? '<button type="button" class="btn btn-small btn-secondary" data-act="save-recipe"' + at + '>保存する</button>' : '') + '</div>';
    } else body = '<p class="k-day-note">まだ決まっていません</p><div class="k-day-actions">' + change + '</div>';
    return '<div class="k-meal-row k-kind-' + d.kind + '"' + at + '><h5 class="k-slot-name">' + MEAL[d.slot] + '</h5>' + body + '</div>';
  }

  function dayCard(date, entries){
    return '<div class="k-day" data-date="' + date + '"><h4>' + K.esc(K.dayLabel(date)) + (date === K.todayJst() ? ' <span class="k-tag">今日</span>' : '') + '</h4>' + entries.map(mealRow).join('') + '</div>';
  }

  // 日付の帯(月〜日)。●=食べた ○=予定(料理が決まっている) ・=まだ。タップでその日を見る
  function stripHtml(p){
    const today = K.todayJst();
    return '<div class="k-strip" role="group" aria-label="日付を選ぶ">' + Array.from({ length: 7 }, (_, i) => K.addDays(ws, i)).map((date) => {
      const ds = p.days.filter((d) => d.date === date && d.kind === 'cook');
      const dots = ds.map((d) => d.eaten ? '●' : d.recipe ? '○' : '・').join('');
      const label = K.dayLabel(date);   // 例 10/22(木)
      return '<button type="button" class="k-daybtn' + (date === today ? ' k-today' : '') + '" data-act="selday" data-date="' + date + '" aria-pressed="' + (date === selDate ? 'true' : 'false') + '" aria-label="' + K.esc(label) + '">' +
        '<small>' + K.esc(label.slice(label.indexOf('(') + 1, -1)) + '</small><span>' + Number(date.slice(8)) + '</span><span class="k-dots" aria-hidden="true">' + dots + '</span></button>';
    }).join('') + '</div>';
  }

  // その日のバランス(予定と食べた)
  function balanceHtml(){
    const b = data.balance, d = b && b.days && b.days[selDate];
    let h = '<section class="panel k-daybal"><h3>' + K.esc(K.dayLabel(selDate)) + 'のバランス</h3>';
    if(!b || !d) return '';
    if(d.empty) h += '<p class="note k-empty">' + K.esc(d.empty) + '</p>';
    else if(!b.hasTargets) h += '<div class="notice"><p>目標の目安を設定すると、ここにバランスが出ます。</p><button type="button" class="btn btn-small" data-act="goto-targets">目標を設定する</button></div>';
    else h += '<div class="k-gauges">' + d.gauges.map((g) => K.dayGaugeHtml(g, b.showNumbers, d.eatenCount > 0)).join('') + '</div>' +
      (d.eatenCount ? '' : '<p class="input-hint">' + K.esc('まだ食べた記録がありません') + '。「食べた」を押すと、食べた分が反映されます。</p>') +
      (b.showNumbers ? '' : '<p class="k-okline">バランス良好</p>') + (d.approxText ? '<p class="input-hint">' + K.esc(d.approxText) + '</p>' : '') + '<p class="input-hint">' + K.esc(b.help) + '</p>';
    if(d.eatenMeals && d.eatenMeals.length) h += '<p class="k-eaten-list">食べた: ' + d.eatenMeals.map((m) => K.esc((K.SLOTS.find((x) => x[0] === m.slot) || [0, ''])[1] + ' ' + m.name)).join(' ・ ') + '</p>';
    return h + '<p class="input-hint">外食や間食は、「今日」タブで記録できます。</p></section>';
  }

  function planHtml(){
    const p = data.plan;
    const pend = pendingEntries(p);
    const nSlots = slotsOf(pend).length;
    const aiBtn = pend.length ? '<div class="k-ai-box"><button type="button" class="btn btn-primary" data-act="run">決まっていない' + pend.length + '食の献立を考える</button>' +
      '<p class="input-hint">AIを使います(今月の残り ' + data.quota.remaining + ' / ' + data.quota.cap + '回)。食事ごとに1回ずつ使うので、今回は' + nSlots + '回ぶんです。押すと確認が出ます。</p></div>' : '';
    const err = p.status === 'error' ? '<p class="note k-err">うまく作れませんでした。もう一度お試しください(うまくいかなかった分の回数は戻っています)。</p>' : '';
    if(!selDate || selDate < ws || selDate > K.addDays(ws, 6)){   // はじめに見る日: 今日以降で、作る食事がある最初の日(なければ、今日か週のはじめ)
      const t = K.todayJst(); const c = p.days.find((d) => d.date >= t && d.kind === 'cook');
      selDate = c ? c.date : ((t >= ws && t <= K.addDays(ws, 6)) ? t : ws);
    }
    const entries = p.days.filter((d) => d.date === selDate);
    return summaryHtml(data.summary) + err + aiBtn + stripHtml(p) + balanceHtml() + '<div class="k-days">' + dayCard(selDate, entries) + '</div>' +
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

  const sheet = (html) => {
    const wrap = document.createElement('div'); wrap.className = 'k-sheet-wrap';
    wrap.innerHTML = '<div class="k-sheet" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(wrap);
    return wrap;
  };
  const patchPlan = (body) => K.api('PATCH', '/api/week/plan/' + encodeURIComponent(data.plan.id), body);

  async function swapSheet(date, slot){
    if(!recipes){ const r = await K.api('GET', '/api/recipes'); recipes = r.ok && r.data.recipes ? r.data.recipes.filter((x) => x.nutrition) : []; }
    const wrap = sheet('<h3>' + K.esc(K.dayLabel(date)) + 'の' + MEAL[slot] + 'を選ぶ</h3>' +
      (recipes.length ? '<div class="k-list">' + recipes.map((r) => '<button type="button" class="k-pickrow" data-id="' + K.esc(r.id) + '">' + K.esc(r.name) + '</button>').join('') + '</div>' : '<p class="input-hint">栄養の入った保存済みレシピがありません。</p>') +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button></div>');
    wrap.addEventListener('click', async (e) => {
      const row = e.target.closest('.k-pickrow');
      if(row){ const r = await patchPlan({ action: 'swap', date, slot, recipeId: row.dataset.id }); wrap.remove(); if(!r.ok) K.toast(r.data.error || '変えられませんでした'); load(); }
      else if(e.target.closest('[data-act="close"]') || e.target === wrap) wrap.remove();
    });
  }

  // 「変更する」: やることを、説明つきの大きなボタンで選ぶ(AIは使わない。決め直した食事は、あとで「献立を考える」で頼める)
  function changeSheet(date, slot){
    const d = findDay(date, slot);
    const opts = [['swap', '保存したレシピから選ぶ', '保存済みのレシピに入れ替えます']];
    if(d.kind !== 'outing') opts.push(['outing', '外食にする', 'この食事は外食の予定にします(栄養は数えません)']);
    if(d.kind !== 'off') opts.push(['off', '作らない食事にする', 'この食事は予定から外します']);
    if(d.kind !== 'cook') opts.push(['cook', '作る食事に戻す', 'あとで「献立を考える」でAIに頼めます']);
    else if(d.recipe) opts.push(['cook', '料理を決め直す', '料理を空にして、あとで「献立を考える」でAIに頼めます']);
    const wrap = sheet('<h3>' + K.esc(K.dayLabel(date)) + 'の' + MEAL[slot] + 'を変更</h3>' +
      opts.map(([id, t, sub]) => '<button type="button" class="k-choice" data-do="' + id + '">' + K.esc(t) + '<small>' + K.esc(sub) + '</small></button>').join('') +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button></div>');
    wrap.addEventListener('click', async (e) => {
      const c = e.target.closest('.k-choice');
      if(c){
        wrap.remove();
        if(c.dataset.do === 'swap'){ swapSheet(date, slot); return; }
        const r = await patchPlan({ action: c.dataset.do, date, slot });
        if(!r.ok) K.toast(r.data.error || '変えられませんでした'); load();
      } else if(e.target.closest('[data-act="close"]') || e.target === wrap) wrap.remove();
    });
  }

  const NUTRI_ORDER = ['calories', 'protein', 'veg', 'fat', 'salt', 'fiber', 'carbs', 'carbohydrate'];
  // レシピの詳細(材料・作り方・栄養)。「編集する」で内容を直せる(栄養は保存時にサーバーが成分表から計算し直す)
  function detailSheet(date, slot){
    const d = findDay(date, slot); if(!d || !d.recipe) return;
    const r = d.recipe;
    const nutri = NUTRI_ORDER.filter((k) => r.nutrition && r.nutrition[k] != null).map((k) => '<span>' + K.esc(K.LABEL[k]) + '</span><span>' + K.fmt(r.nutrition[k]) + K.unit(k) + '</span>').join('');
    const bad = r.nutritionCheck && r.nutritionCheck.unmatched && r.nutritionCheck.unmatched.length ? '<p class="input-hint">成分表にない食材(栄養に入っていません): ' + r.nutritionCheck.unmatched.map(K.esc).join('・') + '</p>' : '';
    const wrap = sheet('<div class="k-detail"><h3>' + K.esc(r.name) + '</h3><p class="input-hint">' + K.esc(K.dayLabel(date) + ' ' + MEAL[slot]) + (r.minutes ? ' ・ ' + K.esc(r.minutes) + '分' : '') + (r.source === 'ai' ? ' ・ AIの提案' : r.edited ? ' ・ 編集済み' : r.source === 'saved' ? ' ・ 保存したレシピ' : '') + '</p>' +
      '<h4>栄養(1人前)</h4><div class="k-nutri">' + nutri + '</div>' + bad +
      '<h4>材料</h4><ul>' + (r.ingredientDetails || []).map((i) => '<li>' + K.esc(i.name) + ' ' + K.esc(i.grams > 0 ? i.grams + 'g' : (i.amount || '')) + '</li>').join('') + '</ul>' +
      '<h4>作り方</h4><ol>' + (r.steps || []).map((x) => '<li>' + K.esc(x) + '</li>').join('') + '</ol></div>' +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button><button type="button" class="btn btn-secondary" data-act="edit">編集する</button></div>');
    wrap.addEventListener('click', (e) => {
      if(e.target.closest('[data-act="edit"]')){ wrap.remove(); editSheet(date, slot); }
      else if(e.target.closest('[data-act="close"]') || e.target === wrap) wrap.remove();
    });
  }

  function editSheet(date, slot){
    const d = findDay(date, slot); if(!d || !d.recipe) return;
    const r = d.recipe;
    const rowHtml = (i) => '<div class="k-edit-row"><input type="text" maxlength="40" data-f="name" aria-label="食材名" value="' + K.esc(i.name || '') + '" data-food="' + K.esc(i.food || '') + '" data-orig="' + K.esc(i.name || '') + '"><input type="number" inputmode="decimal" min="0" max="5000" data-f="grams" aria-label="グラム" value="' + K.esc(i.grams != null ? i.grams : '') + '"><button type="button" class="k-x" data-act="del-row" aria-label="この食材を消す">×</button></div>';
    const wrap = sheet('<div class="k-edit"><h3>レシピを編集</h3><p class="input-hint">保存すると、成分表から栄養を計算し直します(AIは使いません)。保存したレシピは変わらず、この週の予定だけが変わります。</p>' +
      '<div class="field"><label for="k-e-name">料理名</label><input type="text" id="k-e-name" maxlength="60" value="' + K.esc(r.name) + '"></div>' +
      '<div class="field"><label>材料とグラム</label><div id="k-e-rows">' + (r.ingredientDetails || []).map(rowHtml).join('') + '</div><button type="button" class="btn btn-small btn-ghost" data-act="add-row">＋ 食材を足す</button></div>' +
      '<div class="field"><label for="k-e-steps">作り方(1行に1ステップ)</label><textarea id="k-e-steps">' + K.esc((r.steps || []).join('\n')) + '</textarea></div>' +
      '<p class="k-edit-err" id="k-e-err" role="alert" hidden></p></div>' +
      '<div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">やめる</button><button type="button" class="btn btn-primary" data-act="save-edit">計算して保存</button></div>');
    wrap.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-act]');
      if(!a){ if(e.target === wrap) wrap.remove(); return; }
      const act = a.dataset.act;
      if(act === 'close') wrap.remove();
      else if(act === 'add-row') wrap.querySelector('#k-e-rows').insertAdjacentHTML('beforeend', rowHtml({}));
      else if(act === 'del-row') a.closest('.k-edit-row').remove();
      else if(act === 'save-edit'){
        const err = wrap.querySelector('#k-e-err');
        const ingredients = [...wrap.querySelectorAll('.k-edit-row')].map((row) => {
          const n = row.querySelector('[data-f="name"]'); const g = row.querySelector('[data-f="grams"]');
          const item = { name: n.value.trim(), grams: g.value === '' ? NaN : Number(g.value) };
          if(n.dataset.food && n.value.trim() === n.dataset.orig) item.food = n.dataset.food;   // 名前を変えていない食材は、成分表の照合の手がかりを引き継ぐ
          return item;
        }).filter((i) => i.name || !Number.isNaN(i.grams));
        const draft = { name: wrap.querySelector('#k-e-name').value.trim(), ingredients, steps: wrap.querySelector('#k-e-steps').value.split('\n') };
        if(ingredients.some((i) => Number.isNaN(i.grams))){ err.hidden = false; err.textContent = 'グラム数を入力してください(水など量らないものは0)'; return; }
        a.disabled = true;
        const res = await patchPlan({ action: 'edit', date, slot, draft });
        a.disabled = false;
        if(!res.ok){ err.hidden = false; err.textContent = (res.data.fields ? Object.values(res.data.fields)[0] : '') || res.data.error || '保存できませんでした'; return; }
        wrap.remove(); await load(); K.toast('栄養を計算し直しました'); detailSheet(date, slot);
      }
    });
  }

  root.addEventListener('click', async (e) => {
    const seg = e.target.closest('[data-pane]'); if(seg){ pane = seg.dataset.pane; render(); return; }
    const a = e.target.closest('[data-act]'); if(!a) return;
    const act = a.dataset.act;
    if(act === 'wprev'){ ws = K.addDays(ws, -7); selDate = null; data = null; load(); }
    else if(act === 'wnext'){ ws = K.addDays(ws, 7); selDate = null; data = null; load(); }
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
    else if(act === 'selday'){ selDate = a.dataset.date; render(); }
    else if(act === 'change'){ changeSheet(a.dataset.date, a.dataset.slot); }
    else if(act === 'detail'){ detailSheet(a.dataset.date, a.dataset.slot); }
    else if(act === 'eaten'){
      a.disabled = true;
      const r = await patchPlan({ action: 'eaten', date: a.dataset.date, slot: a.dataset.slot, eaten: a.dataset.eaten === 'true' });
      if(!r.ok) K.toast(r.data.error || '記録できませんでした'); await load();
    }
    else if(act === 'goto-targets'){ document.getElementById('tab-settings').click(); const t = document.getElementById('panel-targets'); if(t) t.scrollIntoView(); }
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
