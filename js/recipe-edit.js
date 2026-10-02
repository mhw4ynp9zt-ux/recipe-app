// ==== レシピの編集シート(全画面)と、その入口 ====
// recipe-edit-core.js の createRecipeEditor(状態管理)を画面につなぎます。
// save.js の escapeSavedHtml / replaceSaved / getSaved / renderSavedView、config.js の NUTRIENT_METRICS、
// auth.js の isLoggedIn、error-log.js の logError に依存します。
//
//  ・renderEditorHtml(state) は state だけから HTML 文字列を作る純粋な関数です(DOMに触れない)。
//    利用者の入力(料理名・食材名・作り方・エラー文)は、すべて escapeSavedHtml で無害化します。
//  ・シートと「自作レシピを作る」ボタン(#new-recipe-btn)は、読み込み時にここで差し込みます(index.html は変更不要)。
//  ・保存に成功したらシートを閉じます(編集の種類・対象は保存後に変わらないため、開いたままだと二重保存になる)。
//  ・通信は core が行います(AIは呼びません。calc / PUT / custom だけ)。

const EDIT_MAX_INGREDIENTS = 30;
const EDIT_MAX_STEPS = 30;
const EDIT_NOT_FOUND = '元のレシピが見つかりません';

const reBlank = (s) => typeof s !== 'string' || s.replace(/[\s　]/g, '') === '';

// 行ごとの照合表示の情報。計算結果の内訳は、名前が空でない行の順に並んでいる。名前が変わった行は照合結果を出さない
// showManual: 手入力欄を見せるか(照合できずグラム数>0、手入力の値がある、手入力の欄にエラーがある)
function editorRowInfo(state){
  const details = (state.preview && state.preview.data && state.preview.data.ingredientDetails) || [];
  const errKeys = Object.keys(state.fieldErrors || {});
  let k = 0;
  return state.draft.ingredients.map((row, i) => {
    const detail = reBlank(row.name) ? null : details[k++];
    const known = detail && String(detail.name).trim() === String(row.name).trim() ? detail : null;
    const hasGrams = !reBlank(row.grams) && Number(row.grams) > 0;
    const unmatched = !!(known && !known.match && hasGrams);
    const hasManual = Object.values(row.manual || {}).some(v => !reBlank(String(v)));
    const manualErr = errKeys.some(key => key.startsWith('ingredients.' + i + '.manual.'));
    return { known, unmatched, showManual: unmatched || hasManual || manualErr };
  });
}

// 画面の骨組みが変わるかどうかの目印。同じ間は入力欄を作り直さず、動的な部分だけを差し替える。
// 手入力欄はすべての行に置いて hidden を切り替えるだけなので、目印には含めない
// (フォーカス中の欄を消すと iOS Safari でキーボードが閉じるため)
function structureKey(state){
  return JSON.stringify({
    mode: state.mode,
    rows: state.draft.ingredients.length,
    steps: state.draft.steps.length,
  });
}

function renderEditorHtml(state, opts){
  const esc = escapeSavedHtml;
  const typeOptions = (opts && opts.typeOptions) || [];
  const d = state.draft;
  const errs = state.fieldErrors || {};
  // 空でも枠は出しておく(入力欄を作り直さずに文言だけ差し替えるため)
  const fieldErr = (key) => '<p class="re-error" data-slot="err:' + esc(key) + '">' + (errs[key] ? esc(errs[key]) : '') + '</p>';
  const blank = reBlank;

  const rowInfo = editorRowInfo(state);
  const ingRows = d.ingredients.map((row, i) => {
    const { known, unmatched, showManual } = rowInfo[i];
    let match = '';
    if(known && known.match) match = '→ ' + esc(known.match.label);
    else if(unmatched) match = '該当なし(成分表に見つかりません)';
    const matchCls = unmatched ? 're-match re-match-none' : 're-match';
    const manual = `
        <div class="re-manual" data-manual="${i}"${showManual ? '' : ' hidden'}>
          <p class="re-manual-title">栄養値を手入力(この行のグラム数ぶんの合計。分かるものだけ)</p>
          <div class="re-manual-grid">
            ${NUTRIENT_METRICS.map(m => `
              <label class="re-manual-item">
                <span>${esc(m.label)}(${esc(m.unit)})</span>
                <input type="text" inputmode="decimal" data-k="gm:${i}:${m.id}" value="${esc((row.manual || {})[m.id] == null ? '' : row.manual[m.id])}" autocomplete="off">
                ${fieldErr('ingredients.' + i + '.manual.' + m.id)}
              </label>`).join('')}
          </div>
        </div>`;
    return `
      <li class="re-row">
        <div class="re-row-main">
          <div class="re-row-name">
            <input type="text" data-k="gn:${i}" value="${esc(row.name)}" placeholder="食材名" maxlength="40" aria-label="食材名 ${i + 1}" autocomplete="off">
          </div>
          <div class="re-row-grams">
            <input type="text" inputmode="decimal" data-k="gg:${i}" value="${esc(row.grams)}" placeholder="g" aria-label="グラム数 ${i + 1}" autocomplete="off">
          </div>
          <button type="button" class="re-icon-btn" data-act="rm-ing" data-i="${i}" aria-label="この食材を削除">×</button>
        </div>
        ${fieldErr('ingredients.' + i + '.name')}${fieldErr('ingredients.' + i + '.grams')}
        <p class="${matchCls}" data-slot="match:${i}">${match}</p>${manual}
      </li>`;
  }).join('');

  const stepRows = d.steps.map((s, i) => `
      <li class="re-row">
        <div class="re-row-main">
          <textarea data-k="st:${i}" rows="2" maxlength="300" placeholder="手順を入力" aria-label="作り方 ${i + 1}">${esc(s)}</textarea>
          <button type="button" class="re-icon-btn" data-act="rm-step" data-i="${i}" aria-label="このステップを削除">×</button>
        </div>
        ${fieldErr('steps.' + i)}
      </li>`).join('');

  // 栄養の合計(プレビュー)
  const pv = state.preview || { status: 'idle', data: null };
  const nutrition = pv.data && pv.data.nutrition;
  const totalText = nutrition ? NUTRIENT_METRICS.filter(m => nutrition[m.id] != null).map(m => m.label + ' ' + nutrition[m.id] + m.unit).join(' ・ ') : '';
  const faded = pv.status === 'pending' || pv.status === 'error' || pv.status === 'invalid';
  let pvNote = '';
  if(pv.status === 'pending') pvNote = '<p class="re-preview-note">計算中…</p>';
  else if(pv.status === 'error') pvNote = '<p class="re-preview-note re-error">計算できませんでした' + (pv.error ? '(' + esc(pv.error) + ')' : '') + ' <button type="button" class="re-link-btn" data-act="retry">再試行</button></p>';
  else if(pv.status === 'invalid') pvNote = '<p class="re-preview-note re-error">グラム数と手入力の値は数字で入力してください</p>';
  else if(pv.status === 'idle') pvNote = '<p class="re-preview-note">食材とグラム数を入れると、栄養の合計が出ます</p>';
  const check = pv.data && pv.data.nutritionCheck;
  let warn = '';
  if(pv.status === 'ok' && check && !Array.isArray(check)){
    const names = (list) => '「' + list.map(esc).join('」「') + '」';
    const parts = [];
    if(check.unmatched && check.unmatched.length) parts.push(names(check.unmatched) + 'は成分表に見つからず、栄養量に含まれていません(手入力すると計算に入ります)。');
    if(check.missing && check.missing.length) parts.push(names(check.missing) + 'は成分表に値のない項目があり、その分は0として計算しています。');
    if(parts.length) warn = '<p class="nutrition-warn">' + parts.join('') + '</p>';
  }

  // 保存ボタン。最新の入力に対する計算結果がそろっているときだけ押せる
  const ready = !state.saving && pv.status === 'ok' && !blank(d.name) && d.steps.some(s => !blank(s));
  const notFound = state.saveError === EDIT_NOT_FOUND;
  const dis = (off) => off ? ' disabled' : '';
  const saveButtons = state.mode === 'edit'
    ? `<button type="button" class="btn btn-primary" data-act="save-overwrite"${dis(!ready || notFound)}>上書き保存</button>
       <button type="button" class="btn btn-secondary" data-act="save-copy"${dis(!ready)}>別名で保存</button>`
    : `<button type="button" class="btn btn-primary" data-act="save-new"${dis(!ready)}>保存</button>`;
  const saveMsg = state.saveError
    ? '<p class="re-error re-save-error" role="alert">' + esc(state.saveError) + (notFound ? '。「別名で保存」で新しいレシピとして保存できます。' : '') + '</p>'
    : '';

  return `
    <div class="re-head">
      <button type="button" class="re-close" data-act="close">閉じる</button>
      <h2>${state.mode === 'edit' ? 'レシピを編集' : '自作レシピを作る'}</h2>
    </div>
    <div class="re-scroll">
      <section class="re-section">
        <label class="re-label" for="re-name">料理名</label>
        <input type="text" id="re-name" data-k="name" value="${esc(d.name)}" maxlength="60" placeholder="例: 親子丼" autocomplete="off">
        ${fieldErr('name')}
        <label class="re-label" for="re-type">種類(自由入力)</label>
        <input type="text" id="re-type" data-k="type" value="${esc(d.type)}" maxlength="20" placeholder="例: 丼" list="re-type-list" autocomplete="off">
        <datalist id="re-type-list">${typeOptions.map(t => '<option value="' + esc(t) + '"></option>').join('')}</datalist>
        ${fieldErr('type')}
      </section>
      <section class="re-section">
        <h3 class="re-h3">食材</h3>
        ${fieldErr('ingredients')}
        <ul class="re-list">${ingRows}</ul>
        <button type="button" class="btn btn-ghost btn-small" data-act="add-ing"${dis(d.ingredients.length >= EDIT_MAX_INGREDIENTS)}>+ 食材を追加</button>
      </section>
      <section class="re-section">
        <h3 class="re-h3">作り方</h3>
        ${fieldErr('steps')}
        <ol class="re-list">${stepRows}</ol>
        <button type="button" class="btn btn-ghost btn-small" data-act="add-step"${dis(d.steps.length >= EDIT_MAX_STEPS)}>+ ステップを追加</button>
      </section>
      <section class="re-section">
        <h3 class="re-h3">栄養の合計</h3>
        <p class="re-total${faded ? ' re-faded' : ''}" data-slot="total">${totalText ? esc(totalText) : '—'}</p>
        <div data-slot="pvnote">${pvNote}</div>
        <div data-slot="warn">${warn}</div>
      </section>
    </div>
    <div class="re-foot">
      <div data-slot="savemsg">${saveMsg}</div>
      <div class="btn-row">${saveButtons}</div>
    </div>`;
}

// ---- 画面への結線(ブラウザだけ。テストではDOMが無いので何もしない) ----
let recipeEditor = null;
let recipeEditOpen = false;
let recipeEditComposing = false;
let recipeEditLastKey = null; // 直近に全描画したときの structureKey

function refreshNewRecipeButton(){
  const btn = document.getElementById('new-recipe-btn');
  if(!btn) return;
  const ok = isLoggedIn();
  btn.disabled = !ok;
  const hint = document.getElementById('new-recipe-hint');
  if(hint) hint.hidden = ok;
}

function renderRecipeEditor(){
  if(!recipeEditOpen) return;
  const body = document.getElementById('recipe-edit-body');
  if(!body) return;
  try {
    const state = recipeEditor.state;
    const types = Array.from(new Set(getSaved().map(r => r.type).filter(Boolean)));
    const html = renderEditorHtml(state, { typeOptions: types });
    const key = structureKey(state);
    if(key === recipeEditLastKey && body.firstElementChild){
      patchRecipeEditor(body, html);
      return;
    }
    recipeEditLastKey = key;
    // 骨組みが変わるときだけ全部作り直す。入力中の欄とカーソル位置は data-k で戻す
    const active = document.activeElement && body.contains(document.activeElement) ? document.activeElement : null;
    const fkey = active && active.dataset ? active.dataset.k : null;
    const selStart = fkey && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    const selEnd = fkey && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
    const scroller = body.querySelector('.re-scroll');
    const top = scroller ? scroller.scrollTop : 0;
    body.innerHTML = html;
    const nextScroller = body.querySelector('.re-scroll');
    if(nextScroller) nextScroller.scrollTop = top;
    if(fkey){
      const next = Array.from(body.querySelectorAll('[data-k]')).find(el => el.dataset.k === fkey);
      if(next){
        next.focus();
        if(selStart != null){ try { next.setSelectionRange(selStart, selEnd); } catch(e){ /* 無視 */ } }
      }
    }
  } catch(e){
    if(typeof logError === 'function') logError('edit-render', e);
  }
}

// 骨組みが同じときの描画: 入力欄(フォーカス中のものも)は作り直さず、data-slot の部分と保存ボタンの状態、
// 手入力欄(data-manual)の hidden だけ更新する。
// data-slot の中に入力欄は無い(照合の行・エラー文・合計・計算の案内・保存のメッセージ)
function patchRecipeEditor(body, html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const olds = {};
  body.querySelectorAll('[data-slot]').forEach(el => { olds[el.dataset.slot] = el; });
  tmp.querySelectorAll('[data-slot]').forEach(el => {
    const old = olds[el.dataset.slot];
    if(old && old.outerHTML !== el.outerHTML) old.replaceWith(el);
  });
  tmp.querySelectorAll('button[data-act^="save-"]').forEach(el => {
    const old = body.querySelector('button[data-act="' + el.dataset.act + '"]');
    if(old) old.disabled = el.disabled;
  });
  tmp.querySelectorAll('[data-manual]').forEach(el => {
    const old = body.querySelector('[data-manual="' + el.dataset.manual + '"]');
    if(old) old.hidden = el.hidden;
  });
}

function openRecipeEditor(opts){
  const sheet = document.getElementById('recipe-edit-sheet');
  if(!sheet) return;
  if(!recipeEditor){
    recipeEditor = createRecipeEditor({
      fetch: (url, o) => fetch(url, o),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
      onChange: () => { if(recipeEditComposing) return; renderRecipeEditor(); },
      logError: (step, err, extra) => { if(typeof logError === 'function') logError(step, err, extra); },
    });
  }
  recipeEditOpen = true;
  recipeEditLastKey = null;
  recipeEditor.start(opts);
  sheet.hidden = false;
  document.body.classList.add('re-open');
  renderRecipeEditor();
  const scroller = sheet.querySelector('.re-scroll');
  if(scroller) scroller.scrollTop = 0;
}

function closeRecipeEditor(){
  const sheet = document.getElementById('recipe-edit-sheet');
  recipeEditOpen = false;
  recipeEditComposing = false;
  if(sheet) sheet.hidden = true;
  document.body.classList.remove('re-open');
  // 保留中の計算を止めて、状態を空に戻す(閉じたあとに通信しない)
  if(recipeEditor) recipeEditor.start({ mode: 'new' });
}

function requestCloseRecipeEditor(){
  if(recipeEditor && recipeEditor.state.dirty && !window.confirm('変更を破棄しますか?')) return;
  closeRecipeEditor();
}

async function runRecipeSave(kind){
  const result = await recipeEditor.save(kind);
  if(result.ok){
    replaceSaved(result.recipe);
    closeRecipeEditor();
    return;
  }
  if(result.suggestCopy){
    recipeEditor.state.saveError = EDIT_NOT_FOUND;
    renderRecipeEditor();
  }
}

function setupRecipeEditUi(){
  const emptyEl = document.getElementById('saved-empty');
  if(!emptyEl || document.getElementById('recipe-edit-sheet')) return;
  emptyEl.insertAdjacentHTML('beforebegin', `
    <div class="new-recipe-box">
      <button type="button" class="btn btn-secondary" id="new-recipe-btn" disabled>自作レシピを作る</button>
      <p class="edit-login-hint" id="new-recipe-hint">ログインすると編集できます</p>
    </div>
  `);
  document.body.insertAdjacentHTML('beforeend', `
    <div id="recipe-edit-sheet" class="recipe-edit-sheet" role="dialog" aria-modal="true" aria-label="レシピの編集" hidden>
      <div id="recipe-edit-body" class="re-body"></div>
    </div>
  `);
  const sheet = document.getElementById('recipe-edit-sheet');

  document.getElementById('new-recipe-btn').addEventListener('click', () => {
    if(isLoggedIn()) openRecipeEditor({ mode: 'new' });
  });

  // 入力(イベント委任)。日本語変換中は、確定するまで描画し直さない
  sheet.addEventListener('compositionstart', () => { recipeEditComposing = true; });
  sheet.addEventListener('compositionend', () => { recipeEditComposing = false; renderRecipeEditor(); });
  sheet.addEventListener('input', (e) => {
    const el = e.target;
    const k = el && el.dataset ? el.dataset.k : null;
    if(!k || !recipeEditor) return;
    const p = k.split(':');
    const i = Number(p[1]);
    if(k === 'name') recipeEditor.setName(el.value);
    else if(k === 'type') recipeEditor.setType(el.value);
    else if(p[0] === 'gn') recipeEditor.updateIngredient(i, { name: el.value });
    else if(p[0] === 'gg') recipeEditor.updateIngredient(i, { grams: el.value });
    else if(p[0] === 'gm'){
      const row = recipeEditor.state.draft.ingredients[i];
      if(row) recipeEditor.updateIngredient(i, { manual: Object.assign({}, row.manual, { [p[2]]: el.value }) });
    }
    else if(p[0] === 'st') recipeEditor.updateStep(i, el.value);
  });

  sheet.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if(!btn || btn.disabled || !recipeEditor) return;
    const act = btn.dataset.act;
    const i = Number(btn.dataset.i);
    if(act === 'close') requestCloseRecipeEditor();
    else if(act === 'add-ing') recipeEditor.addIngredient();
    else if(act === 'add-step') recipeEditor.addStep();
    else if(act === 'rm-ing' && i >= 0) recipeEditor.removeIngredient(i);
    else if(act === 'rm-step' && i >= 0) recipeEditor.removeStep(i);
    else if(act === 'retry') recipeEditor.retryCalc();
    else if(act === 'save-overwrite') runRecipeSave('overwrite');
    else if(act === 'save-copy' || act === 'save-new') runRecipeSave('new');
  });

  refreshNewRecipeButton();
}

if(typeof document !== 'undefined' && document.body) setupRecipeEditUi();
