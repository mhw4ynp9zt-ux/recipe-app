// 設定タブの「使っている調理家電」欄。js/settings.js の「マイキッチン」と同じ作りです。
// 【説明書PDFからのみ登録】家電は「説明書PDFから追加」でだけ増やせます(手入力・ひな形からの追加はありません)。
//   読み取った内容は、見返しやすい「情報の一覧」(できること・できないこと・容量・モード・範囲・注意点・補足)で表示し、
//   「編集」で名前・できる操作・仕様・補足を直せます。保存は「保存」ボタンのみ(自動保存はしません)。
// ※読み取り(/api/user/appliances/extract)だけがAI(有料)を呼びます。1回の読み取りでAIは1回・1日3回まで(サーバー側で制限)。
//   画面側でも、読み取り中は次の読み取りを受け付けません(同時に1件だけ)。保存・表示のAPIはDBの読み書きだけでAIは呼びません。
// ※作れなかったときは、この機能だけ使わず、ほかの機能は止めません。
// ※「できる操作」の選択肢は js/config.js の APPLIANCE_OPS、仕様の上限は APPLIANCE_SPEC_LIMITS。
(function(){
  const APPL_URL = '/api/user/appliances';
  const EXTRACT_URL = APPL_URL + '/extract';
  const ADD_LABEL = '説明書PDFから追加';
  const REREAD_LABEL = 'PDFで読み直す';
  const READING_LABEL = '読み取り中…';
  const NOT_READ = '読み取れませんでした';

  const APPL_CSS =
    '#appliances-section{margin-top:16px;}' +
    '#appliances-section .appliance-list{display:flex; flex-direction:column; gap:12px; margin:0;}' +
    '#appliances-section .appliance-card{position:relative; box-sizing:border-box; padding:12px 12px 14px; border:1.5px solid var(--line-strong); border-radius:14px; background:#fff;}' +
    '#appliances-section .appliance-head{display:flex; align-items:center; gap:8px;}' +
    '#appliances-section .appliance-title{flex:1 1 auto; min-width:0; margin:0; font-size:16px; font-weight:700; line-height:1.4; overflow-wrap:anywhere;}' +
    '#appliances-section .appliance-name{flex:1 1 auto; min-width:0; box-sizing:border-box; min-height:44px; padding:8px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px; font-weight:700;}' +
    '#appliances-section .appliance-remove{flex:0 0 auto; width:44px; height:44px; padding:0; border:none; border-radius:50%; background:transparent; color:var(--ink-soft); font-size:22px; line-height:1; cursor:pointer;}' +
    '#appliances-section .appliance-banner{margin:8px 0 0; padding:8px 12px; border-radius:10px; background:var(--accent-soft); color:var(--ink); font-size:13px; line-height:1.5;}' +
    '#appliances-section .appliance-info{margin:10px 0 0; padding:0;}' +
    '#appliances-section .appliance-info-row{padding:8px 0; border-top:1px solid var(--line-strong);}' +
    '#appliances-section .appliance-info-row:first-child{border-top:none;}' +
    '#appliances-section .appliance-info dt{margin:0 0 2px; font-size:12.5px; font-weight:700; color:var(--ink-soft);}' +
    '#appliances-section .appliance-info dd{margin:0; font-size:15px; line-height:1.55; color:var(--ink); overflow-wrap:anywhere;}' +
    '#appliances-section .appliance-info dd.is-empty{color:var(--ink-faint); font-size:13.5px;}' +
    '#appliances-section .appliance-info ul{margin:0; padding:0; list-style:none;}' +
    '#appliances-section .appliance-info li{margin:0; padding:1px 0;}' +
    '#appliances-section .appliance-info li + li{margin-top:2px;}' +
    '#appliances-section .appliance-info .info-sub{color:var(--ink-soft); font-size:13.5px;}' +
    '#appliances-section .appliance-actions{display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;}' +
    '#appliances-section .appliance-actions .btn{flex:1 1 0; min-height:48px; padding-left:8px; padding-right:8px;}' +
    '#appliances-section .appliance-actions .btn:disabled{opacity:.5;}' +
    '#appliances-section .appliance-msg{margin:8px 0 0; font-size:13.5px; color:var(--protein);}' +
    '#appliances-section .appliance-msg:empty{display:none;}' +
    '#appliances-section .appliance-msg.is-ok{color:var(--veg);}' +
    '#appliances-section .appliance-label{display:block; margin:12px 0 4px; font-size:12.5px; font-weight:700; color:var(--ink-soft);}' +
    '#appliances-section .appliance-ops{display:flex; flex-wrap:wrap; gap:6px;}' +
    '#appliances-section .appliance-op-label{display:inline-flex; align-items:center; gap:6px; min-height:36px; padding:4px 12px 4px 8px; border:1.5px solid var(--line-strong); border-radius:100px; background:#fff; color:var(--ink); font-size:14px; cursor:pointer;}' +
    '#appliances-section .appliance-op{width:20px; height:20px; margin:0; accent-color:var(--brand);}' +
    '#appliances-section .appliance-note{display:block; width:100%; box-sizing:border-box; min-height:48px; padding:10px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px; line-height:1.5; resize:vertical;}' +
    '#appliances-section .spec-editor{display:flex; flex-direction:column; gap:4px;}' +
    '#appliances-section .spec-input{display:block; width:100%; box-sizing:border-box; min-height:44px; padding:8px 12px; border:1.5px solid var(--line-strong); border-radius:12px; background:#fff; color:var(--ink); font:inherit; font-size:16px;}' +
    '#appliances-section .spec-row{display:grid; grid-template-columns:minmax(0,1fr) 44px; align-items:center; gap:6px; margin-bottom:6px;}' +
    '#appliances-section .spec-row-fields{display:flex; flex-direction:column; gap:6px; min-width:0;}' +
    '#appliances-section .spec-remove{width:44px; height:44px; padding:0; border:none; border-radius:50%; background:transparent; color:var(--ink-soft); font-size:22px; line-height:1; cursor:pointer;}' +
    '#appliances-section .spec-add{min-height:44px; min-width:44px; padding:8px 16px; align-self:flex-start;}' +
    '#appliances-section .spec-add:disabled{opacity:.5;}' +
    '#appliances-section .appliance-empty{margin:0; color:var(--ink-faint); font-size:13.5px;}' +
    '#appliances-section .appliance-add{margin-top:12px;}' +
    '#appliances-section .appliance-add-btn{display:block; width:100%; min-height:48px; padding-left:8px; padding-right:8px;}' +
    '#appliances-section .appliance-add-btn:disabled{opacity:.5;}' +
    '#appliances-section .appliance-extract-notice{margin:6px 0 0; font-size:12.5px; color:var(--ink-soft);}' +
    '#appliances-section .appliance-extract-warn{margin:4px 0 0; font-size:12.5px; color:var(--ink-soft);}' +
    '#appliances-section .appliances-meta{margin:12px 0 0; font-weight:500; color:var(--ink-soft); font-size:12.5px;}' +
    '#appliances-section .appliances-meta .dirty{color:var(--accent);}' +
    '#appliances-section .appliances-save{display:block; width:100%; margin-top:12px; min-height:48px;}' +
    '#appliances-section .status-line{text-align:left;}' +
    '.appliances-note{margin-top:14px;}';

  const APPL_HTML =
    '<section class="panel">' +
      '<div class="panel-head"><h3>使っている調理家電</h3></div>' +
      '<p class="input-hint">お持ちの調理家電の説明書(PDF)を読み取って登録します。登録した内容はレシピを作るたびにAIへ伝わり、その家電でできない工程(例:炒められない家電で「炒める」)や、容量・温度・時間の範囲を超える手順を書かないようにします。読み取った内容が合っているか見返し、違うところは「編集」で直せます。</p>' +
      '<div class="appliance-list" id="appliances-list"></div>' +
      '<div class="appliance-add">' +
        '<button type="button" class="btn btn-secondary appliance-add-btn" id="btn-appliance-add">' + ADD_LABEL + '</button>' +
        '<input type="file" id="appliance-file" accept="application/pdf" hidden>' +
        '<p class="appliance-extract-notice">説明書の内容はAIに送信されます。PDFそのものは保存されません。1日3回まで</p>' +
        '<p class="appliance-extract-warn">読み取り中はこの画面を閉じないでください</p>' +
        '<p class="appliance-msg" id="appliance-add-msg" role="status"></p>' +
      '</div>' +
      '<p class="appliances-meta" id="appliances-count"></p>' +
      '<button type="button" class="btn btn-secondary appliances-save" id="btn-appliances-save">保存</button>' +
      '<p id="appliances-status" class="status-line" hidden></p>' +
      '<p class="input-hint appliances-note">保存した内容は、次のレシピ作成から反映されます。チェックのない操作は「できない操作」としてAIに伝わります。AIがすべてに応えられないこともあります。</p>' +
    '</section>';

  let sectionEl = null, listEl = null, countEl = null, statusEl = null, saveBtn = null, addBtn = null, fileEl = null, addMsgEl = null;
  let saved = [];                                                              // サーバーに保存されている内容(未保存の判定用)
  let limits = { max: 5, maxNameLength: 20, maxNoteLength: 100 };              // サーバーの上限(読み込み時に更新)
  let saving = false;                                                          // 保存の通信の最中か
  let readsInFlight = 0;                                                       // 説明書の読み取り(AI呼び出しを含む)の最中の件数(0か1)。0より大きい間は、保存と次の読み取りを受け付けない
  let readTarget = null;                                                       // いま読み取りの対象にしているもの: { card } = その家電を読み直す / null = 新しく追加
  let activeReadBtn = null;                                                    // 「読み取り中…」と表示しているボタン
  let readingCard = null;                                                      // 読み直しの最中の家電(新規追加の読み取りなら null)
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
  function opLabel(id){ const o = APPLIANCE_OPS.find(x => x.id === id); return o ? o.label : id; }
  function dedupeKey(t){ return String(t).normalize('NFKC').toLowerCase().replace(/\s+/g, ''); }

  // 仕様(spec)を整える。空なら null(=spec は項目ごと無し)。モード名の無いモードと空の注意点は捨てる
  function normalizeSpec(s){
    if(!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const modes = (Array.isArray(s.modes) ? s.modes : []).map(m => ({ name: clean(m && m.name), desc: clean(m && m.desc) })).filter(m => m.name);
    const cautions = (Array.isArray(s.cautions) ? s.cautions : []).map(clean).filter(Boolean);
    const out = { capacity: clean(s.capacity), modes: modes, ranges: clean(s.ranges), cautions: cautions };
    return (!out.capacity && !out.ranges && !modes.length && !cautions.length) ? null : out;
  }

  // サーバーや保存済みの1台分を、画面で扱う形に整える(canは正本の順・知らないidは捨てる)
  function normalize(a){
    const can = Array.isArray(a && a.can) ? a.can : [];
    const out = {
      name: clean(a && a.name),
      can: opIds().filter(id => can.indexOf(id) >= 0),
      policy: policyIds().indexOf(a && a.policy) >= 0 ? a.policy : 'optional',
      note: clean(a && a.note),
    };
    const spec = normalizeSpec(a && a.spec);
    if(spec) out.spec = spec; // 空なら spec キーは付けない
    return out;
  }

  function cardEls(){ return Array.prototype.slice.call(listEl.querySelectorAll('.appliance-card')); }

  // 1台分の「いまの内容」。編集中は入力欄から、そうでなければ保持している内容から
  function readCard(card){ return card._editing ? readEditors(card) : card._model; }
  function currentList(){ return cardEls().map(readCard); }

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }

  // 「できる操作」のチェック欄。read() はチェック済みの id(正本の順)
  function buildOpsEditor(can, onChange){
    const ops = el('div', 'appliance-ops');
    ops.setAttribute('role', 'group');
    const list = Array.isArray(can) ? can : [];
    APPLIANCE_OPS.forEach(op => {
      const label = el('label', 'appliance-op-label');
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
    const root = el('div', 'spec-editor');
    const changed = function(){ if(onChange) onChange(); };

    function label(text){ root.appendChild(el('span', 'appliance-label', text)); }
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
      const b = el('button', 'spec-remove ' + cls, '×');
      b.type = 'button';
      b.setAttribute('aria-label', aria);
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
      const row = el('div', 'spec-row spec-mode');
      const fields = el('div', 'spec-row-fields');
      fields.appendChild(input('spec-mode-name', m.name, L.modeName, 'モード名', 'モード名'));
      fields.appendChild(input('spec-mode-desc', m.desc, L.modeDesc, 'モードの説明', '説明(任意)'));
      row.appendChild(fields);
      row.appendChild(removeBtn('spec-mode-remove', 'このモードを削除', row));
      modesEl.appendChild(row);
    }
    v.modes.forEach(addMode);
    const addModeBtn = el('button', 'btn btn-secondary spec-add spec-mode-add', '+ モードを追加');
    addModeBtn.type = 'button';
    addModeBtn.addEventListener('click', function(){
      addMode({ name: '', desc: '' }); refresh(); changed();
      const names = modesEl.querySelectorAll('.spec-mode-name');
      names[names.length - 1].focus();
    });
    root.appendChild(addModeBtn);

    label('温度・時間などの範囲(例: 40〜100度、最大12時間)');
    const ranges = input('spec-ranges', v.ranges, L.ranges, '範囲・温度');
    root.appendChild(ranges);

    label('注意点');
    const cautionsEl = document.createElement('div');
    root.appendChild(cautionsEl);
    function addCaution(c){
      const row = el('div', 'spec-row');
      const fields = el('div', 'spec-row-fields');
      fields.appendChild(input('spec-caution', c, L.caution, '注意点'));
      row.appendChild(fields);
      row.appendChild(removeBtn('spec-caution-remove', 'この注意点を削除', row));
      cautionsEl.appendChild(row);
    }
    v.cautions.forEach(addCaution);
    const addCautionBtn = el('button', 'btn btn-secondary spec-add spec-caution-add', '+ 注意点を追加');
    addCautionBtn.type = 'button';
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

  // ---- 1台分のカード(表示モード=情報の一覧 / 編集モード=入力欄) ----
  function addCard(a, opts){
    if(cardEls().length >= limits.max) return null;
    const card = el('div', 'appliance-card');
    card._model = normalize(a || {});
    card._editing = false;
    card._parts = null;                                       // 編集中だけ { name, ops, spec, note }
    card._banner = (opts && opts.banner) || '';               // 読み取った直後などの「確認してください」の案内(保存すると消える)
    listEl.appendChild(card);
    renderCard(card);
    return card;
  }

  function renderCard(card){
    card.innerHTML = '';
    if(card._editing) renderEdit(card); else renderView(card);
  }

  function removeCard(card){
    if(card === (readTarget && readTarget.card)) readTarget = null;
    card.remove();
    renderMeta();
  }

  // 情報の一覧の1行。values は文字列の配列(0件なら「読み取れませんでした」)。sub は各行の補助説明(任意)
  function infoRow(label, values, subs){
    const row = el('div', 'appliance-info-row');
    row.appendChild(el('dt', null, label));
    const dd = el('dd');
    const items = (values || []).filter(Boolean);
    if(!items.length){
      dd.className = 'is-empty';
      dd.textContent = NOT_READ;
    } else if(items.length === 1 && !(subs && subs[0])){
      dd.textContent = items[0];
    } else {
      const ul = document.createElement('ul');
      items.forEach((t, i) => {
        const li = el('li', null, t);
        if(subs && subs[i]) li.appendChild(el('span', 'info-sub', ' — ' + subs[i]));
        ul.appendChild(li);
      });
      dd.appendChild(ul);
    }
    row.appendChild(dd);
    return row;
  }

  function renderView(card){
    const m = card._model;
    const head = el('div', 'appliance-head');
    head.appendChild(el('h4', 'appliance-title', m.name));
    const rm = el('button', 'appliance-remove', '×');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'この家電を削除');
    rm.addEventListener('click', function(){ removeCard(card); });
    head.appendChild(rm);
    card.appendChild(head);

    if(!m.spec){
      card.appendChild(el('p', 'appliance-banner appliance-banner-nospec', 'この家電には説明書から読み取った内容がありません。「' + REREAD_LABEL + '」で説明書を読み取るか、削除してください(説明書の内容がない家電は保存できません)。'));
    } else if(card._banner){
      card.appendChild(el('p', 'appliance-banner', card._banner));
    }

    const spec = m.spec || { capacity: '', modes: [], ranges: '', cautions: [] };
    const cannot = APPLIANCE_OPS.filter(o => m.can.indexOf(o.id) < 0).map(o => o.label);
    const dl = el('dl', 'appliance-info');
    const canRow = infoRow('できること', m.can.length ? [m.can.map(opLabel).join('、')] : []);
    if(!m.can.length){ const dd = canRow.querySelector('dd'); dd.className = ''; dd.textContent = 'なし'; }
    dl.appendChild(canRow);
    const cannotRow = infoRow('できないこと', cannot.length ? [cannot.join('、')] : []);
    if(!cannot.length){ const dd = cannotRow.querySelector('dd'); dd.className = ''; dd.textContent = 'なし'; }
    dl.appendChild(cannotRow);
    dl.appendChild(infoRow('容量', [spec.capacity]));
    dl.appendChild(infoRow('モード', spec.modes.map(x => x.name), spec.modes.map(x => x.desc)));
    dl.appendChild(infoRow('温度・時間などの範囲', [spec.ranges]));
    dl.appendChild(infoRow('注意点', spec.cautions));
    dl.appendChild(infoRow('補足', [m.note]));
    card.appendChild(dl);

    const msg = el('p', 'appliance-msg appliance-reread-msg');
    msg.setAttribute('role', 'status');
    card._msg = msg;

    const actions = el('div', 'appliance-actions');
    const edit = el('button', 'btn btn-secondary appliance-edit', '編集');
    edit.type = 'button';
    edit.addEventListener('click', function(){ card._editing = true; renderCard(card); renderMeta(); });
    actions.appendChild(edit);
    if(typeof isLoggedIn === 'function' && isLoggedIn()){
      const reread = el('button', 'btn btn-secondary appliance-reread', REREAD_LABEL);
      reread.type = 'button';
      reread.addEventListener('click', function(){ startPicking({ card: card }); });
      actions.appendChild(reread);
    }
    card.appendChild(actions);
    card.appendChild(msg);
  }

  function readEditors(card){
    const p = card._parts;
    return normalize({
      name: p.name.value,
      can: p.ops.read(),
      policy: card._model.policy,
      note: p.note.value,
      spec: p.spec.read(),
    });
  }

  function renderEdit(card){
    const m = card._model;
    const head = el('div', 'appliance-head');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'appliance-name';
    name.autocomplete = 'off';
    name.setAttribute('aria-label', '調理家電の名前');
    name.placeholder = '家電の名前';
    name.value = m.name;
    const rm = el('button', 'appliance-remove', '×');
    rm.type = 'button';
    rm.setAttribute('aria-label', 'この家電を削除');
    head.appendChild(name);
    head.appendChild(rm);
    card.appendChild(head);

    card.appendChild(el('span', 'appliance-label', 'できる操作(チェックのない操作は「できない」と伝えます)'));
    const ops = buildOpsEditor(m.can, renderMeta);
    card.appendChild(ops.el);

    const spec = buildSpecEditor(m.spec || null, renderMeta);
    card.appendChild(spec.el);

    card.appendChild(el('span', 'appliance-label', '補足(任意)'));
    const note = document.createElement('textarea');
    note.className = 'appliance-note';
    note.rows = 3;
    note.setAttribute('aria-label', '補足');
    note.value = m.note;
    card.appendChild(note);

    const actions = el('div', 'appliance-actions');
    const done = el('button', 'btn appliance-done', '編集を終わる');
    done.type = 'button';
    actions.appendChild(done);
    card.appendChild(actions);

    card._parts = { name: name, ops: ops, spec: spec, note: note };
    name.addEventListener('input', renderMeta);
    note.addEventListener('input', renderMeta);
    rm.addEventListener('click', function(){ removeCard(card); });
    done.addEventListener('click', function(){
      card._model = readEditors(card);
      card._editing = false;
      card._parts = null;
      renderCard(card);
      renderMeta();
    });
  }

  function renderCards(list){
    listEl.innerHTML = '';
    list.forEach(a => addCard(a));
  }

  function renderMeta(){
    if(!countEl) return;
    const cur = currentList();
    const dirty = JSON.stringify(cur) !== JSON.stringify(saved);
    countEl.textContent = cur.length + ' / ' + limits.max + ' 台';
    if(dirty){
      const span = el('span', 'dirty', '(未保存の変更があります)');
      countEl.appendChild(span);
    }
    const reading = readsInFlight > 0;
    const full = cur.length >= limits.max;
    addBtn.disabled = full || reading;
    Array.prototype.forEach.call(listEl.querySelectorAll('.appliance-reread'), b => { b.disabled = reading; });
    if(!reading){
      addBtn.textContent = ADD_LABEL;
      Array.prototype.forEach.call(listEl.querySelectorAll('.appliance-reread'), b => { b.textContent = REREAD_LABEL; });
    } else if(activeReadBtn && activeReadBtn.isConnected){
      activeReadBtn.textContent = READING_LABEL;
    }
    // 読み取り中の家電は、編集で内容が入れ替わらないよう編集ボタンを押せなくする
    Array.prototype.forEach.call(listEl.querySelectorAll('.appliance-card'), c => {
      const e = c.querySelector('.appliance-edit');
      if(e) e.disabled = reading && c === readingCard;
    });
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

  // ---- 説明書PDFの読み取り(新しく追加 / 既存の家電を読み直す) ----
  // PDFはこの端末で文字にし、文字だけを /extract に送る。AIを呼ぶのは /extract の1回だけ。結果はカードに入れるだけで、保存はしない
  function startPicking(target){
    if(readsInFlight > 0) return;                  // 読み取りは同時に1件だけ
    if(!target && cardEls().length >= limits.max) return;
    readTarget = target || null;
    fileEl.click();
  }

  function nameFromFile(f){
    const base = clean(String((f && f.name) || '').replace(/\.pdf$/i, ''));
    return (base || '調理家電').slice(0, limits.maxNameLength);
  }
  function uniqueName(name, exceptCard){
    const taken = new Set(cardEls().filter(c => c !== exceptCard).map(c => dedupeKey(readCard(c).name)));
    if(!taken.has(dedupeKey(name))) return name;
    for(let n = 2; n < 20; n++){
      const suffix = '(' + n + ')';
      const cand = name.slice(0, Math.max(1, limits.maxNameLength - suffix.length)) + suffix;
      if(!taken.has(dedupeKey(cand))) return cand;
    }
    return name;
  }

  async function runRead(f, target){
    const mine = sessionEpoch;
    const card = target && target.card;
    const stale = () => mine !== sessionEpoch || (card && !card.isConnected); // ログアウト・別のログイン・カードの削除/作り直しのあとの応答は出さない
    const setMsg = (t, ok) => { const m = card ? card._msg : addMsgEl; if(m){ m.textContent = t; m.classList.toggle('is-ok', !!ok); } };
    readsInFlight++;
    activeReadBtn = card ? card.querySelector('.appliance-reread') : addBtn;
    readingCard = card || null;
    setMsg('');
    renderMeta();
    try {
      if(typeof ManualText === 'undefined') throw new Error('読み取り機能を読み込めませんでした。ページを再読み込みしてください。');
      const r = await ManualText.extractFromFile(f); // 失敗したら /extract は呼ばない
      if(stale()) return;
      const sendName = card ? (readCard(card).name || nameFromFile(f)) : nameFromFile(f);
      const data = await applianceFetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sendName, text: r.text }),
      }, EXTRACT_URL);
      if(stale()) return;
      const p = data.proposal;
      if(!p || typeof p !== 'object') throw new Error('読み取り結果を受け取れませんでした。もう一度お試しください。');
      const left = (typeof data.remaining === 'number') ? '(今日はあと' + data.remaining + '回読み取れます)' : '';
      if(card){
        // 読み直し: 名前と方針は残し、できる操作・仕様・補足を読み取り結果に置き換える(保存するまでは確定しない)
        const old = card._model;
        card._model = normalize({ name: old.name, policy: old.policy, can: p.can, note: p.note, spec: p.spec });
        card._editing = false; card._parts = null;
        card._banner = '読み取り直した内容です。合っているか確認して、「保存」を押してください。';
        renderCard(card);
        setMsg('読み取りました' + left, true);
      } else {
        const created = addCard({ name: uniqueName(nameFromFile(f)), can: p.can, policy: 'optional', note: p.note, spec: p.spec },
          { banner: '読み取った内容です。合っているか確認して、「保存」を押してください。名前は「編集」から直せます。' });
        if(created){
          setMsg('読み取りました' + left, true);
          if(created.scrollIntoView) created.scrollIntoView({ block: 'nearest' });
        } else {
          setMsg('登録できるのは' + limits.max + '台までです。');
        }
      }
    } catch(err){
      if(stale()) return;
      setMsg((err && err.message) || '読み取れませんでした。もう一度お試しください。');
    } finally {
      if(mine === sessionEpoch && readsInFlight > 0) readsInFlight--; // ログイン状態が変わったときは onAppliancesAuthChanged が 0 に戻している
      if(mine === sessionEpoch){ activeReadBtn = null; readingCard = null; }
      renderMeta();
    }
  }

  // 保存前の確認(通信する前に、画面でも確認する。サーバーも同じ確認をする)
  function validate(list){
    if(list.length > limits.max) return '登録できるのは' + limits.max + '台までです。';
    const noName = list.findIndex(a => !a.name);
    if(noName >= 0) return (noName + 1) + '台目の名前を入力してください。';
    const longName = list.find(a => a.name.length > limits.maxNameLength);
    if(longName) return '名前「' + longName.name.slice(0, 8) + '…」は長すぎます(' + limits.maxNameLength + '文字までです)。';
    const longNote = list.find(a => a.note.length > limits.maxNoteLength);
    if(longNote) return '「' + longNote.name.slice(0, 8) + '」の補足は長すぎます(' + limits.maxNoteLength + '文字までです)。';
    const noSpec = list.find(a => !a.spec);
    if(noSpec) return '「' + noSpec.name.slice(0, 8) + (noSpec.name.length > 8 ? '…' : '') + '」には説明書から読み取った内容がありません。「' + REREAD_LABEL + '」で読み取るか、削除してください。';
    return '';
  }

  async function save(){
    if(saving) return;
    if(readsInFlight > 0){ showStatus('読み取りが終わるまでお待ちください', true); return; } // 保存すると画面が作り直され、読み取り結果が出せなくなる
    const list = currentList();
    const problem = validate(list);
    if(problem){ showStatus(problem, true); return; }
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
      if(!view || !adminEl || typeof APPLIANCE_OPS === 'undefined' || typeof APPLIANCE_SPEC_LIMITS === 'undefined') return;

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
      addBtn = document.getElementById('btn-appliance-add');
      fileEl = document.getElementById('appliance-file');
      addMsgEl = document.getElementById('appliance-add-msg');

      addBtn.addEventListener('click', function(){ startPicking(null); });
      fileEl.addEventListener('change', function(){
        const f = fileEl.files && fileEl.files[0];
        fileEl.value = ''; // 同じファイルをもう一度選べるように
        const target = readTarget;
        readTarget = null;
        if(!f || readsInFlight > 0) return;
        runRead(f, target);
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
    activeReadBtn = null;
    readingCard = null;
    readTarget = null;
    sectionEl.hidden = !loggedIn;
    if(loggedIn){
      load();
    } else {
      epoch++;           // 通信中の古い応答を無効にする
      saving = false;
      if(saveBtn) saveBtn.textContent = '保存';
      saved = [];
      renderCards([]);
      showStatus('', false);
      if(addMsgEl) addMsgEl.textContent = '';
      renderMeta();
    }
  };

  initAppliances();
  window.onAppliancesAuthChanged();
})();
