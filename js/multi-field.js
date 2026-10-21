// ==== 動的な入力欄(「作る」タブの、1品ごとの「使いたい食材」と「料理名・雰囲気・ジャンル」) ====
// 品数(1〜3品)に合わせて「1品目」「2品目」「3品目」のカードを出し、カードごとに2つの項目を入力します。
//   ・使いたい食材 … 欄を「+ 追加」で増やし、「×」で減らせる(1品あたり最大10個)
//   ・料理名・雰囲気・ジャンル … 同じく増減できる(1品あたり最大5個)
// 1品のときは「1品目」の見出しを出さず、従来と同じ見た目の1カードだけになります。
// 品数を減らして増やし直しても、入力した内容は消えません(送るのは、選択中の品数分だけです)。
//
// create-ai.js は createMultiFields.getDishInputs(品数) で、品ごとの入力([{ ingredients, mood }, …])を受け取って送ります。
//   ・使いたい食材 … スペース区切りの文字列(従来の「スペース区切りで入力」と同じ形)
//   ・料理名・雰囲気・ジャンル … 「、」区切りの文字列
//   ・空欄は除き、同じ入力の重複は1つにまとめます。何も入力しなければ空文字(=その品は「おまかせ」)
// この画面の操作では、AIは呼ばれません(=費用は発生しません)。AIを呼ぶのは「レシピを作成する」ボタンだけです。
// 入力できる量には上限があります(欄の数と1欄あたりの文字数)。サーバー側の1品あたりの上限(食材500文字・雰囲気300文字)を超えないように決めています。
// スタイルは、進捗バー(create-ai.js)・設定タブ(settings.js)と同じ方針で、style.css を増やさずここで追加します。
// index.html が古く、必要な要素が無い場合は何もしません(createMultiFields.ready が false のまま。create-ai.js は従来の入力を使います)。

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
    '.add-row-btn:disabled{opacity:.45; cursor:default;}' +
    '.dish-card + .dish-card{margin-top:20px; padding-top:18px; border-top:1.5px dashed var(--line-strong);}' +
    '.dish-card-title{margin:0 0 12px; font-size:15px; font-weight:700; color:var(--ink);}';

  const MULTI_FIELD_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function multiFieldEscape(str){
    return String(str).replace(/[&<>"']/g, ch => MULTI_FIELD_ESC[ch]);
  }

  // 動的な入力欄を1つ作る。
  //   cfg.listEl       … 入力欄の行を入れる要素
  //   cfg.addBtn       … 「+ 追加」ボタン
  //   cfg.valueEl      … つないだ文字列を入れる入れ物({ value: '' } のような、value を持つオブジェクト)
  //   cfg.joiner       … 欄の内容をつなぐ区切り文字
  //   cfg.maxRows      … 欄の数の上限 / cfg.maxLen … 1欄あたりの文字数の上限
  //   cfg.label        … 読み上げ用の名前(「使いたい食材 1」のように番号が付く)
  //   cfg.placeholders … 欄ごとの入力例(欄の数が多いときは最後のものを使う)
  // 返り値: { getValues, getText, setValues, add, remove }
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

    // 送る文字列(欄がすべて空なら空文字 = 「おまかせ」)
    function getText(){
      return getValues().join(cfg.joiner);
    }

    function sync(){
      valueEl.value = getText();
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
    return { getValues: getValues, getText: getText, setValues: setValues, add: add, remove: remove };
  }

  // 「作る」タブの品ごとのカード(index.html の #create-dish-1〜3)を、動的な入力欄にする。
  //   カードの中の要素の id: create-dish-{n}-title / create-dish-{n}-ingredients-list・-add / create-dish-{n}-mood-list・-add
  // 返り値(createMultiFields):
  //   ready          … 必要な要素がそろって、入力欄を作れたら true
  //   dishes         … [{ ingredients, mood }, …] 品ごとの入力欄(createMultiField の返り値)
  //   setCount(n)    … 品数に合わせてカードを出し分ける(1品のときは「1品目」の見出しも隠す)
  //   getDishInputs(n) … 1〜n品目の入力 [{ ingredients: '食材 食材', mood: '条件、条件' }, …]
  const MAX_DISH_CARDS = 3;
  const DISH_FIELD_DEFS = [
    { key: 'ingredients', joiner: ' ', maxRows: 10, maxLen: 30, label: '使いたい食材',
      placeholders: ['例: 鶏むね肉', '例: キャベツ', '例: 卵', '食材名'] },
    { key: 'mood', joiner: '、', maxRows: 5, maxLen: 40, label: '料理名・雰囲気・ジャンル',
      placeholders: ['例: 親子丼', '例: さっぱり', '例: ピリ辛', '料理名・雰囲気・ジャンル'] },
  ];

  // 品ごとのカード(3枚)のHTML。index.html に #create-dish-1 が無いとき(従来の「食材」「料理名・雰囲気・ジャンル」の2項目だけの index.html)に、
  // ensureDishCards が従来の2項目と入れ替えて差し込む。index.html にカードを直接書いてあれば、そちらが使われる。
  const PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  function dishCardHtml(n){
    const field = (key, label, addText, hint) =>
      '<div class="field">' +
        '<label id="create-dish-' + n + '-' + key + '-label">' + label + '</label>' +
        '<div class="multi-list" id="create-dish-' + n + '-' + key + '-list" role="group" aria-labelledby="create-dish-' + n + '-' + key + '-label"></div>' +
        '<button type="button" class="add-row-btn" id="create-dish-' + n + '-' + key + '-add">' + PLUS_SVG + addText + '</button>' +
        (hint ? '<p class="input-hint">' + hint + '</p>' : '') +
      '</div>';
    return '<div class="dish-card" id="create-dish-' + n + '"' + (n > 1 ? ' hidden' : '') + '>' +
      '<h3 class="dish-card-title" id="create-dish-' + n + '-title"' + (n === 1 ? ' hidden' : '') + '>' + n + '品目</h3>' +
      field('ingredients', '使いたい食材', '食材を追加', n === 1 ? '食材を1つずつ入力します(最大10個)。空欄なら食材もおまかせで考えます。' : '') +
      field('mood', '料理名・雰囲気・ジャンル', '条件を追加', n === 1 ? '「親子丼」のような料理名でも、「中華」「さっぱり」のような雰囲気・ジャンルでもOK。入れた条件を組み合わせて考えます(最大5個)。' : '') +
    '</div>';
  }
  const DISH_LEAD_ID = 'create-dish-lead';
  const DISH_LEAD_TEXT = '2品・3品にすると、1品ごとに食材と料理名・雰囲気・ジャンルを指定できます。指定しない品はおまかせです。';

  // 従来の2項目(#create-ingredients-list / #create-mood-list を含む .field)を、品ごとのカードに入れ替える。
  // すでにカードがある・入れ替え元が見つからない場合は何もしない。
  function ensureDishCards(){
    if(document.getElementById('create-dish-1')) return;
    const ingList = document.getElementById('create-ingredients-list');
    const moodList = document.getElementById('create-mood-list');
    if(!ingList || !moodList || typeof ingList.closest !== 'function') return;
    const ingField = ingList.closest('.field');
    const moodField = moodList.closest('.field');
    if(!ingField || !moodField || !ingField.parentNode || typeof ingField.insertAdjacentHTML !== 'function') return;
    ingField.insertAdjacentHTML('beforebegin',
      '<p class="input-hint step-lead" id="' + DISH_LEAD_ID + '">' + DISH_LEAD_TEXT + '</p>' +
      '<div id="create-dishes">' + [1, 2, 3].map(dishCardHtml).join('') + '</div>');
    ingField.remove();
    moodField.remove();
  }

  function initCreateMultiFields(){
    const result = { ready: false, dishes: [], count: 1 };
    result.setCount = function(){};
    result.getDishInputs = function(){ return []; };
    try {
      if(typeof document.createElement !== 'function' || !document.head) return result;
      ensureDishCards();
      const cards = [];
      for(let n = 1; n <= MAX_DISH_CARDS; n++){
        const card = {
          el: document.getElementById('create-dish-' + n),
          title: document.getElementById('create-dish-' + n + '-title'),
          parts: DISH_FIELD_DEFS.map(d => ({
            def: d,
            listEl: document.getElementById('create-dish-' + n + '-' + d.key + '-list'),
            addBtn: document.getElementById('create-dish-' + n + '-' + d.key + '-add'),
          })),
        };
        if(!card.el || !card.title || card.parts.some(p => !p.listEl || !p.addBtn)) return result;
        cards.push(card);
      }

      if(!document.getElementById('multi-field-style')){
        const style = document.createElement('style');
        style.id = 'multi-field-style';
        style.textContent = MULTI_FIELD_CSS;
        document.head.appendChild(style);
      }
      cards.forEach((card, idx) => {
        const fields = {};
        card.parts.forEach(p => {
          // 品によって読み上げの名前を変える(「2品目の使いたい食材 1」)
          fields[p.def.key] = createMultiField({
            listEl: p.listEl, addBtn: p.addBtn, valueEl: { value: '' },
            joiner: p.def.joiner, maxRows: p.def.maxRows, maxLen: p.def.maxLen,
            label: (idx + 1) + '品目の' + p.def.label, placeholders: p.def.placeholders,
          });
        });
        result.dishes.push(fields);
      });

      // 品数に合わせてカードを出し分ける
      result.setCount = function(n){
        const count = Math.max(1, Math.min(MAX_DISH_CARDS, Number(n) || 1));
        result.count = count;
        cards.forEach((card, idx) => {
          card.el.hidden = idx >= count;
          card.title.hidden = count === 1;   // 1品のときは「1品目」の見出しは要らない
        });
      };
      result.getDishInputs = function(n){
        const count = Math.max(1, Math.min(MAX_DISH_CARDS, Number(n) || 1));
        return result.dishes.slice(0, count).map(f => ({ ingredients: f.ingredients.getText(), mood: f.mood.getText() }));
      };
      result.setCount(1);
      result.ready = true;
    } catch(err){
      result.ready = false;
      if(typeof logError === 'function') logError('multi-field', err, { step: 'init' });
    }
    return result;
  }

  const createMultiFields = initCreateMultiFields();
