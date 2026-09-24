// ==== レシピ作成機能(食材+雰囲気キーワード+選択した栄養指標の目標値・品数からAIがレシピを考える) ====
// config.js の NUTRIENT_METRICS/DEFAULT_GROK_MODEL、utils.js の computeEffort/withPieceCount、
// save.js の isSaved/toggleSave/recipes配列 に依存します。
// 外部AI(xAIのGrok API、OpenAI互換のchat completions形式)をブラウザから直接呼び出しています。
// APIキー・使用モデルは「設定」タブ(settings.js)で管理し、この端末のブラウザのlocalStorageに保存されます。

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  const createResultEl = document.getElementById('create-result');
  const createLoadingEl = document.getElementById('create-loading');
  const createErrorEl = document.getElementById('create-error');
  const createNoteEl = document.getElementById('create-note');
  const generateBtn = document.getElementById('btn-generate');
  const createHintEl = document.getElementById('create-target-hint');
  const metricToggleRowEl = document.getElementById('metric-toggle-row');
  const targetRowEl = document.getElementById('target-row');

  function showCreateError(msg){
    createErrorEl.textContent = msg;
    createErrorEl.hidden = false;
  }
  function hideCreateError(){
    createErrorEl.hidden = true;
  }
  function setCreateLoading(isLoading){
    createLoadingEl.hidden = !isLoading;
    generateBtn.disabled = isLoading;
    generateBtn.style.opacity = isLoading ? '0.6' : '1';
    generateBtn.textContent = isLoading ? '作成中…' : 'レシピを作成する';
  }

  function getCreateCount(){
    const active = document.querySelector('.create-count-btn.active');
    return active ? parseInt(active.dataset.count, 10) : 1;
  }

  // ==== 栄養指標のトグル選択(どの指標を今回の目安にするか、端末に保存して次回も復元) ====
  const TARGET_METRICS_KEY = 'recipeRouletteTargetMetricsV1';

  function loadEnabledMetrics(){
    let saved = null;
    try {
      const raw = localStorage.getItem(TARGET_METRICS_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch(e){ /* 復元できない環境では初期値を使う */ }
    const result = {};
    NUTRIENT_METRICS.forEach(m => {
      result[m.id] = (saved && typeof saved[m.id] === 'boolean') ? saved[m.id] : m.enabledByDefault;
    });
    return result;
  }
  function saveEnabledMetrics(){
    try { localStorage.setItem(TARGET_METRICS_KEY, JSON.stringify(enabledMetrics)); } catch(e){ /* 保存できない環境では無視 */ }
  }

  let enabledMetrics = loadEnabledMetrics();

  function getActiveMetrics(){
    return NUTRIENT_METRICS.filter(m => enabledMetrics[m.id]);
  }

  // 目標入力欄が空欄・0以下・数値以外の場合はconfig.jsの初期値にフォールバックする
  function getTargetValue(el, fallback){
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  function getCreateTarget(){
    const target = { count: getCreateCount() };
    getActiveMetrics().forEach(m => {
      const el = document.getElementById('create-target-' + m.id);
      target[m.id] = el ? getTargetValue(el, m.default) : m.default;
    });
    return target;
  }

  // 入力中の目標値・品数に応じてヒント文言を更新する
  function updateCreateHint(){
    const t = getCreateTarget();
    const active = getActiveMetrics();
    if(!active.length){
      createHintEl.textContent = '全' + t.count + '品の合計で、栄養バランスの良いレシピを考えます。';
      return;
    }
    const parts = active.map(m => m.label + t[m.id] + m.unit);
    createHintEl.textContent = '全' + t.count + '品の合計で、' + parts.join('・') + 'を目安にレシピを考えます。';
  }

  // 選択中の指標に応じて、数値目標の入力欄(target-row)を描画し直す
  function renderTargetInputs(){
    const active = getActiveMetrics();
    targetRowEl.innerHTML = active.map(m => `
      <div class="option-group">
        <label class="option-label" for="create-target-${m.id}">${m.label}(${m.unit})</label>
        <input type="number" id="create-target-${m.id}" inputmode="numeric" min="0" value="${m.default}">
      </div>
    `).join('');
    active.forEach(m => {
      document.getElementById('create-target-' + m.id).addEventListener('input', updateCreateHint);
    });
    updateCreateHint();
  }

  // トグルチップ自体を描画し直す(ON/OFFの見た目を反映)
  function renderMetricToggles(){
    metricToggleRowEl.innerHTML = NUTRIENT_METRICS.map(m =>
      `<button type="button" class="metric-toggle-btn${enabledMetrics[m.id] ? ' active' : ''}" data-metric="${m.id}">${m.label}</button>`
    ).join('');
  }

  metricToggleRowEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.metric-toggle-btn');
    if(!btn) return;
    const id = btn.dataset.metric;
    // 目安にする指標を1つも選ばない状態は避ける(AIへの目標指示が空になってしまうため)
    if(enabledMetrics[id] && getActiveMetrics().length <= 1) return;
    enabledMetrics[id] = !enabledMetrics[id];
    saveEnabledMetrics();
    renderMetricToggles();
    renderTargetInputs();
  });

  renderMetricToggles();
  renderTargetInputs();

  document.querySelectorAll('.create-count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.create-count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCreateHint();
    });
  });

  function buildCreatePrompt(ingredientsText, moodText, target){
    const active = getActiveMetrics();
    const targetText = active.length
      ? '全' + target.count + '品の合計で、' + active.map(m => m.label + 'を' + target[m.id] + m.unit + '程度').join('、') + 'になるようにしてください(多少の前後は構いませんが、大きく外れないようにしてください)。'
      : '栄養バランスの良い、一般的な家庭料理にしてください。';
    const countText = target.count === 1
      ? '1品だけで完結する料理にしてください。'
      : target.count + '品構成にしてください。実在感のある主菜+副菜の組み合わせにし、内容が偏らないよう彩りや食感に変化をつけてください。';

    const soupRule = target.count === 1
      ? '・1品だけの構成のため、スープ(種類:「スープ」)は選ばないでください\n'
      : '・スープ(種類:「スープ」)を1品含める場合、その1品に使う野菜と肉・魚介・豆腐などの具材は合計300g以内に収めてください(recorteのスープメーカーを使用しており、1回に調理できる野菜+具材が合計300gまでのため)\n';

    const nutrientFieldsText = active.length
      ? active.map((m, i) => '    "' + m.id + '": この1品のおおよその' + m.label + '量(' + m.unit + '、整数)' + (i < active.length - 1 ? ',' : '')).join('\n')
      : '    "protein": この1品のおおよそのたんぱく質量(g、整数)';

    return 'あなたは家庭料理のレシピ考案アシスタントです。以下の条件をもとに、' + target.count + '品分のレシピを考えて、JSON配列の形式のみで出力してください。前置き・説明・Markdownのコードブロック記号(```)は一切つけないでください。\n\n' +
      '【使う食材】\n' + ingredientsText + '\n\n' +
      '【料理の雰囲気・ジャンル・味の方向性】\n' + (moodText ? moodText : '指定なし(食材から自由に発想してよい)') + '\n\n' +
      '【栄養の目標】\n' + targetText + '\n\n' +
      '【品数】\n' + countText + '\n\n' +
      '【必ず守る条件】\n' +
      '・油はごま油かオリーブオイルのみ使用する(サラダ油などの他の植物油は使わない)\n' +
      '・ハム・ソーセージ・ベーコンなどの加工肉は使わない\n' +
      '・家庭で無理なく作れる、実在感のある料理にする\n' +
      '・材料には分量(g、個数、大さじなど)を必ず併記する\n' +
      '・各品の手順は3〜6ステップ程度で具体的に書く\n' +
      '・ガスコンロ(フライパン・鍋など)を使う料理は全品の中で1品までにする(スープ類はスープメーカー使用として対象外)\n' +
      soupRule + '\n' +
      '出力は必ずちょうど' + target.count + '個の要素を持つ、以下の形式のJSON配列のみとしてください(キーはこの通りに、値は日本語で入れる):\n' +
      '[\n' +
      '  {\n' +
      '    "name": "料理名",\n' +
      '    "type": "鍋・炒め物・丼・サラダ・スープ・プレート・サンド・中華・カレー・パスタ・ご飯もの・煮物・洋食のいずれか、最も近いもの",\n' +
      '    "ingredients": ["食材名 分量", "食材名 分量"],\n' +
      '    "steps": ["手順1", "手順2"],\n' +
      nutrientFieldsText + '\n' +
      '  }\n' +
      ']';
  }

  function renderCreatedCombo(dishes){
    // このバッチで実際に値が入っている指標だけをバッジ・表示対象にする(選択しなかった指標は表示しない)
    const shown = NUTRIENT_METRICS.filter(m => dishes.some(d => d[m.id] != null));
    createResultEl.hidden = false;
    createResultEl.innerHTML = `
      <div class="recipe-card">
        <p class="recipe-tag">入力した内容からAIが作成</p>
        <div class="badges">
          ${shown.map(m => {
            const total = dishes.reduce((s, d) => s + (d[m.id] || 0), 0);
            return `<span class="badge ${m.id}">${m.label}(合計・目安) ${total}${m.unit}</span>`;
          }).join('')}
        </div>
        ${dishes.map((d, i) => `
          <div class="dish-block">
            <div class="dish-head">
              <h2>${dishes.length > 1 ? (i + 1) + '. ' : ''}${escapeHtml(d.name)}</h2>
              <span class="dish-type-tag">${escapeHtml(d.type)}</span>
            </div>
            <p class="dish-macro">${shown.filter(m => d[m.id] != null).map(m => m.label + ' ' + d[m.id] + m.unit).join(' ・ ')}</p>
            <button class="save-btn${isSaved(d.id) ? ' saved' : ''}" data-id="${d.id}">${isSaved(d.id) ? '★ 保存済み' : '☆ 保存する'}</button>
            <div class="ingredients">
              <h3>材料</h3>
              <ul>${d.ingredients.map(x => '<li>' + withPieceCount(escapeHtml(x)) + '</li>').join('')}</ul>
            </div>
            <div class="steps">
              <h3>作り方</h3>
              <ol>${d.steps.map(x => '<li>' + escapeHtml(x) + '</li>').join('')}</ol>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    createNoteEl.hidden = false;
    createResultEl.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  async function generateRecipe(){
    const ingredientsRaw = document.getElementById('create-ingredients').value.trim();
    const moodRaw = document.getElementById('create-mood').value.trim();
    if(!ingredientsRaw){
      showCreateError('食材を1つ以上入力してください。');
      return;
    }
    const apiKey = document.getElementById('grok-api-key').value.trim();
    if(!apiKey){
      showCreateError('外部AI(Grok)のAPIキーが未設定です。「設定」タブで入力してください。');
      return;
    }
    const model = document.getElementById('grok-model').value || DEFAULT_GROK_MODEL;
    hideCreateError();
    setCreateLoading(true);
    createResultEl.hidden = true;
    createNoteEl.hidden = true;
    try {
      const target = getCreateTarget();
      const activeMetrics = getActiveMetrics();
      const prompt = buildCreatePrompt(ingredientsRaw, moodRaw, target);
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if(!response.ok) throw new Error('API request failed: ' + response.status);
      const data = await response.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if(!content) throw new Error('No text content in response');
      const cleaned = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.dishes) ? parsed.dishes : null);
      if(!items || !items.length){
        throw new Error('Unexpected response shape');
      }
      const batchId = Date.now();
      const dishes = items.map((parsedItem, idx) => {
        if(!parsedItem.name || !Array.isArray(parsedItem.ingredients) || !Array.isArray(parsedItem.steps)){
          throw new Error('Unexpected item shape');
        }
        const recipe = {
          id: 'created-' + batchId + '-' + (idx + 1),
          category: 'created',
          type: parsedItem.type || 'その他',
          stove: parsedItem.type === 'スープ' ? false : true,
          effort: computeEffort(parsedItem.ingredients, parsedItem.steps),
          name: parsedItem.name,
          ingredients: parsedItem.ingredients,
          steps: parsedItem.steps
        };
        // 選択していた指標だけ、AIの返答から数値を拾って記録する(選ばなかった指標は保存しない)
        activeMetrics.forEach(m => {
          if(parsedItem[m.id] != null){
            recipe[m.id] = Math.round(Number(parsedItem[m.id]) || 0);
          }
        });
        recipes.push(recipe);
        return recipe;
      });
      renderCreatedCombo(dishes);
    } catch(err){
      showCreateError('レシピの作成に失敗しました。もう一度お試しください。');
    } finally {
      setCreateLoading(false);
    }
  }

  generateBtn.addEventListener('click', generateRecipe);

  // 保存ボタン(作成タブの結果カード内、イベント委任)
  createResultEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.save-btn');
    if(!btn) return;
    const id = btn.dataset.id;
    toggleSave(id);
    const nowSaved = isSaved(id);
    btn.classList.toggle('saved', nowSaved);
    btn.textContent = nowSaved ? '★ 保存済み' : '☆ 保存する';
  });
