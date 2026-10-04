// 設定タブの「使っている調理家電」欄。js/settings.js の「マイキッチン」と同じ作りです。
// 家電ごとに「できる操作」(チェック)・「使い方の方針」・補足を登録します。保存は「保存」ボタンのみ(自動保存はしません)。
// ※この欄は AI を呼びません。保存・読み込みは /api/user/appliances(DB の読み書きだけ)を使います。
// ※作れなかったときは、この機能だけ使わず、ほかの機能は止めません。
// ※「できる操作」「方針」の選択肢は js/config.js の APPLIANCE_OPS / APPLIANCE_POLICIES、ひな形は APPLIANCE_PRESETS。
(function(){
  const APPL_URL = '/api/user/appliances';

  const APPL_CSS =
    '#appliances-section{margin-top:16px;}' +
    '#appliances-section .appliance-list{display:flex; flex-direction:column; gap:12px; margin:0;}' +
    '#appliances-section .appliance-card{position:relative; box-sizing:border-box; padding:12px 12px 14px; border:1.5px solid var(--line-strong); border-radius:14px; background:#fff;}' +
    '#appliances-section .appliance-head{display:flex; align-items:center; gap:8px;}' +
    '#appliances-section .appliance-name{flex:1 1 auto; min-width:0; box-sizing:border-box; min-height:44px; padding:8px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px; font-weight:700;}' +
    '#appliances-section .appliance-remove{flex:0 0 auto; width:44px; height:44px; padding:0; border:none; border-radius:50%; background:transparent; color:var(--ink-soft); font-size:22px; line-height:1; cursor:pointer;}' +
    '#appliances-section .appliance-label{display:block; margin:12px 0 4px; font-size:12.5px; font-weight:700; color:var(--ink-soft);}' +
    '#appliances-section .appliance-ops{display:flex; flex-wrap:wrap; gap:6px;}' +
    '#appliances-section .appliance-op-label{display:inline-flex; align-items:center; gap:6px; min-height:36px; padding:4px 12px 4px 8px; border:1.5px solid var(--line-strong); border-radius:100px; background:#fff; color:var(--ink); font-size:14px; cursor:pointer;}' +
    '#appliances-section .appliance-op{width:20px; height:20px; margin:0; accent-color:var(--brand);}' +
    '#appliances-section .appliance-policy{display:block; width:100%; box-sizing:border-box; min-height:44px; padding:8px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px;}' +
    '#appliances-section .appliance-note{display:block; width:100%; box-sizing:border-box; min-height:48px; padding:10px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px; line-height:1.5; resize:vertical;}' +
    '#appliances-section .appliance-add-row{display:flex; gap:8px; margin-top:12px;}' +
    '#appliances-section .appliance-add-row .btn{flex:1 1 0; min-height:48px; padding-left:8px; padding-right:8px;}' +
    '#appliances-section .appliance-add-row .btn:disabled{opacity:.5;}' +
    '#appliances-section .appliance-preset-list{display:flex; flex-direction:column; gap:8px; margin-top:10px;}' +
    '#appliances-section .appliance-preset-list[hidden]{display:none;}' +
    '#appliances-section .appliance-preset-btn{min-height:48px; text-align:left; padding:8px 16px;}' +
    '#appliances-section .appliance-empty{margin:0; color:var(--ink-faint); font-size:13.5px;}' +
    '#appliances-section .appliances-meta{margin:12px 0 0; font-weight:500; color:var(--ink-soft); font-size:12.5px;}' +
    '#appliances-section .appliances-meta .dirty{color:var(--accent);}' +
    '#appliances-section .appliances-save{display:block; width:100%; margin-top:12px; min-height:48px;}' +
    '#appliances-section .status-line{text-align:left;}' +
    '.appliances-note{margin-top:14px;}';

  const APPL_HTML =
    '<section class="panel">' +
      '<div class="panel-head"><h3>使っている調理家電</h3></div>' +
      '<p class="input-hint">お持ちの調理家電と「できる操作」を登録しておくと、その家電でできない工程(例:炒められない家電で「炒める」)をレシピに書かないようにします。ひな形の内容は目安です。お使いの機種に合わせて確認・修正してください。</p>' +
      '<div class="appliance-list" id="appliances-list"></div>' +
      '<div class="appliance-add-row">' +
        '<button type="button" class="btn btn-secondary" id="btn-appliance-preset" aria-expanded="false">ひな形から追加</button>' +
        '<button type="button" class="btn btn-secondary" id="btn-appliance-custom">自分で追加</button>' +
      '</div>' +
      '<div class="appliance-preset-list" id="appliance-preset-list" hidden></div>' +
      '<p class="appliances-meta" id="appliances-count"></p>' +
      '<button type="button" class="btn btn-secondary appliances-save" id="btn-appliances-save">保存</button>' +
      '<p id="appliances-status" class="status-line" hidden></p>' +
      '<p class="input-hint appliances-note">保存した内容は、次のレシピ作成から反映されます。チェックのない操作は「できない操作」としてAIに伝わります。AIがすべてに応えられないこともあります。</p>' +
    '</section>';

  let sectionEl = null, listEl = null, countEl = null, statusEl = null, saveBtn = null, presetBtn = null, customBtn = null, presetListEl = null;
  let saved = [];                                                              // サーバーに保存されている内容(未保存の判定用)
  let limits = { max: 5, maxNameLength: 20, maxNoteLength: 100 };              // サーバーの上限(読み込み時に更新)
  let saving = false;                                                          // 保存の通信の最中か
  let epoch = 0;                                                               // 通信を始めるたび・ログアウトのたびに進める。古い応答(遅れて届いたもの)は画面に反映しない

  function recordError(err, extra){
    if(typeof logError === 'function') logError('appliances', err, extra);
  }
  function showStatus(msg, isError){
    if(!statusEl) return;
    statusEl.textContent = msg;
    statusEl.hidden = !msg;
    statusEl.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }
  function clean(text){ return String(text == null ? '' : text).replace(/\s+/g, ' ').trim(); }
  function opIds(){ return APPLIANCE_OPS.map(o => o.id); }
  function policyIds(){ return APPLIANCE_POLICIES.map(p => p.id); }

  // サーバーや保存済みの1台分を、画面で扱う形に整える(canは正本の順・知らないidは捨てる)
  function normalize(a){
    const can = Array.isArray(a && a.can) ? a.can : [];
    return {
      name: clean(a && a.name),
      can: opIds().filter(id => can.indexOf(id) >= 0),
      policy: policyIds().indexOf(a && a.policy) >= 0 ? a.policy : 'optional',
      note: clean(a && a.note),
    };
  }

  function cardEls(){ return Array.prototype.slice.call(listEl.querySelectorAll('.appliance-card')); }

  // 画面の中身を、サーバーへ送る形で取り出す
  function currentList(){
    return cardEls().map(card => normalize({
      name: card.querySelector('.appliance-name').value,
      can: Array.prototype.filter.call(card.querySelectorAll('.appliance-op'), c => c.checked).map(c => c.getAttribute('data-op')),
      policy: card.querySelector('.appliance-policy').value,
      note: card.querySelector('.appliance-note').value,
    }));
  }

  function addCard(a){
    if(cardEls().length >= limits.max) return null;
    const v = normalize(a || {});
    const card = document.createElement('div');
    card.className = 'appliance-card';

    const head = document.createElement('div');
    head.className = 'appliance-head';
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'appliance-name';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', '調理家電の名前');
    name.placeholder = '家電の名前';
    name.value = v.name;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'appliance-remove';
    rm.setAttribute('aria-label', 'この家電を削除');
    rm.textContent = '×';
    head.appendChild(name);
    head.appendChild(rm);
    card.appendChild(head);

    const opsLabel = document.createElement('span');
    opsLabel.className = 'appliance-label';
    opsLabel.textContent = 'できる操作(チェックのない操作は「できない」と伝えます)';
    card.appendChild(opsLabel);
    const ops = document.createElement('div');
    ops.className = 'appliance-ops';
    ops.setAttribute('role', 'group');
    APPLIANCE_OPS.forEach(op => {
      const label = document.createElement('label');
      label.className = 'appliance-op-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'appliance-op';
      cb.setAttribute('data-op', op.id);
      cb.checked = v.can.indexOf(op.id) >= 0;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(op.label));
      ops.appendChild(label);
      cb.addEventListener('change', renderMeta);
    });
    card.appendChild(ops);

    const polLabel = document.createElement('span');
    polLabel.className = 'appliance-label';
    polLabel.textContent = '使い方の方針';
    card.appendChild(polLabel);
    const pol = document.createElement('select');
    pol.className = 'appliance-policy';
    pol.setAttribute('aria-label', '使い方の方針');
    APPLIANCE_POLICIES.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      pol.appendChild(o);
    });
    pol.value = v.policy;
    card.appendChild(pol);

    const noteLabel = document.createElement('span');
    noteLabel.className = 'appliance-label';
    noteLabel.textContent = '補足(任意。モード名など)';
    card.appendChild(noteLabel);
    const note = document.createElement('textarea');
    note.className = 'appliance-note';
    note.rows = 3;
    note.setAttribute('aria-label', '補足');
    note.value = v.note;
    card.appendChild(note);

    name.addEventListener('input', renderMeta);
    pol.addEventListener('change', renderMeta);
    note.addEventListener('input', renderMeta);
    rm.addEventListener('click', function(){ card.remove(); renderMeta(); });
    listEl.appendChild(card);
    return card;
  }

  function renderCards(list){
    listEl.innerHTML = '';
    list.forEach(a => addCard(a));
  }

  function closePresets(){
    presetListEl.hidden = true;
    presetBtn.setAttribute('aria-expanded', 'false');
  }

  function renderMeta(){
    if(!countEl) return;
    const cur = currentList();
    const dirty = JSON.stringify(cur) !== JSON.stringify(saved);
    countEl.textContent = cur.length + ' / ' + limits.max + ' 台';
    if(dirty){
      const span = document.createElement('span');
      span.className = 'dirty';
      span.textContent = '(未保存の変更があります)';
      countEl.appendChild(span);
    }
    const full = cur.length >= limits.max;
    customBtn.disabled = full;
    presetBtn.disabled = full;
    if(full) closePresets();
    saveBtn.disabled = saving;
  }

  async function applianceFetch(options){
    const method = (options && options.method) || 'GET';
    let res;
    try {
      res = await fetch(APPL_URL, options);
    } catch(e){
      recordError(e, { method: method });
      throw new Error('通信に失敗しました。電波の良い場所でもう一度お試しください。');
    }
    let data = {};
    try { data = await res.json(); } catch(e){ /* 空のレスポンス */ }
    if(!data || typeof data !== 'object') data = {};
    if(!res.ok){
      const err = new Error(data.error || '通信に失敗しました(' + res.status + ')');
      recordError(err, { method: method, status: res.status, serverError: data.error });
      throw err;
    }
    return data;
  }

  function applyData(data){
    if(Array.isArray(data.appliances)) saved = data.appliances.map(normalize);
    limits = {
      max: data.max || limits.max,
      maxNameLength: data.maxNameLength || limits.maxNameLength,
      maxNoteLength: data.maxNoteLength || limits.maxNoteLength,
    };
    renderCards(saved); // サーバーが整えた内容に合わせる
  }

  async function load(){
    if(saving) return; // 保存の最中は、古い内容で上書きしない
    const mine = ++epoch;
    try {
      const data = await applianceFetch();
      if(mine !== epoch) return; // その後に保存・ログアウトがあった。古い応答は捨てる
      applyData(data);
    } catch(err){
      if(mine !== epoch) return;
      showStatus(err.message, true);
    }
    renderMeta();
  }

  async function save(){
    if(saving) return;
    const list = currentList();
    // 通信する前に、画面でも確認する(サーバーも同じ確認をする)
    if(list.length > limits.max){ showStatus('登録できるのは' + limits.max + '台までです。', true); return; }
    const noName = list.findIndex(a => !a.name);
    if(noName >= 0){ showStatus((noName + 1) + '台目の名前を入力してください。', true); return; }
    const longName = list.find(a => a.name.length > limits.maxNameLength);
    if(longName){ showStatus('名前「' + longName.name.slice(0, 8) + '…」は長すぎます(' + limits.maxNameLength + '文字までです)。', true); return; }
    const longNote = list.find(a => a.note.length > limits.maxNoteLength);
    if(longNote){ showStatus('「' + longNote.name.slice(0, 8) + '」の補足は長すぎます(' + limits.maxNoteLength + '文字までです)。', true); return; }
    saving = true;
    const mine = ++epoch; // 読み込み中の古い応答は、これで無効になる
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    showStatus('保存しています…', false);
    try {
      const data = await applianceFetch({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliances: list }),
      });
      if(mine !== epoch) return; // 保存の最中にログアウトした。応答は別の人の画面に出さない
      applyData(data);
      showStatus('保存しました。次のレシピ作成から反映されます。', false);
    } catch(err){
      if(mine !== epoch) return;
      showStatus(err.message, true); // 失敗しても、入力した内容は消さない
    } finally {
      if(mine === epoch){
        saving = false;
        saveBtn.textContent = '保存';
        renderMeta();
      }
    }
  }

  function initAppliances(){
    try {
      if(typeof document.createElement !== 'function' || !document.head) return;
      const view = document.getElementById('view-settings');
      const adminEl = document.getElementById('admin-section');
      if(!view || !adminEl || typeof APPLIANCE_OPS === 'undefined') return;

      const style = document.createElement('style');
      style.id = 'appliances-style';
      style.textContent = APPL_CSS;
      document.head.appendChild(style);

      sectionEl = document.createElement('div');
      sectionEl.id = 'appliances-section';
      sectionEl.hidden = true;
      sectionEl.innerHTML = APPL_HTML;
      view.insertBefore(sectionEl, adminEl); // 「マイキッチン」の下・管理者設定の上

      listEl = document.getElementById('appliances-list');
      countEl = document.getElementById('appliances-count');
      statusEl = document.getElementById('appliances-status');
      saveBtn = document.getElementById('btn-appliances-save');
      presetBtn = document.getElementById('btn-appliance-preset');
      customBtn = document.getElementById('btn-appliance-custom');
      presetListEl = document.getElementById('appliance-preset-list');

      APPLIANCE_PRESETS.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary appliance-preset-btn';
        b.setAttribute('data-key', p.key);
        b.textContent = p.name;
        b.addEventListener('click', function(){
          const card = addCard(p);
          closePresets();
          renderMeta();
          if(card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
        });
        presetListEl.appendChild(b);
      });
      presetBtn.addEventListener('click', function(){
        const open = presetListEl.hidden;
        presetListEl.hidden = !open;
        presetBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      customBtn.addEventListener('click', function(){
        const card = addCard({});
        closePresets();
        renderMeta();
        if(card) card.querySelector('.appliance-name').focus();
      });
      saveBtn.addEventListener('click', save);
      renderCards([]);
      renderMeta();
    } catch(err){
      sectionEl = null; // 作れなかったときは、この機能だけ使わない
      recordError(err, { step: 'init' });
    }
  }

  // ログイン状態が変わるたびに settings.js の onAuthChanged から呼ばれる。ログイン中だけ表示し、登録内容を読み込む
  window.onAppliancesAuthChanged = function(){
    if(!sectionEl) return;
    const loggedIn = isLoggedIn();
    sectionEl.hidden = !loggedIn;
    if(loggedIn){
      load();
    } else {
      epoch++;           // 通信中の古い応答を無効にする
      saving = false;
      if(saveBtn) saveBtn.textContent = '保存';
      saved = [];
      renderCards([]);
      closePresets();
      showStatus('', false);
      renderMeta();
    }
  };

  initAppliances();
  window.onAppliancesAuthChanged();
})();
