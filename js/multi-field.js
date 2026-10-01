// ==== 動的な入力欄(「作る」タブの「使いたい食材」と「料理名・雰囲気・ジャンル」) ====
// 入力欄を「+ 追加」ボタンで増やし、「×」ボタンで減らせます。
// create-ai.js は従来どおり #create-ingredients / #create-mood の value(1つの文字列)を読んで送ります。
// そのためこの2つは非表示の input(type="hidden")として index.html に残し、欄の内容が変わるたびに、
// 空欄を除いて区切り文字でつないだ文字列を value に入れます(create-ai.js・サーバー・AIへ渡る形は変わりません)。
//   ・使いたい食材 … スペース区切り(従来の「スペース区切りで入力」と同じ形)
//   ・料理名・雰囲気・ジャンル … 「、」区切り
// この画面の操作では、AIは呼ばれません(=費用は発生しません)。AIを呼ぶのは「レシピを作成する」ボタンだけです。
// 入力できる量には上限があります(欄の数と1欄あたりの文字数)。サーバー側の上限(食材500文字・雰囲気300文字)を超えないように決めています。
// スタイルは、進捗バー(create-ai.js)・設定タブ(settings.js)と同じ方針で、style.css を増やさずここで追加します。

  const MULTI_FIELD_CSS =
    '.multi-list{display:flex; flex-direction:column; gap:8px;}' +
    '.multi-row{display:flex; align-items:center; gap:4px;}' +
    '.multi-row input{flex:1; min-width:0;}' +
    '.row-remove{flex:0 0 auto; width:44px; height:44px; display:grid; place-items:center; border:none; border-radius:50%;' +
      ' background:transparent; color:var(--ink-faint); cursor:pointer;}' +
    '.row-remove svg{width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round;}' +
    '.row-remove:active{background:var(--bg-deep); color:var(--ink);}' +
    '.add-row-btn{display:inline-flex; align-items:center; gap:6px; margin-top:8px; min-height:44px; padding:8px 16px;' +
      ' border:1.5px dashed var(--line-strong); border-radius:100px; background:transparent; color:var(--brand);' +
      ' font-size:13.5px; font-weight:700; cursor:pointer;}' +
    '.add-row-btn svg{width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:2.2; stroke-linecap:round;}' +
    '.add-row-btn:active{background:var(--brand-soft);}' +
    '.add-row-btn:disabled{opacity:.45; cursor:default;}';

  const MULTI_FIELD_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function multiFieldEscape(str){
    return String(str).replace(/[&<>"']/g, ch => MULTI_FIELD_ESC[ch]);
  }

  // 動的な入力欄を1つ作る。
  //   cfg.listEl       … 入力欄の行を入れる要素
  //   cfg.addBtn       … 「+ 追加」ボタン
  //   cfg.valueEl      … create-ai.js が読む、非表示の input(つないだ文字列をここへ入れる)
  //   cfg.joiner       … 欄の内容をつなぐ区切り文字
  //   cfg.maxRows      … 欄の数の上限 / cfg.maxLen … 1欄あたりの文字数の上限
  //   cfg.label        … 読み上げ用の名前(「使いたい食材 1」のように番号が付く)
  //   cfg.placeholders … 欄ごとの入力例(欄の数が多いときは最後のものを使う)
  // 返り値: { getValues, setValues, add, remove }
  function createMultiField(cfg){
    const listEl = cfg.listEl;
    const addBtn = cfg.addBtn;
    const valueEl = cfg.valueEl;
    let values = [''];   // 各欄の入力(最低1欄)

    // 空欄を除き、前後の空白を取り、同じ入力の重複は1つにした一覧
    function getValues(){
      const seen = new Set();
      const result = [];
      values.forEach(v => {
        const t = String(v).trim();
        if(t && !seen.has(t)){ seen.add(t); result.push(t); }
      });
      return result;
    }

    // create-ai.js が読む値を更新する(欄がすべて空なら空文字 = 「おまかせ」)
    function sync(){
      valueEl.value = getValues().join(cfg.joiner);
    }

    function placeholderFor(i){
      return cfg.placeholders[Math.min(i, cfg.placeholders.length - 1)];
    }

    function rowHtml(v, i){
      const label = multiFieldEscape(cfg.label + ' ' + (i + 1));
      // 欄が1つだけのときは「×」を出さない(欄は最低1つ残す)
      const remove = values.length > 1
        ? '<button type="button" class="row-remove" data-idx="' + i + '" aria-label="' + label + 'を削除">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>'
        : '';
      return '<div class="multi-row">' +
        '<input type="text" data-idx="' + i + '" value="' + multiFieldEscape(v) + '"' +
          ' placeholder="' + multiFieldEscape(placeholderFor(i)) + '" maxlength="' + cfg.maxLen + '"' +
          ' autocomplete="off" autocapitalize="none" enterkeyhint="next" aria-label="' + label + '">' +
        remove + '</div>';
    }

    function focusRow(i){
      if(typeof listEl.querySelectorAll !== 'function') return;
      const target = listEl.querySelectorAll('input')[i];
      if(target && typeof target.focus === 'function') target.focus();
    }

    // 欄を描き直す。入力中の文字は values に控えてあるので、描き直しても消えない(キー入力のたびには描き直さない)
    function render(focusIdx){
      listEl.innerHTML = values.map(rowHtml).join('');
      addBtn.disabled = values.length >= cfg.maxRows;
      if(focusIdx !== undefined && focusIdx >= 0) focusRow(focusIdx);
    }

    function add(){
      const last = values.length - 1;
      // 末尾が空欄のままなら、欄を増やさずそこへ移る(空の欄が何個も並ばないように)
      if(!String(values[last]).trim()){ focusRow(last); return; }
      if(values.length >= cfg.maxRows) return;
      values.push('');
      render(values.length - 1);
      sync();
    }

    function remove(i){
      if(values.length <= 1 || !(i >= 0 && i < values.length)) return;
      values.splice(i, 1);
      render();
      sync();
    }

    function setValues(list){
      const next = (Array.isArray(list) ? list : []).map(x => String(x)).slice(0, cfg.maxRows);
      values = next.length ? next : [''];
      render();
      sync();
    }

    // 入力・削除・Enterは、行ごとではなく入れ物でまとめて受ける(イベント委任)
    listEl.addEventListener('input', (e) => {
      const t = e.target;
      if(!t || !t.dataset || t.dataset.idx === undefined) return;
      const i = Number(t.dataset.idx);
      if(i >= 0 && i < values.length){ values[i] = t.value; sync(); }
    });
    listEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.row-remove') : null;
      if(btn) remove(Number(btn.dataset.idx));
    });
    listEl.addEventListener('keydown', (e) => {
      // 日本語入力の変換を確定するEnterでは動かさない
      if(e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      const t = e.target;
      if(!t || !t.dataset || t.dataset.idx === undefined) return;
      e.preventDefault();
      const i = Number(t.dataset.idx);
      if(i < values.length - 1) focusRow(i + 1);                    // 次の欄へ
      else if(String(values[i]).trim()) add();                       // 最後の欄に入力済みなら、新しい欄を足して移る
      else if(typeof t.blur === 'function') t.blur();                // 空のままならキーボードを閉じる
    });
    addBtn.addEventListener('click', add);

    render();
    sync();
    return { getValues: getValues, setValues: setValues, add: add, remove: remove };
  }

  // 「作る」タブの2つの項目(食材・料理名/雰囲気/ジャンル)を動的な入力欄にする。
  // index.html が古く、必要な要素が無い場合は何もしない(従来の入力欄のまま動く)。
  function initCreateMultiFields(){
    const result = {};
    try {
      if(typeof document.createElement !== 'function' || !document.head) return result;
      const defs = [
        { key: 'ingredients', valueId: 'create-ingredients', listId: 'create-ingredients-list', addId: 'create-ingredients-add',
          joiner: ' ', maxRows: 10, maxLen: 30, label: '使いたい食材',
          placeholders: ['例: 鶏むね肉', '例: キャベツ', '例: 卵', '食材名'] },
        { key: 'mood', valueId: 'create-mood', listId: 'create-mood-list', addId: 'create-mood-add',
          joiner: '、', maxRows: 5, maxLen: 40, label: '料理名・雰囲気・ジャンル',
          placeholders: ['例: 親子丼', '例: さっぱり', '例: ピリ辛', '料理名・雰囲気・ジャンル'] },
      ];
      const parts = defs.map(d => ({
        def: d,
        valueEl: document.getElementById(d.valueId),
        listEl: document.getElementById(d.listId),
        addBtn: document.getElementById(d.addId),
      }));
      if(parts.some(p => !p.valueEl || !p.listEl || !p.addBtn)) return result;

      if(!document.getElementById('multi-field-style')){
        const style = document.createElement('style');
        style.id = 'multi-field-style';
        style.textContent = MULTI_FIELD_CSS;
        document.head.appendChild(style);
      }
      parts.forEach(p => {
        result[p.def.key] = createMultiField({
          listEl: p.listEl, addBtn: p.addBtn, valueEl: p.valueEl,
          joiner: p.def.joiner, maxRows: p.def.maxRows, maxLen: p.def.maxLen,
          label: p.def.label, placeholders: p.def.placeholders,
        });
      });
    } catch(err){
      if(typeof logError === 'function') logError('multi-field', err, { step: 'init' });
    }
    return result;
  }

  const createMultiFields = initCreateMultiFields();
