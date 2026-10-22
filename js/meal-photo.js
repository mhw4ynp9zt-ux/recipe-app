// ==== 外食の写真から栄養を推定して記録する ====
// ★この画面の「推定する」だけが、AI(有料)につながる /api/meals/photo を呼びます。★
//   ・呼ぶ前に必ず confirmAi()(今月の残り回数を見せる確認)を通し、利用者がタップしたときだけ呼びます。
//   ・写真は端末で縮小して送り、サーバーにも保存しません。AIが読み取った料理・量は、確認と修正をしてから /api/meals に記録します(おおよその値)。
// photo.js の resizePhotoFile、kondate-core.js の Kondate に依存します。
(function(){
  const K = window.Kondate;

  async function start({ day, slot, reload }){
    const t = await K.api('GET', '/api/today?day=' + day);
    const quota = (t.ok && t.data.quota && t.data.quota.photo) || { remaining: 0, cap: 0 };
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if(!file) return;
      let dataUrl;
      try { dataUrl = await resizePhotoFile(file); } catch(e) { K.toast('写真を読み取れませんでした。別の写真をお試しください'); return; }
      const ok = await K.confirmAi({
        title: '写真から栄養を推定します',
        body: 'AIが料理と量を推定します。おおよその値で、あとから直せます。写真は保存されません。',
        remaining: quota.remaining, cap: quota.cap, unit: '回', okLabel: '推定する',
      });
      if(!ok) return;
      const busy = document.createElement('p'); busy.className = 'k-toast'; busy.textContent = '写真を読み取っています…'; document.body.appendChild(busy);
      const r = await K.api('POST', '/api/meals/photo', { image: dataUrl });
      busy.remove();
      if(!r.ok){ K.toast(r.data.error || '写真から読み取れませんでした'); return; }
      review(r.data, { day, slot, reload });
    });
    input.click();
  }

  // 推定結果の確認・修正 → 記録
  function review(data, { day, slot, reload }){
    const wrap = document.createElement('div');
    wrap.className = 'k-sheet-wrap';
    wrap.innerHTML = '<div class="k-sheet" role="dialog" aria-modal="true" aria-label="推定結果の確認"><h3>推定結果の確認</h3><p class="input-hint">' + K.esc(data.note) + '</p>' +
      data.dishes.map((d, i) => '<div class="k-dish" data-i="' + i + '"><div class="field"><label>料理名</label><input type="text" maxlength="60" data-f="name" value="' + K.esc(d.name) + '"></div>' +
        d.ingredients.map((x) => '<div class="k-irow"><input type="text" maxlength="40" data-f="iname" value="' + K.esc(x.name) + '" aria-label="食材名"><input type="number" inputmode="decimal" min="1" max="3000" data-f="grams" value="' + K.esc(x.grams) + '" aria-label="グラム">' + (x.matched ? '' : '<span class="k-tag">成分表にない</span>') + '</div>').join('') +
        '<label class="k-check"><input type="checkbox" data-f="use" checked> この料理を記録する</label></div>').join('') +
      '<p class="k-sheet-msg" id="k-photo-msg" role="status"></p><div class="k-sheet-actions"><button type="button" class="btn btn-ghost" data-act="close">閉じる</button><button type="button" class="btn btn-primary" data-act="save">記録する</button></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-act]');
      if(!a){ if(e.target === wrap) wrap.remove(); return; }
      if(a.dataset.act === 'close'){ wrap.remove(); return; }
      a.disabled = true;
      let failed = null, n = 0;
      for(const el of wrap.querySelectorAll('.k-dish')){
        if(!el.querySelector('[data-f="use"]').checked) continue;
        const ingredients = [...el.querySelectorAll('.k-irow')].map((r) => ({ name: r.querySelector('[data-f="iname"]').value.trim(), grams: Number(r.querySelector('[data-f="grams"]').value) })).filter((x) => x.name);
        const r = await K.api('POST', '/api/meals', { day, slot, name: el.querySelector('[data-f="name"]').value.trim() || '外食', via: 'photo', ingredients });
        if(!r.ok){ failed = r.data.error || '記録できませんでした'; break; } n++;
      }
      a.disabled = false;
      if(failed){ wrap.querySelector('#k-photo-msg').textContent = failed; return; }
      wrap.remove();
      if(typeof reload === 'function') await reload();
    });
  }

  window.KondatePhoto = { start };
})();
