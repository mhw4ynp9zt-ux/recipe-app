// ==== 料理の写真 ====
// 保存済みレシピに、作った料理の写真を1枚付けられます。写真は端末で縮小(長辺960px・約400KB以内のJPEG)してから保存します。
//   ・ログイン中: サーバー(PUT/DELETE /api/recipes/:id/photo)。一覧の photoUrl がその画像のURLです
//   ・未ログイン: この端末のlocalStorage(レシピの photoData に画像のdata URLを入れる)。ログインすると、サーバーへ引き継ぎます
// save.js の getSaved / renderSavedView / setLocalSaved / recordSaveError、auth.js の isLoggedIn に依存します(呼ぶのはタップされたときなので、読み込み順は save.js より後であればOKです)。
// このファイルは、写真の付け外しのための /api/recipes/:id/photo だけを呼びます(AIは呼びません)。

const PHOTO_MAX_EDGE = 960;
const PHOTO_MAX_BYTES = 380 * 1024; // サーバーの上限(400KB)より少し小さく収める
const PHOTO_QUALITIES = [0.82, 0.7, 0.58, 0.46];

// 表示に使う画像のURL(サーバーの画像、または端末内のdata URL)。無ければ ''
function recipePhotoSrc(d){
  if(!d) return '';
  if(typeof d.photoUrl === 'string' && d.photoUrl) return d.photoUrl;
  if(typeof d.photoData === 'string' && d.photoData.indexOf('data:image/') === 0) return d.photoData;
  return '';
}

function photoDataUrlBytes(dataUrl){
  const i = dataUrl.indexOf(',');
  return Math.floor((dataUrl.length - i - 1) * 3 / 4);
}

async function photoLoadBitmap(file){
  if(typeof createImageBitmap === 'function'){
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch(e){ /* 古いブラウザは下のImageで読む */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 選んだ画像ファイルを縮小して、JPEGのdata URLにする。上限に収まらなければ、画質→大きさの順に下げる
async function resizePhotoFile(file){
  if(!file || !/^image\//.test(file.type || 'image/')) throw new Error('画像ファイルを選んでください');
  const bmp = await photoLoadBitmap(file);
  const w0 = bmp.width || bmp.naturalWidth;
  const h0 = bmp.height || bmp.naturalHeight;
  if(!w0 || !h0) throw new Error('画像を読み込めませんでした');
  let scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w0, h0));
  for(let round = 0; round < 4; round++){
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // 透明な部分(PNGなど)が黒くならないように
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for(const q of PHOTO_QUALITIES){
      const url = canvas.toDataURL('image/jpeg', q);
      if(photoDataUrlBytes(url) <= PHOTO_MAX_BYTES) return url;
    }
    scale *= 0.8;
  }
  throw new Error('画像を小さくできませんでした。別の写真をお試しください');
}

async function uploadPhotoToServer(id, dataUrl){
  const res = await fetch('/api/recipes/' + encodeURIComponent(id) + '/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl }),
  });
  let body = null;
  try { body = await res.json(); } catch(e){ /* JSONでない応答 */ }
  if(!res.ok){
    const err = new Error((body && body.error) || '写真を保存できませんでした');
    err.status = res.status;
    throw err;
  }
  return body;
}

// 詳細シートの中の案内文(成功・失敗)。シートが描き直されても出し直せるように、描画の後に呼ぶ
function showPhotoMessage(text, isError){
  const el = document.querySelector('#saved-detail-panel [data-photo-msg]');
  if(!el) return;
  el.textContent = text || '';
  el.classList.toggle('is-error', !!isError);
}

let photoBusy = false;

// 写真を付ける・差し替える。成功したら一覧と詳細シートを描き直す。
async function setRecipePhoto(id, file){
  if(photoBusy) return;
  const recipe = getSaved().find(r => r.id === id);
  if(!recipe) return;
  photoBusy = true;
  showPhotoMessage('写真を保存しています…', false);
  try {
    const dataUrl = await resizePhotoFile(file);
    if(isLoggedIn()){
      const body = await uploadPhotoToServer(id, dataUrl);
      recipe.photoUrl = body.photoUrl;
      delete recipe.photoData;
    } else {
      const before = { photoData: recipe.photoData, photoUrl: recipe.photoUrl };
      recipe.photoData = dataUrl;
      delete recipe.photoUrl;
      if(!setLocalSaved(getSaved())){
        recipe.photoData = before.photoData;
        if(before.photoUrl) recipe.photoUrl = before.photoUrl;
        if(recipe.photoData === undefined) delete recipe.photoData;
        throw new Error('この端末の保存容量がいっぱいです。不要な写真を削除するか、ログインして保存してください');
      }
    }
    renderSavedView();
    showPhotoMessage('写真を保存しました', false);
  } catch(e){
    if(typeof recordSaveError === 'function') recordSaveError('photo', e, { recipeId: id, status: e && e.status });
    showPhotoMessage(e && e.message ? e.message : '写真を保存できませんでした', true);
  } finally {
    photoBusy = false;
  }
}

async function removeRecipePhoto(id){
  if(photoBusy) return;
  const recipe = getSaved().find(r => r.id === id);
  if(!recipe) return;
  if(!window.confirm('この写真を削除しますか?')) return;
  photoBusy = true;
  try {
    if(isLoggedIn()){
      const res = await fetch('/api/recipes/' + encodeURIComponent(id) + '/photo', { method: 'DELETE' });
      if(!res.ok) throw new Error('写真を削除できませんでした');
    } else if(recipe.photoData){
      delete recipe.photoData;
      setLocalSaved(getSaved());
    }
    delete recipe.photoUrl;
    delete recipe.photoData;
    renderSavedView();
    showPhotoMessage('写真を削除しました', false);
  } catch(e){
    if(typeof recordSaveError === 'function') recordSaveError('photo-delete', e, { recipeId: id });
    showPhotoMessage(e && e.message ? e.message : '写真を削除できませんでした', true);
  } finally {
    photoBusy = false;
  }
}

// ログイン直後の引き継ぎ用: 端末内の写真(photoData)をサーバーへ送る。失敗しても写真は端末に残らないので、呼び出し側が記録する
async function migrateLocalPhotos(list){
  for(const r of list){
    if(r && typeof r.photoData === 'string' && r.photoData.indexOf('data:image/') === 0){
      try { await uploadPhotoToServer(r.id, r.photoData); }
      catch(e){ if(typeof recordSaveError === 'function') recordSaveError('migrate-photo', e, { recipeId: r.id }); }
    }
  }
}
