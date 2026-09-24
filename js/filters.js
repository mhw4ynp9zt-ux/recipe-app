// ==== レシピ候補の絞り込み(入力欄の読み取り・除外ワード) ====
// text-match.js の nameMatches/matchLevel、recipes-data.js/recipes-generator.js の recipes 配列に依存します。

  function poolFor(category){
    return recipes.filter(r => r.category === category);
  }

  function getWantedIngredients(){
    const raw = document.getElementById('have-ingredients').value || '';
    return raw.trim().split(/[\s\u3000]+/).map(s => s.trim()).filter(Boolean);
  }

  function getExcludeWords(){
    const raw = document.getElementById('exclude-words').value || '';
    return raw.trim().split(/[\s\u3000]+/).map(s => s.trim()).filter(Boolean);
  }

  // レシピ名または材料のいずれかに除外ワードが(表記ゆれ込みで)含まれていればtrue
  function matchesExclude(recipe, excludeWords){
    if(!excludeWords || !excludeWords.length) return false;
    return excludeWords.some(w => nameMatches(w, recipe.name) || matchLevel(w, recipe.ingredients) > 0);
  }

  // 除外ワードに一致するレシピを取り除いた候補全体を返す
  function excludeFilteredRecipes(excludeWords){
    return (excludeWords && excludeWords.length) ? recipes.filter(r => !matchesExclude(r, excludeWords)) : recipes;
  }

  function getSelectedCount(){
    const active = document.querySelector('.count-btn.active');
    return active ? parseInt(active.dataset.count, 10) : 1;
  }

  function getSelectedType(){
    const sel = document.getElementById('dish-type');
    return sel && sel.value ? sel.value : null;
  }

  function getSelectedEffort(){
    const sel = document.getElementById('effort-level');
    return sel && sel.value ? sel.value : null;
  }
