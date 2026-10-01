// ==== パスキーでのログイン・新規登録 ====
// index.htmlで @simplewebauthn/browser のUMDバンドルを先に読み込んでおく必要があります
// (window.SimpleWebAuthnBrowser)。
// save.js の reloadSaved/migrateLocalSavedToServer に依存します。
// ログイン状態が変わるたびに、settings.js の onAuthChanged()(管理者用の設定欄の表示切り替え)を呼びます。
// 失敗は error-log.js の logError で管理者向けエラーログに記録します(ユーザーによるキャンセルは記録しません)。
// ログアウト時は、端末にログが残らないようにログを消去します。
//
// パスキーは1人1つだけ。ユーザー名の入力はなく、ログイン中は「新規登録」ボタンも表示しません。

  let currentUser = null; // { id, isAdmin } | null (ログイン中のユーザー)

  // この端末でパスキーを登録またはログインしたことがあるかの目印(二重登録の確認ダイアログ用)
  const PASSKEY_USED_KEY = 'recipeRoulettePasskeyUsedV1';

  function isLoggedIn(){
    return !!currentUser;
  }

  function isAdmin(){
    return !!(currentUser && currentUser.isAdmin);
  }

  function markPasskeyUsed(){
    try { localStorage.setItem(PASSKEY_USED_KEY, '1'); } catch(e){ /* 保存できない環境では無視 */ }
  }
  function hasUsedPasskey(){
    try { return localStorage.getItem(PASSKEY_USED_KEY) === '1'; } catch(e){ return false; }
  }

  // 管理者向けエラーログへ記録する(error-log.js が無い環境では何もしない)
  function recordAuthError(step, err, extra){
    if(typeof logError !== 'function') return;
    const info = Object.assign({}, extra);
    if(err && err.code) info.code = err.code; // @simplewebauthn/browser のエラーコード
    logError('auth-' + step, err, info);
  }

  function showAuthStatus(msg, isError){
    const el = document.getElementById('auth-status');
    if(!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.style.color = isError ? 'var(--protein)' : 'var(--veg)';
  }

  function renderAuthUI(){
    const box = document.getElementById('account-box');
    if(box){
      if(currentUser){
        box.innerHTML = `
          <p class="input-hint">ログイン中${currentUser.isAdmin ? '(管理者)' : ''}</p>
          <button class="reroll" id="btn-logout" style="margin-top:10px;">ログアウト</button>
        `;
        document.getElementById('btn-logout').addEventListener('click', logout);
      } else {
        box.innerHTML = `
          <p class="input-hint">はじめての方は「パスキーで新規登録」、登録済みの方は「パスキーでログイン」を押してください。パスキーは1人1つだけ作成できます。</p>
          <button class="reroll" id="btn-register" style="margin-top:10px;">パスキーで新規登録</button>
          <button class="reroll" id="btn-login" style="margin-top:10px;">パスキーでログイン</button>
          <p id="auth-status" class="input-hint" hidden style="text-align:center;"></p>
        `;
        document.getElementById('btn-register').addEventListener('click', register);
        document.getElementById('btn-login').addEventListener('click', login);
      }
    }
    // 管理者用の設定欄(settings.js)の表示・非表示を更新する
    if(typeof onAuthChanged === 'function') onAuthChanged();
  }

  function passkeySupported(){
    return typeof window.SimpleWebAuthnBrowser !== 'undefined';
  }

  async function register(){
    if(!passkeySupported()){
      showAuthStatus('この端末・ブラウザはパスキーに対応していません。', true);
      return;
    }
    // 登録済みなのに間違えて「新規登録」を押すと、保存済みレシピのない別アカウントができてしまうため確認する
    if(hasUsedPasskey()){
      const proceed = window.confirm(
        'この端末ではすでにパスキーを登録またはログインしたことがあります。\n' +
        'もう一度新規登録すると、保存済みレシピのない別のアカウントになります。\n\n' +
        '登録済みの場合は「キャンセル」して「パスキーでログイン」を押してください。\n新規登録を続けますか?'
      );
      if(!proceed) return;
    }
    try {
      showAuthStatus('端末に登録中…画面の指示に従ってください。', false);

      const optionsRes = await fetch('/api/auth/register-options', { method: 'POST' });
      const options = await optionsRes.json();
      if(!optionsRes.ok) throw new Error(options.error || '登録に失敗しました。');

      const attestationResponse = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attestationResponse),
      });
      const verifyData = await verifyRes.json();
      if(!verifyRes.ok) throw new Error(verifyData.error || '登録に失敗しました。');

      currentUser = verifyData.user;
      markPasskeyUsed();
      await migrateLocalSavedToServer();
      renderAuthUI();
      showAuthStatus('登録が完了しました。', false);
      await reloadSaved();
    } catch(err){
      if(!(err && err.name === 'NotAllowedError')) recordAuthError('register', err);
      showAuthStatus(describeAuthError(err), true);
    }
  }

  async function login(){
    if(!passkeySupported()){
      showAuthStatus('この端末・ブラウザはパスキーに対応していません。', true);
      return;
    }
    try {
      showAuthStatus('ログイン中…画面の指示に従ってください。', false);

      const optionsRes = await fetch('/api/auth/login-options', { method: 'POST' });
      const options = await optionsRes.json();
      if(!optionsRes.ok) throw new Error(options.error || 'ログインに失敗しました。');

      const authenticationResponse = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/auth/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authenticationResponse),
      });
      const verifyData = await verifyRes.json();
      if(!verifyRes.ok) throw new Error(verifyData.error || 'ログインに失敗しました。');

      currentUser = verifyData.user;
      markPasskeyUsed();
      await migrateLocalSavedToServer();
      renderAuthUI();
      showAuthStatus('ログインしました。', false);
      await reloadSaved();
    } catch(err){
      if(!(err && err.name === 'NotAllowedError')) recordAuthError('login', err);
      showAuthStatus(describeAuthError(err), true);
    }
  }

  async function logout(){
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch(e){ /* 無視 */ }
    currentUser = null;
    if(typeof clearErrorLog === 'function') clearErrorLog(); // 端末にログを残さない
    renderAuthUI();
    await reloadSaved();
  }

  function describeAuthError(err){
    // ユーザーがブラウザのダイアログをキャンセルした場合などはNotAllowedErrorになる
    if(err && err.name === 'NotAllowedError') return '操作がキャンセルされました。';
    return (err && err.message) || '通信に失敗しました。時間をおいて再度お試しください。';
  }

  async function checkSession(){
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if(!res.ok) recordAuthError('session', new Error('ログイン状態の確認に失敗しました(' + res.status + ')'), { status: res.status });
      currentUser = data.user || null;
    } catch(e){
      recordAuthError('session', e);
      currentUser = null;
    }
    renderAuthUI();
    await reloadSaved();
  }

  checkSession();
