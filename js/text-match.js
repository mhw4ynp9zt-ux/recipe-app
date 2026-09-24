// ==== キーワード検索・表記ゆれ吸収ロジック ====

  // カタカナ→ひらがな、全角英数→半角に揃えて表記ゆれを吸収する
  function normalizeText(s){
    return s
      .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .trim();
  }

  // 総称・表記ゆれの言い換え辞書(キーは正規化後のひらがな表記)
  const INGREDIENT_ALIASES = {
    '鶏肉':['鶏'], 'とりにく':['鶏'], 'とり肉':['鶏'], 'ちきん':['鶏'],
    '豚肉':['豚'], 'ぶたにく':['豚'], 'ぶた肉':['豚'], 'ぽーく':['豚'],
    '牛肉':['牛'], 'ぎゅうにく':['牛'], 'ぎゅう肉':['牛'],
    '魚':['鮭','鱈','さば','ぶり','えび'], 'さかな':['鮭','鱈','さば','ぶり','えび'], '魚介':['鮭','鱈','さば','ぶり','えび'],
    'たまご':['卵'], 'とうふ':['豆腐'],
    'さけ':['鮭'], 'しゃけ':['鮭'], 'たら':['鱈'], '海老':['えび'],
    'まめ':['豆腐','厚揚げ','枝豆','ひよこ豆','ミックスビーンズ','納豆'], '豆類':['豆腐','厚揚げ','枝豆','ひよこ豆','ミックスビーンズ','納豆'],
    'きのこ':['しめじ','えのき','しいたけ','えりんぎ','きくらげ'],
  };

  // 材料表記を「かな・漢字のかたまり」単位に分割する(数字・記号・調味料の区切りで割る)
  function tokenize(s){
    return normalizeText(s).split(/[\s・、,()（）0-9a-zA-Z\/／…〜~%％]+/).filter(t => t.length > 0);
  }

  // 2つの文字列がどれくらい似ているかを編集距離で測る(順序も考慮するため、
  // 文字の種類がたまたま似ているだけの無関係な単語を誤って拾いにくい)
  function levenshtein(a, b){
    const m = a.length, n = b.length;
    if(m === 0) return n;
    if(n === 0) return m;
    const dp = new Array(n + 1);
    for(let j = 0; j <= n; j++) dp[j] = j;
    for(let i = 1; i <= m; i++){
      let prev = dp[0];
      dp[0] = i;
      for(let j = 1; j <= n; j++){
        const temp = dp[j];
        dp[j] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, dp[j], dp[j-1]);
        prev = temp;
      }
    }
    return dp[n];
  }

  // 1つのキーワードが、あるレシピの材料と「どれくらい一致するか」を判定する。
  // 2: そのまま/別名で一致  1: 文字の重なりが多いあいまい一致  0: 不一致
  function matchLevel(keywordRaw, ingredientsList){
    const kw = normalizeText(keywordRaw);
    if(!kw) return 0;
    const tokens = ingredientsList.flatMap(tokenize);
    if(tokens.some(t => t.includes(kw) || kw.includes(t))) return 2;
    const aliasTargets = INGREDIENT_ALIASES[kw];
    if(aliasTargets && tokens.some(t => aliasTargets.some(a => t.includes(normalizeText(a))))) return 2;
    if(kw.length >= 2){
      for(const t of tokens){
        if(t.length < 2) continue;
        const dist = levenshtein(kw, t);
        if(dist / Math.max(kw.length, t.length) <= 0.34) return 1;
      }
    }
    return 0;
  }

  // キーワードがレシピ名に含まれているか(表記ゆれ吸収込み)
  function nameMatches(keywordRaw, name){
    const kw = normalizeText(keywordRaw);
    if(!kw) return false;
    return normalizeText(name).includes(kw);
  }

  function scoreMatch(recipe, keywords){
    if(!keywords.length) return 0;
    return keywords.reduce((sum, k) => {
      const nameLevel = nameMatches(k, recipe.name) ? 3 : 0;
      return sum + Math.max(nameLevel, matchLevel(k, recipe.ingredients));
    }, 0);
  }

