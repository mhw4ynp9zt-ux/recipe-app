// ==== 管理者向けエラーログ ====
// 画面で起きたエラー(通信の失敗・サーバーが返したエラー・予期しない例外・読み込み失敗)を、
// この端末のメモリに記録します。管理者としてログインしているときだけ、
// 「ログをダウンロード」ボタンが表示され、JSONファイルとして保存できます。
//
//  ・記録先はメモリだけです(ページを閉じる・再読み込みすると消えます)。サーバーへは送りません。
//  ・ログアウトすると消去します(共有の端末にログが残らないように)。
//  ・APIキーなどの秘密は記録しません(xai-... や Bearer ... は [REDACTED] に置き換え、
//    キー名が apiKey / token / password などの値も伏せます)。管理者用APIへ送った内容(リクエスト本文)は
//    APIキーを含みうるので、そもそも記録しません。
//  ・サーバー側の詳細(AIの失敗理由など)は、管理者のときだけサーバーが応答の debug / detail に入れて返します。
//    ここではそれを受け取って記録するだけです(権限の判定はサーバー側で行われます)。
//
// 他のファイルからは logError(出どころ, エラー, 追加情報) を呼びます(logWarn は警告用)。
// auth.js の isAdmin() に依存します。auth.js はこのファイルより後に読み込まれるため、
// isAdmin が未定義の間は「管理者ではない」として扱います。
// 他のファイルが logError を呼べるよう、このファイルは utils.js の次(save.js・auth.js・settings.js・create-ai.js より前)に読み込んでください。

  const ERROR_LOG_MAX = 200;       // 記録する最大件数(古いものから捨てる)
  const ERROR_LOG_TEXT_MAX = 4000; // 1つの文字列の最大長
  const errorLogEntries = [];

  // ---- 秘密の伏せ字 ----
  function redactLogText(text){
    return String(text)
      .replace(/xai-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]');
  }
  function clipLogText(text){
    const s = redactLogText(text);
    return s.length > ERROR_LOG_TEXT_MAX
      ? s.slice(0, ERROR_LOG_TEXT_MAX) + '…(以降省略。全体で' + s.length + '文字)'
      : s;
  }
  // キー名そのものが秘密を表すものは、値を見ずに伏せる(hasKey のような無害な名前は対象外)
  const SECRET_KEY_NAME = /^(api[-_]?key|authorization|cookie|password|token|secret)$/i;

  function sanitizeLogValue(value, depth){
    depth = depth || 0;
    if(value === null || value === undefined) return value;
    if(typeof value === 'string') return clipLogText(value);
    if(typeof value === 'number' || typeof value === 'boolean') return value;
    if(depth >= 6) return '(深すぎるため省略)';
    if(Array.isArray(value)) return value.slice(0, 50).map(v => sanitizeLogValue(v, depth + 1));
    if(typeof value === 'object'){
      const out = {};
      Object.keys(value).forEach(k => {
        out[k] = SECRET_KEY_NAME.test(k) ? '[REDACTED]' : sanitizeLogValue(value[k], depth + 1);
      });
      return out;
    }
    return clipLogText(String(value));
  }

  // ---- 記録 ----
  function pushLogEntry(level, source, error, extra){
    const entry = { time: new Date().toISOString(), level: level, source: String(source) };
    if(error instanceof Error){
      entry.message = clipLogText(error.message);
      entry.name = error.name;
      if(error.stack) entry.stack = clipLogText(error.stack);
    } else {
      entry.message = clipLogText(error === undefined || error === null ? '' : error);
    }
    if(extra && typeof extra === 'object'){
      Object.keys(extra).forEach(k => {
        if(extra[k] !== undefined) entry[k] = SECRET_KEY_NAME.test(k) ? '[REDACTED]' : sanitizeLogValue(extra[k]);
      });
    }
    errorLogEntries.push(entry);
    while(errorLogEntries.length > ERROR_LOG_MAX) errorLogEntries.shift();
    renderLogControls();
  }

  function logError(source, error, extra){
    try { pushLogEntry('error', source, error, extra); } catch(e){ /* ログの記録自体で画面を壊さない */ }
  }
  function logWarn(source, message, extra){
    try { pushLogEntry('warn', source, message, extra); } catch(e){ /* 同上 */ }
  }

  function getErrorLogCount(){
    return errorLogEntries.length;
  }
  function clearErrorLog(){
    errorLogEntries.length = 0;
    renderLogControls();
  }

  // auth.js はこのファイルより後に読み込まれるため、まだ無い場合は管理者ではないものとして扱う
  function viewerIsAdmin(){
    return typeof isAdmin === 'function' && isAdmin();
  }

  // ---- ダウンロード ----
  function pad2(n){ return String(n).padStart(2, '0'); }

  function buildErrorLogFile(){
    const now = new Date();
    const stamp = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) + '-' +
      pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
    const payload = {
      app: 'recipe-app',
      format: 1,
      exportedAt: now.toISOString(),
      page: location.origin + location.pathname,
      userAgent: navigator.userAgent,
      entryCount: errorLogEntries.length,
      entries: errorLogEntries,
    };
    return { filename: 'recipe-app-log-' + stamp + '.json', text: JSON.stringify(payload, null, 2) };
  }

  function downloadErrorLog(){
    // 表示の制御と同じく見た目上のガード。サーバー側の情報は、管理者以外にはそもそも届いていない。
    if(!viewerIsAdmin() || !errorLogEntries.length) return;
    const file = buildErrorLogFile();
    const blob = new Blob([file.text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- 画面(ボタンの表示・非表示と件数) ----
  // 「作る」タブ: 管理者でログが1件以上あるときだけ表示
  // 「設定」タブの管理者欄: 管理者なら常に表示(0件のときはボタンを無効にする)
  function renderLogControls(){
    const admin = viewerIsAdmin();
    const count = errorLogEntries.length;

    const createBox = document.getElementById('create-log-box');
    const createCount = document.getElementById('create-log-count');
    if(createBox) createBox.hidden = !(admin && count > 0);
    if(createCount) createCount.textContent = 'エラーログ ' + count + ' 件(管理者のみ表示)';

    const adminCount = document.getElementById('admin-log-count');
    const adminDownload = document.getElementById('btn-log-download-admin');
    const adminClear = document.getElementById('btn-log-clear');
    if(adminCount) adminCount.textContent = count ? '記録されているログ: ' + count + ' 件' : '記録されているログはありません。';
    if(adminDownload) adminDownload.disabled = !count;
    if(adminClear) adminClear.disabled = !count;
  }

  (function wireLogControls(){
    ['btn-log-download-create', 'btn-log-download-admin'].forEach(id => {
      const btn = document.getElementById(id);
      if(btn) btn.addEventListener('click', downloadErrorLog);
    });
    const clearBtn = document.getElementById('btn-log-clear');
    if(clearBtn) clearBtn.addEventListener('click', clearErrorLog);
  })();

  // ---- 想定外のエラーも拾う ----
  window.addEventListener('error', (e) => {
    // スクリプトや画像などの読み込み失敗(例: パスキー用ライブラリのCDNに繋がらない)
    if(e.target && e.target !== window && e.target.tagName){
      logError('resource', new Error('読み込みに失敗しました: ' + (e.target.src || e.target.href || e.target.tagName)), { tag: e.target.tagName });
      return;
    }
    // ブラウザが出す無害な通知は記録しない
    if(e.message && String(e.message).indexOf('ResizeObserver loop') !== -1) return;
    logError('global', e.error || new Error(e.message || '不明なエラー'), { file: e.filename, line: e.lineno, col: e.colno });
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    logError('unhandledrejection', reason instanceof Error ? reason : new Error(String(reason)));
  });

  renderLogControls();
