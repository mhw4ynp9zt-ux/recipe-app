// ==== 保存済み一覧の絞り込み(系統・役割・主材料のチップ、栄養の数値範囲)とカードのタグ ====
// 判定は recipe-classify.js(DOMを持たない関数)、一覧への反映は save.js の renderSavedView が行います。
// このファイルは「チップ・範囲欄の描画」と「イベントの結線」だけを持ちます(通信はしません)。
// 読み込み順: config.js → recipe-classify.js → save.js → saved-filter.js → main.js(index.html には <script> だけを足す)。
// 絞り込み欄のHTMLと見た目は、実行時にここで差し込みます(index.html・style.css は変更しません)。
// 絞り込みの条件は、この画面を開いている間だけ覚えます(端末には保存しません)。

// recipe-classify.js が読み込めなかった場合は null(その場合、絞り込みは無効で、保存済みタブは従来どおり検索だけで動く)
let savedFilters = typeof emptyFilters === 'function' ? emptyFilters() : null;

const SAVED_FILTER_AXES = [
  { axis: 'genre', title: '系統' },
  { axis: 'role', title: '役割' },
  { axis: 'main', title: '主材料' },
];

function savedFilterOptions(axis){
  if(axis === 'genre') return GENRES.concat([UNCLASSIFIED]);
  if(axis === 'role') return ROLES.concat([UNCLASSIFIED]);
  return MAINS.slice(); // 主材料は常に自動判定があるので「未分類」は無い
}

// チップの3行。counts = { genre: {all, [選択肢]: 件数}, role: {...}, main: {...} }
// 選択中のチップは、件数が0でも押せる(押すと解除できる)。選択中でなく件数0のチップだけ無効にする
function renderChipsHtml(filters, counts){
  const esc = escapeSavedHtml;
  return SAVED_FILTER_AXES.map(({ axis, title }) => {
    const c = (counts && counts[axis]) || {};
    const current = filters ? filters[axis] : null;
    const chip = (value, label) => {
      const n = typeof c[value === '' ? 'all' : value] === 'number' ? c[value === '' ? 'all' : value] : 0;
      const pressed = value === '' ? !current : current === value;
      const disabled = !pressed && n === 0;
      return '<button type="button" class="filter-chip" data-axis="' + axis + '" data-value="' + esc(value) + '"' +
        ' aria-pressed="' + (pressed ? 'true' : 'false') + '"' + (disabled ? ' disabled' : '') + '>' +
        esc(label) + ' ' + n + '</button>';
    };
    return '<div class="chip-row" role="group" aria-label="' + esc(title) + 'で絞り込み">' +
      '<span class="chip-row-title">' + esc(title) + '</span>' +
      chip('', 'すべて') + savedFilterOptions(axis).map(v => chip(v, v)).join('') +
      '</div>';
  }).join('');
}

// 栄養の数値範囲(7指標の最小・最大)。静的な欄で、入力中に作り直さない
function renderRangePanelHtml(){
  const esc = escapeSavedHtml;
  return '<details class="filter-range"><summary>栄養で絞り込む(最小・最大)</summary><div class="filter-range-grid">' +
    NUTRIENT_METRICS.map(m =>
      '<div class="filter-range-item"><span class="filter-range-label">' + esc(m.label) + '(' + esc(m.unit) + ')</span>' +
      '<input type="text" inputmode="decimal" data-range="' + esc(m.id) + ':min" placeholder="最小" aria-label="' + esc(m.label) + 'の最小" autocomplete="off">' +
      '<span class="filter-range-sep">〜</span>' +
      '<input type="text" inputmode="decimal" data-range="' + esc(m.id) + ':max" placeholder="最大" aria-label="' + esc(m.label) + 'の最大" autocomplete="off"></div>'
    ).join('') + '</div></details>';
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

function currentSearchTokens(){
  const input = document.getElementById('saved-search-input');
  return parseSearchQuery(input ? input.value : '');
}

// チップの枠だけを更新する(検索語・他の軸・栄養範囲を適用した件数)
function renderSavedFilter(){
  const box = document.getElementById('saved-filter-chips');
  if(!box || !savedFilters) return;
  const tokens = currentSearchTokens();
  const textMatch = (d) => recipeMatchesQuery(d, tokens);
  const all = getSaved();
  box.innerHTML = renderChipsHtml(savedFilters, {
    genre: facetCounts(all, savedFilters, 'genre', textMatch),
    role: facetCounts(all, savedFilters, 'role', textMatch),
    main: facetCounts(all, savedFilters, 'main', textMatch),
  });
}

const SAVED_FILTER_CSS = [
  '.saved-filter{margin:10px 0 6px;}',
  '.chip-row{display:flex;align-items:center;gap:6px;overflow-x:auto;padding:3px 0;-webkit-overflow-scrolling:touch;scrollbar-width:none;}',
  '.chip-row::-webkit-scrollbar{display:none;}',
  '.chip-row-title{flex:0 0 3.2em;font-size:12px;font-weight:700;color:var(--ink-soft);}',
  '.filter-chip{flex:0 0 auto;min-height:34px;padding:6px 12px;border:1px solid var(--line-strong);border-radius:100px;background:var(--card);color:var(--ink);font-size:13px;white-space:nowrap;cursor:pointer;}',
  '.filter-chip[aria-pressed="true"]{background:var(--brand);border-color:var(--brand);color:var(--brand-ink);font-weight:700;}',
  '.filter-chip:disabled{opacity:.4;cursor:default;}',
  '.filter-range{margin:6px 0;font-size:13px;}',
  '.filter-range summary{cursor:pointer;color:var(--ink-soft);padding:6px 0;}',
  '.filter-range-grid{display:grid;gap:8px;padding:6px 0;}',
  '.filter-range-item{display:grid;grid-template-columns:7.5em 1fr auto 1fr;align-items:center;gap:6px;}',
  '.filter-range-item input{min-width:0;}',
  '.filter-range-label{font-size:12px;color:var(--ink-soft);}',
  '.saved-filter-clear{margin-top:4px;}',
  '.saved-class-tags{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0;}',
  '.dish-class-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:100px;background:var(--brand-soft);color:var(--brand);}',
  '.re-classify{display:grid;grid-template-columns:1fr;gap:4px;margin-top:6px;}',
  '.re-main-auto{font-weight:400;font-size:12px;color:var(--ink-soft);}',
].join('\n');

function setupSavedFilter(){
  const anchor = document.getElementById('saved-search');
  if(!savedFilters || !anchor || document.getElementById('saved-filter-chips') && anchor.__savedFilterReady) return;
  anchor.__savedFilterReady = true;
  if(document.head && typeof document.head.appendChild === 'function' && !document.getElementById('saved-filter-style')){
    const style = document.createElement('style');
    style.id = 'saved-filter-style';
    style.textContent = SAVED_FILTER_CSS;
    document.head.appendChild(style);
  }
  anchor.insertAdjacentHTML('afterend',
    '<div id="saved-filter" class="saved-filter" hidden>' +
      '<div id="saved-filter-chips"></div>' +
      renderRangePanelHtml() +
      '<button type="button" class="btn btn-ghost btn-small saved-filter-clear" id="saved-filter-clear">条件をクリア</button>' +
    '</div>');
  const box = document.getElementById('saved-filter');
  if(!box) return;

  box.addEventListener('click', (e) => {
    const clear = e.target.closest('#saved-filter-clear');
    if(clear){
      savedFilters = emptyFilters();
      box.querySelectorAll('[data-range]').forEach(i => { i.value = ''; });
      renderSavedView();
      return;
    }
    const chip = e.target.closest('[data-axis]');
    if(!chip || chip.disabled) return;
    const axis = chip.dataset.axis;
    const value = chip.dataset.value;
    if(axis !== 'genre' && axis !== 'role' && axis !== 'main') return;
    savedFilters[axis] = !value || savedFilters[axis] === value ? null : value; // 選択中をもう一度押すと解除
    renderSavedView();
  });

  box.addEventListener('input', (e) => {
    const key = e.target && e.target.dataset ? e.target.dataset.range : null;
    if(!key) return;
    const parts = key.split(':');
    const id = parts[0];
    const side = parts[1];
    if((side !== 'min' && side !== 'max') || !NUTRIENT_METRICS.some(m => m.id === id)) return;
    const cur = savedFilters.ranges[id] || { min: null, max: null };
    cur[side] = parseRangeValue(e.target.value);
    savedFilters.ranges[id] = cur;
    renderSavedView(); // 入力欄は作り直さない(チップの枠と一覧だけ更新される)
  });

  renderSavedFilter();
}
