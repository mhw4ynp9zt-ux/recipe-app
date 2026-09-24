// ==== パスキーでのログイン・新規登録 ====
// index.htmlで @simplewebauthn/browser のUMDバンドルを先に読み込んでおく必要があります
// (window.SimpleWebAuthnBrowser)。
// save.js の reloadSaved/migrateLocalSavedToServer に依存します。

  let currentUser = null; // { id, username, displayName } | null (ログイン中のユーザー)

  function isLoggedIn(){
    return !!currentUser;
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
    if(!box) return;

    if(currentUser){
      box.innerHTML = `
        <p class="input-hint">ログイン中: <strong>${currentUser.displayName}</strong></p>
        <button class="reroll" id="btn-logout" style="margin-top:10px;">ログアウト</button>
      `;
      document.getElementById('btn-logout').addEventListener('click', logout);
      return;
    }

    box.innerHTML = `
      <label for="auth-username">ユーザー名</label>
      <input type="text" id="auth-username" placeholder="例: taro" autocomplete="username" autocapitalize="none" spellcheck="false">
      <p class="input-hint">はじめての方はこの名前で新規登録されます。2回目以降は「パスキーでログイン」だけで大丈夫です。</p>
      <button class="reroll" id="btn-register" style="margin-top:10px;">この端末のパスキーで新規登録</button>
      <button class="reroll" id="btn-login" style="margin-top:10px;">パスキーでログイン</button>
      <p id="auth-status" class="input-hint" hidden style="text-align:center;"></p>
    `;
    document.getElementById('btn-register').addEventListener('click', register);
    document.getElementById('btn-login').addEventListener('click', login);
  }

  function passkeySupported(){
    return typeof window.SimpleWebAuthnBrowser !== 'undefined';
  }

  async function register(){
    if(!passkeySupported()){
      showAuthStatus('この端末・ブラウザはパスキーに対応していません。', true);
      return;
    }
    const usernameEl = document.getElementById('auth-username');
    const username = usernameEl ? usernameEl.value.trim() : '';
    if(!username){
      showAuthStatus('ユーザー名を入力してください。', true);
      return;
    }
    try {
      showAuthStatus('端末に登録中…画面の指示に従ってください。', false);

      const optionsRes = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, displayName: username }),
      });
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
      await migrateLocalSavedToServer();
      renderAuthUI();
      showAuthStatus('登録が完了しました。', false);
      await reloadSaved();
    } catch(err){
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
      await migrateLocalSavedToServer();
      renderAuthUI();
      showAuthStatus('ログインしました。', false);
      await reloadSaved();
    } catch(err){
      showAuthStatus(describeAuthError(err), true);
    }
  }

  async function logout(){
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch(e){ /* 無視 */ }
    currentUser = null;
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
      currentUser = data.user || null;
    } catch(e){
      currentUser = null;
    }
    renderAuthUI();
    await reloadSaved();
  }

  checkSession();
