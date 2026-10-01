// ==== お持ちの食材:材料を置いていく入力 ====
// 見た目だけの部品です。入力した食材は、これまでどおり「スペース区切りの文字列」として
// 隠し入力 #create-ingredients に入れます(create-ai.js の generateRecipe はその値を読むだけで、変更なし)。
// utils.js の escapeHtml に依存します。

  const pantryHiddenEl = document.getElementById('create-ingredients');
  const pantryListEl = document.getElementById('pantry-list');
  const pantryInputEl = document.getElementById('ingredient-add');
  const pantryAddBtn = document.getElementById('ingredient-add-btn');

  let pantryItems = [];

  // スペース・読点・カンマで区切って、食材名の配列にする
  function pantryTokens(str){
    return String(str).split(/[\s\u3000、,，]+/).map(s => s.trim()).filter(Boolean);
  }

  // 隠し入力へ反映。入力途中の文字(まだ「＋」を押していないもの)も含めるので、
  // 追加を忘れたままレシピ作成を押しても、その食材は渡る。
  function syncPantry(){
    pantryHiddenEl.value = pantryItems.concat(pantryTokens(pantryInputEl.value)).join(' ');
  }

  function renderPantry(){
    pantryListEl.innerHTML = pantryItems.map((name, i) =>
      '<li><span>' + escapeHtml(name) + '</span>' +
      '<button type="button" class="pantry-remove" data-index="' + i + '" aria-label="' + escapeHtml(name) + 'を外す">×</button></li>'
    ).join('');
  }

  function commitPantryInput(){
    const tokens = pantryTokens(pantryInputEl.value);
    tokens.forEach(t => { if(!pantryItems.includes(t)) pantryItems.push(t); });
    pantryInputEl.value = '';
    renderPantry();
    syncPantry();
  }

  pantryAddBtn.addEventListener('click', () => {
    commitPantryInput();
    pantryInputEl.focus();
  });

  pantryInputEl.addEventListener('keydown', (e) => {
    // 日本語入力の変換確定のEnterでは追加しない
    if(e.key === 'Enter' && !e.isComposing && e.keyCode !== 229){
      e.preventDefault();
      commitPantryInput();
    }
  });
  pantryInputEl.addEventListener('input', (e) => {
    // スペースや読点を打ったら、そこまでの食材を並べる(変換中は何もしない)
    if(!e.isComposing && /[\s\u3000、,，]$/.test(pantryInputEl.value)){
      commitPantryInput();
    } else {
      syncPantry();
    }
  });
  pantryInputEl.addEventListener('blur', () => {
    if(pantryInputEl.value.trim()) commitPantryInput();
  });

  pantryListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pantry-remove');
    if(!btn) return;
    pantryItems.splice(parseInt(btn.dataset.index, 10), 1);
    renderPantry();
    syncPantry();
  });
