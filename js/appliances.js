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
    '#appliances-section .appliance-spec{margin-top:12px;}' +
    '#appliances-section .appliance-spec summary{display:flex; align-items:center; min-height:44px; font-size:13.5px; font-weight:700; color:var(--ink-soft); cursor:pointer;}' +
    '#appliances-section .spec-editor{display:flex; flex-direction:column; gap:4px;}' +
    '#appliances-section .spec-input{display:block; width:100%; box-sizing:border-box; min-height:44px; padding:8px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px;}' +
    '#appliances-section .spec-row{display:grid; grid-template-columns:minmax(0,1fr) 44px; align-items:center; gap:6px; margin-bottom:6px;}' +
    '#appliances-section .spec-row-fields{display:flex; flex-direction:column; gap:6px; min-width:0;}' +
    '#appliances-section .spec-remove{width:44px; height:44px; padding:0; border:none; border-radius:50%; background:transparent; color:var(--ink-soft); font-size:22px; line-height:1; cursor:pointer;}' +
    '#appliances-section .spec-add{min-height:44px; min-width:44px; padding:8px 16px; align-self:flex-start;}' +
    '#appliances-section .spec-add:disabled{opacity:.5;}' +
    '#appliances-section .appliance-extract{margin-top:12px;}' +
    '#appliances-section .appliance-extract-btn{min-height:48px; width:100%; padding-left:8px; padding-right:8px;}' +
    '#appliances-section .appliance-extract-btn:disabled{opacity:.6;}' +
    '#appliances-section .appliance-extract-notice{margin:6px 0 0; font-size:12.5px; color:var(--ink-soft);}' +
    '#appliances-section .appliance-extract-warn{margin:4px 0 0; font-size:12.5px; color:var(--ink-soft);}' +
    '#appliances-section .appliance-extract-msg{margin:8px 0 0; font-size:13.5px; color:var(--protein);}' +
    '#appliances-section .appliance-extract-msg:empty{display:none;}' +
    '#appliances-section .appliance-extract-panel{box-sizing:border-box; margin-top:10px; padding:12px; border:1.5px dashed var(--line-strong); border-radius:12px; background:var(--bg-deep);}' +
    '#appliances-section .appliance-extract-title{margin:0 0 4px; font-size:14px; font-weight:700;}' +
    '#appliances-section .appliance-extract-proposal-note{margin:8px 0 0; font-size:13.5px; color:var(--ink-soft); overflow-wrap:anywhere;}' +
    '#appliances-section .appliance-extract-actions{display:flex; gap:8px; margin-top:12px;}' +
    '#appliances-section .appliance-extract-actions .btn{flex:1 1 0; min-height:48px; padding-left:8px; padding-right:8px;}' +
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
  let readsInFlight = 0;                                                       // 説明書の読み取り(AI呼び出しを含む)の最中の件数。0より大きい間は保存を受け付けない(カードが作り直され、支払い済みの結果が捨てられるのを防ぐ)
  let sessionEpoch = 0;                                                        // ログイン状態が変わるたびに進める。読み取り中の応答が、別の人の画面に出ないようにする
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
  // 仕様(spec)を整える。空なら null(=spec は項目ごと無し)。モード名の無いモードと空の注意点は捨てる
  function normalizeSpec(s){
    if(!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const modes = (Array.isArray(s.modes) ? s.modes : []).map(m => ({ name: clean(m && m.name), desc: clean(m && m.desc) })).filter(m => m.name);
    const cautions = (Array.isArray(s.cautions) ? s.cautions : []).map(clean).filter(Boolean);
    const out = { capacity: clean(s.capacity), modes: modes, ranges: clean(s.ranges), cautions: cautions };
    return (!out.capacity && !out.ranges && !modes.length && !cautions.length) ? null : out;
  }

  function normalize(a){
    const can = Array.isArray(a && a.can) ? a.can : [];
    const out = {
      name: clean(a && a.name),
      can: opIds().filter(id => can.indexOf(id) >= 0),
      policy: policyIds().indexOf(a && a.policy) >= 0 ? a.policy : 'optional',
      note: clean(a && a.note),
    };
    const spec = normalizeSpec(a && a.spec);
    if(spec) out.spec = spec; // 空なら spec キーは付けない(従来の家電と同じ形)
    return out;
  }

  function cardEls(){ return Array.prototype.slice.call(listEl.querySelectorAll('.appliance-card')); }

  // 画面の中身を、サーバーへ送る形で取り出す
  function currentList(){
    return cardEls().map(card => normalize({
      name: card.querySelector('.appliance-name').value,
      can: card._parts.ops.read(),
      policy: card.querySelector('.appliance-policy').value,
      note: card.querySelector('.appliance-note').value,
      spec: card._parts.spec.read(),
    }));
  }

  // 「できる操作」のチェック欄。カードの中と、読み取りの確認欄の両方で使う。read() はチェック済みの id(正本の順)
  function buildOpsEditor(can, onChange){
    const ops = document.createElement('div');
    ops.className = 'appliance-ops';
    ops.setAttribute('role', 'group');
    const list = Array.isArray(can) ? can : [];
    APPLIANCE_OPS.forEach(op => {
      const label = document.createElement('label');
      label.className = 'appliance-op-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'appliance-op';
      cb.setAttribute('data-op', op.id);
      cb.checked = list.indexOf(op.id) >= 0;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(op.label));
      ops.appendChild(label);
      if(onChange) cb.addEventListener('change', onChange);
    });
    return {
      el: ops,
      read: function(){
        return Array.prototype.filter.call(ops.querySelectorAll('.appliance-op'), c => c.checked).map(c => c.getAttribute('data-op'));
      },
    };
  }

  // 仕様(容量・モード・範囲・注意点)の編集欄。read() は整えた Spec、すべて空なら null
  function buildSpecEditor(spec, onChange){
    const L = APPLIANCE_SPEC_LIMITS;
    const v = normalizeSpec(spec) || { capacity: '', modes: [], ranges: '', cautions: [] };
    const root = document.createElement('div');
    root.className = 'spec-editor';
    const changed = function(){ if(onChange) onChange(); };

    function label(text){
      const l = document.createElement('span');
      l.className = 'appliance-label';
      l.textContent = text;
      root.appendChild(l);
    }
    function input(cls, value, max, aria, placeholder){
      const i = document.createElement('input');
      i.type = 'text';
      i.className = 'spec-input ' + cls;
      i.autocomplete = 'off';
      i.maxLength = max;
      i.value = value;
      i.setAttribute('aria-label', aria);
      if(placeholder) i.placeholder = placeholder;
      i.addEventListener('input', changed);
      return i;
    }
    function removeBtn(cls, aria, row){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'spec-remove ' + cls;
      b.setAttribute('aria-label', aria);
      b.textContent = '×';
      b.addEventListener('click', function(){ row.remove(); refresh(); changed(); });
      return b;
    }

    label('容量');
    const capacity = input('spec-capacity', v.capacity, L.capacity, '容量', '例: 2.4L');
    root.appendChild(capacity);

    label('モード(名前と説明)');
    const modesEl = document.createElement('div');
    root.appendChild(modesEl);
    function addMode(m){
      const row = document.createElement('div');
      row.className = 'spec-row spec-mode';
      const fields = document.createElement('div');
      fields.className = 'spec-row-fields';
      fields.appendChild(input('spec-mode-name', m.name, L.modeName, 'モード名', 'モード名'));
      fields.appendChild(input('spec-mode-desc', m.desc, L.modeDesc, 'モードの説明', '説明(任意)'));
      row.appendChild(fields);
      row.appendChild(removeBtn('spec-mode-remove', 'このモードを削除', row));
      modesEl.appendChild(row);
    }
    v.modes.forEach(addMode);
    const addModeBtn = document.createElement('button');
    addModeBtn.type = 'button';
    addModeBtn.className = 'btn btn-secondary spec-add spec-mode-add';
    addModeBtn.textContent = '+ モードを追加';
    addModeBtn.addEventListener('click', function(){
      addMode({ name: '', desc: '' }); refresh(); changed();
      const names = modesEl.querySelectorAll('.spec-mode-name');
      names[names.length - 1].focus();
    });
    root.appendChild(addModeBtn);

    label('範囲・温度(例: 40〜100度、最大12時間)');
    const ranges = input('spec-ranges', v.ranges, L.ranges, '範囲・温度');
    root.appendChild(ranges);

    label('注意点');
    const cautionsEl = document.createElement('div');
    root.appendChild(cautionsEl);
    function addCaution(c){
      const row = document.createElement('div');
      row.className = 'spec-row';
      const fields = document.createElement('div');
      fields.className = 'spec-row-fields';
      fields.appendChild(input('spec-caution', c, L.caution, '注意点'));
      row.appendChild(fields);
      row.appendChild(removeBtn('spec-caution-remove', 'この注意点を削除', row));
      cautionsEl.appendChild(row);
    }
    v.cautions.forEach(addCaution);
    const addCautionBtn = document.createElement('button');
    addCautionBtn.type = 'button';
    addCautionBtn.className = 'btn btn-secondary spec-add spec-caution-add';
    addCautionBtn.textContent = '+ 注意点を追加';
    addCautionBtn.addEventListener('click', function(){
      addCaution(''); refresh(); changed();
      const cs = cautionsEl.querySelectorAll('.spec-caution');
      cs[cs.length - 1].focus();
    });
    root.appendChild(addCautionBtn);

    function refresh(){
      addModeBtn.disabled = modesEl.children.length >= L.modes;
      addCautionBtn.disabled = cautionsEl.children.length >= L.cautions;
    }
    refresh();

    return {
      el: root,
      read: function(){
        return normalizeSpec({
          capacity: capacity.value,
          modes: Array.prototype.map.call(modesEl.querySelectorAll('.spec-mode'), r => ({ name: r.querySelector('.spec-mode-name').value, desc: r.querySelector('.spec-mode-desc').value })),
          ranges: ranges.value,
          cautions: Array.prototype.map.call(cautionsEl.querySelectorAll('.spec-caution'), i => i.value),
        });
      },
    };
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
    const opsEditor = buildOpsEditor(v.can, renderMeta);
    card.appendChild(opsEditor.el);

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

    // 仕様(任意)の編集欄(折りたたみ)
    const details = document.createElement('details');
    details.className = 'appliance-spec';
    const summary = document.createElement('summary');
    summary.textContent = '仕様(任意)';
    details.appendChild(summary);
    const specEditor = buildSpecEditor(v.spec || null, renderMeta);
    details.appendChild(specEditor.el);
    card.appendChild(details);
    card._parts = { ops: opsEditor, spec: specEditor };

    // 説明書PDFから読み取る(ログイン中だけ)
    if(typeof isLoggedIn === 'function' && isLoggedIn()) addExtract(card, name, note);

    name.addEventListener('input', renderMeta);
    pol.addEventListener('change', renderMeta);
    note.addEventListener('input', renderMeta);
    rm.addEventListener('click', function(){ card.remove(); renderMeta(); });
    listEl.appendChild(card);
    return card;
  }

  // 説明書PDFの読み取り(カード内)。PDFはこの端末で文字にし、文字だけを /extract に送る。反映しただけでは保存しない
  const EXTRACT_LABEL = '説明書PDFから読み取る';
  function addExtract(card, nameEl, noteEl){
    const wrap = document.createElement('div');
    wrap.className = 'appliance-extract';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary appliance-extract-btn';
    btn.textContent = EXTRACT_LABEL;
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/pdf';
    file.hidden = true;
    const notice = document.createElement('p');
    notice.className = 'appliance-extract-notice';
    notice.textContent = '説明書の内容はAIに送信されます。PDFそのものは保存されません。1日3回まで';
    const warn = document.createElement('p');
    warn.className = 'appliance-extract-warn';
    warn.textContent = '読み取り中はこの画面を閉じないでください';
    const msg = document.createElement('p');
    msg.className = 'appliance-extract-msg';
    msg.setAttribute('role', 'status');
    const slot = document.createElement('div');
    wrap.appendChild(btn); wrap.appendChild(file); wrap.appendChild(notice); wrap.appendChild(warn); wrap.appendChild(msg); wrap.appendChild(slot);
    card.appendChild(wrap);

    let reading = false; // 読み取りの最中か(二重押しでも通信は1回)
    btn.addEventListener('click', function(){ if(!reading) file.click(); });

    function showPanel(proposal){
      slot.innerHTML = '';
      const panel = document.createElement('div');
      panel.className = 'appliance-extract-panel';
      const title = document.createElement('p');
      title.className = 'appliance-extract-title';
      title.textContent = '読み取った内容(確認・修正してください)';
      panel.appendChild(title);
      const l1 = document.createElement('span');
      l1.className = 'appliance-label';
      l1.textContent = 'できる操作';
      panel.appendChild(l1);
      const ops = buildOpsEditor(proposal.can);
      panel.appendChild(ops.el);
      const spec = buildSpecEditor(proposal.spec);
      panel.appendChild(spec.el);
      const pnote = clean(proposal.note);
      if(pnote){
        const n = document.createElement('p');
        n.className = 'appliance-extract-proposal-note';
        n.textContent = '補足の候補: ' + pnote;
        panel.appendChild(n);
      }
      const actions = document.createElement('div');
      actions.className = 'appliance-extract-actions';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'btn appliance-extract-apply';
      apply.textContent = 'この内容を反映';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn btn-secondary appliance-extract-cancel';
      cancel.textContent = 'やめる';
      actions.appendChild(apply); actions.appendChild(cancel);
      panel.appendChild(actions);
      apply.addEventListener('click', function(){
        const o = buildOpsEditor(ops.read(), renderMeta);
        card._parts.ops.el.replaceWith(o.el);
        card._parts.ops = o;
        const sp = buildSpecEditor(spec.read(), renderMeta);
        card._parts.spec.el.replaceWith(sp.el);
        card._parts.spec = sp;
        if(pnote && !clean(noteEl.value)) noteEl.value = pnote; // 補足は、空のときだけ入れる
        slot.innerHTML = '';
        renderMeta(); // 保存はしない(「保存」ボタンのみ)
      });
      cancel.addEventListener('click', function(){ slot.innerHTML = ''; });
      slot.appendChild(panel);
    }

    file.addEventListener('change', async function(){
      const f = file.files && file.files[0];
      file.value = ''; // 同じファイルをもう一度選べるように
      if(!f || reading) return;
      reading = true;
      const mine = sessionEpoch;
      readsInFlight++;
      const stale = () => mine !== sessionEpoch || !card.isConnected; // ログアウト・別のログイン・カードの削除/作り直しのあとの応答は出さない
      btn.disabled = true;
      btn.textContent = '読み取り中…';
      msg.textContent = '';
      slot.innerHTML = '';
      try {
        if(typeof ManualText === 'undefined') throw new Error('読み取り機能を読み込めませんでした。ページを再読み込みしてください。');
        const r = await ManualText.extractFromFile(f); // 失敗したら /extract は呼ばない
        if(stale()) return;
        const data = await applianceFetch({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: clean(nameEl.value) || '調理家電', text: r.text }),
        }, APPL_URL + '/extract');
        if(stale()) return;
        if(!data.proposal || typeof data.proposal !== 'object') throw new Error('読み取り結果を受け取れませんでした。もう一度お試しください。');
        showPanel(data.proposal);
      } catch(err){
        if(stale()) return;
        msg.textContent = (err && err.message) || '読み取れませんでした。もう一度お試しください。';
      } finally {
        reading = false;
        if(mine === sessionEpoch && readsInFlight > 0) readsInFlight--; // ログイン状態が変わったときは onAppliancesAuthChanged が 0 に戻している
        if(!stale()){ btn.disabled = false; btn.textContent = EXTRACT_LABEL; }
      }
    });
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

  async function applianceFetch(options, url){
    const method = (options && options.method) || 'GET';
    let res;
    try {
      res = await fetch(url || APPL_URL, options);
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
    if(readsInFlight > 0){ showStatus('読み取りが終わるまでお待ちください', true); return; } // 保存すると画面が作り直され、読み取り結果が出せなくなる
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
    sessionEpoch++;
    readsInFlight = 0; // 古い読み取りの応答は sessionEpoch で捨てられる
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
