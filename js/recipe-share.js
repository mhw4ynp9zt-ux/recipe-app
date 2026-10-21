// ==== レシピの共有(リンクを作って、LINE・Xなどに送る) ====
// 詳細シート(saved-sheet.js)の「共有」ボタンから開きます。ログイン中だけ使えます。
//   ・POST /api/recipes/:id/share で共有リンク(https://…/?share=トークン)を作る。同じレシピは同じリンクのまま、中身が今のものに更新される
//   ・リンクを知っている人はログインなしで、レシピと写真を見られる。見た人が自分の保存済みに取り込める(recipe-import.js)
//   ・DELETE /api/recipes/:id/share で共有をやめる(リンクは見られなくなる)
// 送る手段: 端末の共有メニュー(navigator.share。iPhoneならLINE・メッセージ・Xなど)、リンクのコピー、X、LINE。
// save.js の getSaved / escapeSavedHtml、saved-sheet.js の openSavedSheet / closeSavedSheet に依存します。AIは呼びません。

let shareState = null; // { id, name, status: 'loading'|'ready'|'error', url, message }

function shareText(name){
  return '「' + name + '」のレシピ';
}

function shareSheetHtml(st){
  const esc = escapeSavedHtml;
  let body;
  if(st.status === 'loading'){
    body = '<p class="share-note">共有リンクを作っています…</p>';
  } else if(st.status === 'error'){
    body = '<p class="share-note is-error" role="alert">' + esc(st.message || '共有リンクを作れませんでした') + '</p>';
  } else {
    const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const text = encodeURIComponent(shareText(st.name));
    const url = encodeURIComponent(st.url);
    body =
      '<label class="share-label" for="share-url">共有リンク</label>' +
      '<input type="text" id="share-url" class="share-url" readonly value="' + esc(st.url) + '">' +
      '<div class="share-actions">' +
        (canNative ? '<button type="button" class="btn btn-primary btn-small" data-share-act="native">共有メニューを開く</button>' : '') +
        '<button type="button" class="btn btn-secondary btn-small" data-share-act="copy">リンクをコピー</button>' +
        '<a class="btn btn-secondary btn-small" data-share-act="x" target="_blank" rel="noopener noreferrer" href="https://twitter.com/intent/tweet?text=' + text + '&url=' + url + '">X</a>' +
        '<a class="btn btn-secondary btn-small" data-share-act="line" target="_blank" rel="noopener noreferrer" href="https://social-plugins.line.me/lineit/share?url=' + url + '">LINE</a>' +
      '</div>' +
      '<p class="share-note" data-share-msg role="status">' + esc(st.message || '') + '</p>' +
      '<p class="share-note">リンクを知っている人は誰でも、このレシピと写真を見られます(あなたの名前などは表示されません)。レシピを直したあとは、もう一度「共有」を押すと、同じリンクの中身が新しくなります。</p>' +
      '<button type="button" class="btn btn-ghost btn-small share-stop" data-share-act="stop">共有をやめる</button>';
  }
  return '' +
    '<div class="saved-sheet-grip" aria-hidden="true"></div>' +
    '<header class="saved-sheet-head">' +
      '<h2 id="share-title">レシピを共有</h2>' +
      '<button type="button" class="saved-sheet-close" data-sheet-close aria-label="閉じる">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
    '</header>' +
    '<div class="saved-sheet-scroll share-body">' +
      '<p class="share-name">' + esc(st.name) + '</p>' + body +
    '</div>';
}

function renderShareSheet(){
  const panel = document.getElementById('share-panel');
  if(panel && shareState) panel.innerHTML = shareSheetHtml(shareState);
}

function setShareMessage(text){
  if(shareState) shareState.message = text;
  const el = document.querySelector('#share-panel [data-share-msg]');
  if(el) el.textContent = text || '';
}

async function openShareSheet(id, opener){
  const wrap = document.getElementById('share-sheet');
  const recipe = getSaved().find(r => r.id === id);
  if(!wrap || !recipe) return;
  shareState = { id, name: recipe.name, status: 'loading', url: '', message: '' };
  renderShareSheet();
  openSavedSheet(wrap, opener, '.saved-sheet-close');
  try {
    const res = await fetch('/api/recipes/' + encodeURIComponent(id) + '/share', { method: 'POST' });
    let body = null;
    try { body = await res.json(); } catch(e){ /* JSONでない応答 */ }
    if(!shareState || shareState.id !== id) return; // 待っている間に閉じられた
    if(!res.ok || !body || !body.url){
      const err = new Error((body && body.error) || '共有リンクを作れませんでした');
      err.status = res.status;
      throw err;
    }
    recipe.shareToken = body.token;
    shareState = { id, name: recipe.name, status: 'ready', url: body.url, message: '' };
    if(typeof refreshSavedDetail === 'function') refreshSavedDetail(); // 詳細シートのボタンが「共有中」になる
  } catch(e){
    if(typeof recordSaveError === 'function') recordSaveError('share', e, { recipeId: id, status: e && e.status });
    if(!shareState || shareState.id !== id) return;
    shareState = { id, name: recipe.name, status: 'error', url: '', message: e && e.message ? e.message : '共有リンクを作れませんでした' };
  }
  renderShareSheet();
}

async function copyShareUrl(url){
  try {
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch(e){ /* 下の方法を試す */ }
  const input = document.getElementById('share-url');
  if(!input) return false;
  input.focus();
  input.select();
  input.setSelectionRange(0, url.length);
  try { return document.execCommand('copy'); } catch(e){ return false; }
}

async function stopSharing(){
  if(!shareState) return;
  if(!window.confirm('共有をやめますか?このリンクを開いても、レシピは見られなくなります。')) return;
  const id = shareState.id;
  try {
    const res = await fetch('/api/recipes/' + encodeURIComponent(id) + '/share', { method: 'DELETE' });
    if(!res.ok) throw new Error('共有をやめられませんでした');
    const recipe = getSaved().find(r => r.id === id);
    if(recipe) delete recipe.shareToken;
    closeSavedSheet(document.getElementById('share-sheet'));
    shareState = null;
    if(typeof refreshSavedDetail === 'function') refreshSavedDetail();
  } catch(e){
    if(typeof recordSaveError === 'function') recordSaveError('share-stop', e, { recipeId: id });
    setShareMessage(e && e.message ? e.message : '共有をやめられませんでした');
  }
}

function setupShareSheet(){
  if(typeof document === 'undefined' || document.getElementById('share-sheet')) return;
  document.body.insertAdjacentHTML('beforeend',
    '<div id="share-sheet" class="saved-sheet-wrap" hidden>' +
      '<div class="saved-sheet-backdrop" data-sheet-close></div>' +
      '<section id="share-panel" class="saved-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title"></section>' +
    '</div>');
  const wrap = document.getElementById('share-sheet');
  wrap.addEventListener('click', async (e) => {
    if(e.target.closest('[data-sheet-close]')){ closeSavedSheet(wrap); shareState = null; return; }
    const btn = e.target.closest('[data-share-act]');
    if(!btn || !shareState || shareState.status !== 'ready') return;
    const act = btn.dataset.shareAct;
    if(act === 'copy'){
      setShareMessage((await copyShareUrl(shareState.url)) ? 'リンクをコピーしました' : 'コピーできませんでした。リンクを長押ししてコピーしてください');
    } else if(act === 'native'){
      // iPhoneのSafariなどは、ボタンを押した直後でないと共有メニューを開けない(だから、リンクを作ったあとにこのボタンを押してもらう)
      try { await navigator.share({ title: shareState.name, text: shareText(shareState.name), url: shareState.url }); }
      catch(err){ if(!err || err.name !== 'AbortError') setShareMessage('共有メニューを開けませんでした。リンクをコピーして送ってください'); }
    } else if(act === 'stop'){
      stopSharing();
    }
  });
}

if(typeof document !== 'undefined' && document.body) setupShareSheet();
