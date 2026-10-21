// ==== 保存済み一覧の絞り込み(役割の切り替え・並べ替え・「詳しく絞り込む」シート)とカードのタグ ====
// 判定は recipe-classify.js(DOMを持たない関数)、一覧への反映は save.js の renderSavedView が行います。
// このファイルは「切り替え・チップ・範囲欄の描画」と「イベントの結線」だけを持ちます(通信はしません)。
// 読み込み順: config.js → recipe-classify.js → save.js → saved-sheet.js → saved-filter.js → main.js(index.html には <script> だけを足す)。
// 画面の構成(css/saved.css):
//   ・一覧の上に常に出る: 役割の切り替え(すべて/主菜/副菜/汁物/主食)、「詳しく絞り込む」ボタン、並べ替え、適用中の条件(×で外せる)
//   ・「詳しく絞り込む」を押すと下から出るシート: 系統・主材料のチップ、栄養の最小・最大(7指標すべてを最初から表示)
// 絞り込みの条件と並べ替えは、この画面を開いている間だけ覚えます(端末には保存しません)。

// recipe-classify.js が読み込めなかった場合は null(その場合、絞り込みは無効で、保存済みタブは従来どおり検索だけで動く)
let savedFilters = typeof emptyFilters === 'function' ? emptyFilters() : null;

// 並べ替え。id は recipe-classify.js の sortRecipes と同じ
let savedSort = 'new';
const SAVED_SORTS = [
  { id: 'new',      label: '新しい順' },
  { id: 'protein',  label: 'たんぱく質が多い順' },
  { id: 'cal-asc',  label: 'カロリーが低い順' },
  { id: 'cal-desc', label: 'カロリーが高い順' },
];

// 絞り込みシートのチップ(役割は一覧の上の切り替えにあるので、ここには出さない)
const SAVED_SHEET_AXES = [
  { axis: 'genre', title: '系統' },
  { axis: 'main', title: '主材料' },
];
// 栄養の範囲。7指標すべてを、折りたたまずに最初から並べる(この順)
const FILTER_RANGE_ORDER = ['protein', 'calories', 'salt', 'veg', 'fat', 'fiber', 'carbs'];

function savedFilterOptions(axis){
  if(axis === 'genre') return GENRES.concat([UNCLASSIFIED]);
  if(axis === 'role') return ROLES.concat([UNCLASSIFIED]);
  return MAINS.slice(); // 主材料は常に自動判定があるので「未分類」は無い
}

function savedMetricById(id){
  return NUTRIENT_METRICS.find(m => m.id === id) || null;
}

// 役割の切り替え。counts = { all, [役割]: 件数 }
// 選択中のボタンは、件数が0でも押せる(押すと解除できる)。選択中でなく件数0のボタンだけ無効にする。
// 「未分類」は、該当するレシピがあるとき(または選択中)だけ出す
function renderRoleSegHtml(filters, counts){
  const esc = escapeSavedHtml;
  const c = counts || {};
  const current = filters ? filters.role : null;
  const btn = (value, label) => {
    const n = c[value === '' ? 'all' : value];
    const pressed = value === '' ? !current : current === value;
    const disabled = !pressed && typeof n === 'number' && n === 0;
    return '<button type="button" data-role="' + esc(value) + '" aria-pressed="' + (pressed ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
  };
  const options = ROLES.slice();
  if(current === UNCLASSIFIED || (c[UNCLASSIFIED] || 0) > 0) options.push(UNCLASSIFIED);
  return btn('', 'すべて') + options.map(v => btn(v, v)).join('');
}

// シートの中の系統・主材料のチップ。counts = { genre: {all, [選択肢]: 件数}, main: {...} }
// 選択中のチップは、件数が0でも押せる(もう一度押すと解除)。選択中でなく件数0のチップだけ無効にする
function renderChipsHtml(filters, counts){
  const esc = escapeSavedHtml;
  return SAVED_SHEET_AXES.map(({ axis, title }) => {
    const c = (counts && counts[axis]) || {};
    const current = filters ? filters[axis] : null;
    const chip = (value) => {
      const n = typeof c[value] === 'number' ? c[value] : 0;
      const pressed = current === value;
      const disabled = !pressed && n === 0;
      return '<button type="button" class="filter-chip" data-axis="' + axis + '" data-value="' + esc(value) + '"' +
        ' aria-pressed="' + (pressed ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + '>' +
        esc(value) + ' <span class="chip-n">' + n + '</span></button>';
    };
    return '<section class="filter-group"><h3>' + esc(title) + '</h3>' +
      '<div class="chip-wrap" role="group" aria-label="' + esc(title) + 'で絞り込み">' +
      savedFilterOptions(axis).map(chip).join('') +
      '</div></section>';
  }).join('');
}

// 栄養の範囲の1行(最小〜最大)。静的な欄で、入力中に作り直さない
function renderRangeRowHtml(m){
  const esc = escapeSavedHtml;
  const field = (side, placeholder) =>
    '<label class="range-field"><input type="text" inputmode="decimal" data-range="' + esc(m.id) + ':' + side + '" placeholder="' + placeholder + '" aria-label="' + esc(m.label) + 'の' + placeholder + '" autocomplete="off">' +
    '<span class="range-unit">' + esc(m.unit) + '</span></label>';
  return '<div class="range-row"><span class="range-label">' + esc(m.label) + '</span>' +
    field('min', '最小') + '<span class="range-sep" aria-hidden="true">〜</span>' + field('max', '最大') + '</div>';
}

// 栄養の範囲(7指標の最小・最大)。見出しも折りたたみもなく、1つのリストに並べる(空欄は指定なし)
function renderRangePanelHtml(){
  return '<section class="filter-group filter-ranges" aria-label="栄養で絞り込み(空欄は指定なし)">' +
    FILTER_RANGE_ORDER.map(savedMetricById).filter(Boolean).map(renderRangeRowHtml).join('') +
    '</section>';
}

// カードの小さなタグ。系統・役割は選択肢にある値だけ。主材料は常に(自動判定を含む)出す
function classifyTagsHtml(recipe){
  const tag = (s) => '<span class="dish-class-tag">' + escapeSavedHtml(s) + '</span>';
  const parts = [];
  const g = genreOf(recipe);
  const r = roleOf(recipe);
  if(g) parts.push(tag(g));
  if(r) parts.push(tag(r));
  parts.push(tag(effectiveMain(recipe)));
  return parts.join('');
}

// 適用中の条件の表示用の文字(例: 「たんぱく質 30g以上」「カロリー 400〜600kcal」)
function rangeChipLabel(m, min, max){
  if(min !== null && max !== null) return m.label + ' ' + min + '〜' + max + m.unit;
  if(min !== null) return m.label + ' ' + min + m.unit + '以上';
  return m.label + ' ' + max + m.unit + '以下';
}

// 一覧の上に出す「適用中の条件」(系統・主材料・栄養の範囲。役割は切り替えで見えるので含めない)
function activeFilterItems(filters){
  const items = [];
  if(!filters) return items;
  if(filters.genre) items.push({ key: 'genre', label: filters.genre });
  if(filters.main) items.push({ key: 'main', label: filters.main });
  activeRanges(filters).forEach(r => {
    const m = savedMetricById(r.id);
    if(m) items.push({ key: 'range:' + r.id, label: rangeChipLabel(m, r.min, r.max) });
  });
  return items;
}

function renderActiveChipsHtml(items){
  const esc = escapeSavedHtml;
  return items.map(it =>
    '<button type="button" class="active-chip" data-clear="' + esc(it.key) + '" aria-label="' + esc(it.label) + 'の条件を外す">' + esc(it.label) + ' ×</button>'
  ).join('');
}

function currentSearchTokens(){
  const input = document.getElementById('saved-search-input');
  return parseSearchQuery(input ? input.value : '');
}

// 描き直しても、押していたボタンへフォーカスが残るようにして枠の中身を差し替える(キーボード・読み上げの操作が途切れないように)
function setBoxHtmlKeepFocus(box, html){
  if(!box) return;
  const active = document.activeElement;
  let key = null;
  if(active && box.contains(active) && active.dataset){
    key = ['axis', 'value', 'role', 'clear'].map(k => k + '=' + (active.dataset[k] == null ? '' : active.dataset[k])).join('|');
  }
  box.innerHTML = html;
  if(key){
    const again = Array.from(box.querySelectorAll('button')).find(b =>
      ['axis', 'value', 'role', 'clear'].map(k => k + '=' + (b.dataset[k] == null ? '' : b.dataset[k])).join('|') === key);
    if(again && !again.disabled && typeof again.focus === 'function') again.focus();
  }
}

// 範囲の入力欄を、条件(savedFilters)に合わせる。入力中の欄は触らない
function syncRangeInputs(){
  const sheet = document.getElementById('saved-filter-sheet');
  if(!sheet || !savedFilters) return;
  sheet.querySelectorAll('[data-range]').forEach(input => {
    if(input === document.activeElement) return;
    const parts = String(input.dataset.range).split(':');
    const r = savedFilters.ranges[parts[0]];
    const want = r && typeof r[parts[1]] === 'number' ? r[parts[1]] : null;
    if(parseRangeValue(input.value) !== want) input.value = want === null ? '' : String(want);
  });
}

// 絞り込みの表示(役割の切り替え・適用中の条件・ボタンの印・シートの中身)を最新にする。
// 件数は、検索語・他の条件を適用して数える
function renderSavedFilter(){
  if(!savedFilters || typeof document === 'undefined') return;
  const tokens = currentSearchTokens();
  const textMatch = (d) => recipeMatchesQuery(d, tokens);
  const all = getSaved();
  const counts = {
    genre: facetCounts(all, savedFilters, 'genre', textMatch),
    role: facetCounts(all, savedFilters, 'role', textMatch),
    main: facetCounts(all, savedFilters, 'main', textMatch),
  };
  setBoxHtmlKeepFocus(document.getElementById('saved-role-seg'), renderRoleSegHtml(savedFilters, counts.role));
  setBoxHtmlKeepFocus(document.getElementById('saved-filter-chips'), renderChipsHtml(savedFilters, counts));

  const items = activeFilterItems(savedFilters);
  const activeEl = document.getElementById('saved-active');
  if(activeEl){
    setBoxHtmlKeepFocus(activeEl, renderActiveChipsHtml(items));
    activeEl.hidden = items.length === 0;
  }
  const openBtn = document.getElementById('saved-filter-open');
  if(openBtn) openBtn.classList.toggle('is-active', items.length > 0);
  const badge = document.getElementById('saved-filter-badge');
  if(badge){
    badge.textContent = items.length ? String(items.length) : '';
    badge.hidden = items.length === 0;
  }
  const sortEl = document.getElementById('saved-sort');
  if(sortEl && sortEl.value !== savedSort) sortEl.value = savedSort;

  const applyBtn = document.getElementById('saved-filter-apply');
  if(applyBtn) applyBtn.textContent = applyRecipeFilters(all, savedFilters, textMatch).matched.length + '件を表示する';
  syncRangeInputs();
}

function setupSavedFilter(){
  const anchor = document.getElementById('saved-search');
  if(!savedFilters || !anchor || anchor.__savedFilterReady) return;
  anchor.__savedFilterReady = true;
  const esc = escapeSavedHtml;

  // 一覧の上: 役割の切り替え・「詳しく絞り込む」・並べ替え・適用中の条件・件数の文
  anchor.insertAdjacentHTML('afterend',
    '<div id="saved-filter" class="saved-filter" hidden>' +
      '<div id="saved-role-seg" class="saved-seg" role="group" aria-label="役割で絞り込み"></div>' +
      '<div class="saved-ctl-row">' +
        '<button type="button" id="saved-filter-open" class="saved-filter-btn" aria-haspopup="dialog">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>' +
          '詳しく絞り込む<span id="saved-filter-badge" class="saved-filter-badge" hidden></span>' +
        '</button>' +
        '<label class="saved-sort"><span class="visually-hidden">並べ替え</span>' +
          '<select id="saved-sort">' + SAVED_SORTS.map(s => '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>').join('') + '</select>' +
        '</label>' +
      '</div>' +
      '<div id="saved-active" class="saved-active" hidden></div>' +
      '<p class="input-hint" id="saved-search-count" aria-live="polite"></p>' +
    '</div>');

  // 下から出る絞り込みシート
  document.body.insertAdjacentHTML('beforeend',
    '<div id="saved-filter-sheet" class="saved-sheet-wrap" hidden>' +
      '<div class="saved-sheet-backdrop" data-sheet-close></div>' +
      '<section class="saved-sheet" role="dialog" aria-modal="true" aria-labelledby="saved-filter-title">' +
        '<div class="saved-sheet-grip" aria-hidden="true"></div>' +
        '<header class="saved-sheet-head"><h2 id="saved-filter-title">詳しく絞り込む</h2>' +
          '<button type="button" class="saved-sheet-close" data-sheet-close aria-label="閉じる">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button></header>' +
        '<div class="saved-sheet-scroll"><div id="saved-filter-chips"></div>' + renderRangePanelHtml() + '</div>' +
        '<footer class="saved-sheet-foot">' +
          '<button type="button" class="btn btn-ghost" id="saved-filter-clear">クリア</button>' +
          '<button type="button" class="btn btn-primary" id="saved-filter-apply">表示する</button>' +
        '</footer>' +
      '</section>' +
    '</div>');

  const box = document.getElementById('saved-filter');
  const sheet = document.getElementById('saved-filter-sheet');
  if(!box || !sheet) return;

  // 一覧の上の操作(役割の切り替え・シートを開く・適用中の条件を外す・並べ替え)
  box.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-role]');
    if(seg){
      if(seg.disabled) return;
      const value = seg.dataset.role;
      savedFilters.role = !value || savedFilters.role === value ? null : value; // 選択中をもう一度押すと解除
      renderSavedView();
      return;
    }
    const open = e.target.closest('#saved-filter-open');
    if(open){ openSavedSheet(sheet, open, '.saved-sheet-close'); return; }
    const clear = e.target.closest('[data-clear]');
    if(clear){
      const key = clear.dataset.clear;
      if(key === 'genre' || key === 'main') savedFilters[key] = null;
      else if(key.indexOf('range:') === 0) delete savedFilters.ranges[key.slice(6)];
      renderSavedView();
    }
  });
  box.addEventListener('change', (e) => {
    if(!e.target || e.target.id !== 'saved-sort') return;
    savedSort = SAVED_SORTS.some(s => s.id === e.target.value) ? e.target.value : 'new';
    renderSavedView();
  });

  // シートの操作(チップ・クリア・閉じる)
  sheet.addEventListener('click', (e) => {
    if(e.target.closest('[data-sheet-close]') || e.target.closest('#saved-filter-apply')){ closeSavedSheet(sheet); return; }
    if(e.target.closest('#saved-filter-clear')){
      savedFilters = emptyFilters();
      renderSavedView();
      return;
    }
    const chip = e.target.closest('[data-axis]');
    if(!chip || chip.disabled) return;
    const axis = chip.dataset.axis;
    const value = chip.dataset.value;
    if(axis !== 'genre' && axis !== 'main') return;
    savedFilters[axis] = !value || savedFilters[axis] === value ? null : value; // 選択中をもう一度押すと解除
    renderSavedView();
  });

  // 栄養の範囲の入力(全角数字も可)。入力欄は作り直さない(一覧・チップ・件数だけ更新される)
  sheet.addEventListener('input', (e) => {
    const key = e.target && e.target.dataset ? e.target.dataset.range : null;
    if(!key) return;
    const parts = key.split(':');
    const id = parts[0];
    const side = parts[1];
    if((side !== 'min' && side !== 'max') || !NUTRIENT_METRICS.some(m => m.id === id)) return;
    const cur = savedFilters.ranges[id] || { min: null, max: null };
    cur[side] = parseRangeValue(e.target.value);
    savedFilters.ranges[id] = cur;
    renderSavedView();
  });

  renderSavedFilter();
}
