// ==== 「設定」タブ:目標の目安 ====
// 性別・年齢・身体活動レベルから、厚生労働省「日本人の食事摂取基準(2025年版)」の表の値を引いて、1日の目標にします。
// 項目ごとに、自分で決めた値を入力することもできます(その項目は「自分で設定」と表示します)。
// 呼ぶAPIは /api/user/targets だけです(AIは呼びません)。
(function(){
  const K = window.Kondate;
  const box = document.getElementById('targets-box');
  if(!box) return;
  let view = null;

  const METRICS = [['calories', 'カロリー', 'kcal'], ['protein', 'たんぱく質', 'g'], ['fat', '脂質', 'g'], ['carbohydrate', '炭水化物', 'g'], ['fiber', '食物繊維', 'g'], ['salt', '塩分(食塩相当量)', 'g'], ['veg', '野菜', 'g'], ['carbs', '糖質', 'g']];
  const KIND = { min: '以上', max: '未満', aim: '' };
  const NOTE = '平均的な体格を想定した、健康な方向けの一般的な目安です。医療行為ではありません。';

  function render(){
    if(!K.loggedIn()){ K.needLogin(box, '目標の目安'); return; }
    if(!view){ box.innerHTML = '<p class="note">読み込んでいます…</p>'; return; }
    if(view.unavailable){ K.unavailable(box); return; }
    if(view.failed){ box.innerHTML = '<p class="note">目標を読み込めませんでした。しばらくしてからもう一度お試しください。</p>'; return; }
    const p = view.profile;
    const sel = (id, opts, cur) => '<select id="' + id + '">' + opts.map(([v, l]) => '<option value="' + v + '"' + (String(cur) === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    const eff = view.effective || {};
    const list = Object.keys(eff).length ? '<ul class="k-eff">' + METRICS.filter(([id]) => eff[id]).map(([id, label, unit]) => {
      const e = eff[id];
      const range = e.lo != null && e.hi != null ? '(' + K.fmt(e.lo) + '〜' + K.fmt(e.hi) + unit + ')' : '';
      return '<li><span>' + K.esc(label) + '</span><span>' + K.fmt(e.value) + unit + ' ' + K.esc(KIND[e.kind] || '') + ' ' + K.esc(range) + ' <span class="k-tag">' + (e.source === 'self' ? '自分で設定' : '公的な基準') + '</span></span></li>';
    }).join('') + '</ul>' : '<p class="input-hint">まだ目標がありません。下の入力を保存すると、ここに表示されます。</p>';
    const notices = (view.notices || []).map((n) => '<p class="note">' + K.esc(n) + '</p>').join('');
    const hint = view.hint ? '<p class="note">' + K.esc(view.hint) + '</p>' : '';

    box.innerHTML = '<p class="input-hint">' + K.esc(NOTE) + '</p>' +
      '<label class="k-check"><input type="checkbox" id="t-special"' + (p.special ? ' checked' : '') + '> 妊娠中・授乳中・18歳未満・通院治療中のいずれかに当てはまる</label>' +
      '<p class="input-hint">当てはまる方は、自動の目安は使えません。医師や管理栄養士に相談のうえ、下の「自分で設定」に数値を入れてください。</p>' +
      '<div id="t-auto"' + (p.special ? ' hidden' : '') + '>' +
      '<div class="field"><label for="t-sex">性別</label>' + sel('t-sex', [['', '選んでください'], ['male', '男性'], ['female', '女性']], p.sex || '') + '</div>' +
      '<div class="field"><label for="t-age">年齢</label><input id="t-age" type="number" inputmode="numeric" min="18" max="120" value="' + K.esc(p.age == null ? '' : p.age) + '"></div>' +
      '<div class="field"><label for="t-activity">身体活動レベル</label>' + sel('t-activity', [['low', '低い(ほぼ座って過ごす)'], ['normal', 'ふつう(座り仕事が中心で、通勤・家事・軽い運動)'], ['high', '高い(立ち仕事・活発な運動の習慣)']], p.activity) + '</div>' +
      '<div class="field"><label for="t-purpose">体重について</label>' + sel('t-purpose', [['maintain', '今の体重を維持'], ['lose', '少し減らしたい'], ['gain', '少し増やしたい']], p.purpose) +
      '<p class="input-hint">「減らす」「増やす」は、エネルギーを10%だけ動かす、このアプリ独自の調整です。</p></div>' +
      '<div class="field"><label for="t-height">身長(cm・任意)</label><input id="t-height" type="number" inputmode="decimal" min="100" max="250" value="' + K.esc(p.heightCm == null ? '' : p.heightCm) + '"></div>' +
      '<div class="field"><label for="t-weight">体重(kg・任意)</label><input id="t-weight" type="number" inputmode="decimal" min="25" max="300" value="' + K.esc(p.weightKg == null ? '' : p.weightKg) + '"><p class="input-hint">身長と体重を入れると、無理のない向きの調整かどうかを確かめます。</p></div></div>' +
      '<details class="k-self"' + (Object.keys(view.overrides || {}).length || p.special ? ' open' : '') + '><summary>自分で目標を設定する(任意)</summary><p class="input-hint">入れた項目だけ、公的な基準の代わりに使います。空にすると基準に戻ります。</p>' +
      METRICS.map(([id, label, unit]) => { const std = view.standard && view.standard.items && view.standard.items[id]; return '<div class="field k-q"><label for="t-o-' + id + '">' + K.esc(label) + '(' + unit + ')</label><input id="t-o-' + id + '" data-o="' + id + '" type="number" inputmode="decimal" min="0" step="any" value="' + K.esc((view.overrides || {})[id] == null ? '' : view.overrides[id]) + '"' + (std ? ' placeholder="基準: ' + K.fmt(std.value) + '"' : '') + '></div>'; }).join('') + '</details>' +
      '<label class="k-check"><input type="checkbox" id="t-numbers"' + (view.showNumbers === false ? '' : ' checked') + '> 画面に数字を表示する</label>' +
      '<p class="input-hint">オフにすると、バーと言葉だけで表示します。</p>' +
      '<p class="k-sheet-msg" id="t-msg" role="status"></p>' +
      '<button type="button" class="btn btn-primary" id="t-save">保存する</button>' +
      notices + hint + '<h4>いまの目標</h4>' + list +
      '<p class="input-hint">出典: <a href="' + K.esc((view.source || {}).url || '#') + '" target="_blank" rel="noopener noreferrer">' + K.esc((view.source || {}).publisher || '') + ' ' + K.esc((view.source || {}).title || '') + '</a></p>';
  }

  async function load(){
    if(!K.loggedIn()){ render(); return; }
    const r = await K.api('GET', '/api/user/targets');
    view = r.ok && r.data && r.data.profile ? r.data : (r.status === 503 ? { unavailable: true } : { failed: true });
    render();
  }

  box.addEventListener('change', (e) => { if(e.target.id === 't-special'){ document.getElementById('t-auto').hidden = e.target.checked; } });
  box.addEventListener('click', async (e) => {
    if(e.target.id !== 't-save') return;
    const g = (id) => document.getElementById(id);
    const special = g('t-special').checked;
    const overrides = {};
    box.querySelectorAll('[data-o]').forEach((i) => { if(i.value !== '') overrides[i.dataset.o] = Number(i.value); });
    const body = {
      profile: special ? { special: true } : { sex: g('t-sex').value, age: g('t-age').value === '' ? null : Number(g('t-age').value), activity: g('t-activity').value, purpose: g('t-purpose').value, heightCm: g('t-height').value === '' ? null : Number(g('t-height').value), weightKg: g('t-weight').value === '' ? null : Number(g('t-weight').value) },
      overrides, showNumbers: g('t-numbers').checked,
    };
    e.target.disabled = true;
    const r = await K.api('PUT', '/api/user/targets', body);
    e.target.disabled = false;
    if(r.ok){ view = Object.assign({}, r.data, { configured: true }); render(); const m = document.getElementById('t-msg'); if(m) m.textContent = '保存しました'; K.refreshAll(); }
    else { const m = document.getElementById('t-msg'); if(m) m.textContent = r.data.error || '保存できませんでした'; }
  });

  K.refreshers.push(() => { view = null; load(); });
  render();
  load();
})();
