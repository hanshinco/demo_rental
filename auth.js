/*
 * 認証レイヤ + google.script.run シム
 *
 * 役割:
 *   1) Google Identity Services でログイン → IDトークン取得 → hd(組織ドメイン)を事前確認
 *   2) fetch ラッパー api() を提供（Content-Type: text/plain でCORSプリフライト回避）
 *   3) 現行 app-core.js が使う google.script.run を “シム” で再現し、無改変で動かす
 *      （google.script.run.withSuccessHandler(f).withFailureHandler(g).METHOD(args...) を
 *       api('METHOD',[args...]).then(f).catch(g) に橋渡し）
 *   4) ログイン成功後に boot()（app-core.js内）を起動
 *
 * ★本当のドメイン制限はGAS側の verifyToken_（hd検証）が担保。ここのhdチェックは表示用。
 */

let idToken = null;

// JWT(IDトークン)のペイロードをデコード（表示・事前チェック用。検証はGAS側）
function decodeJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  );
  return JSON.parse(json);
}

// GAS API 呼び出し（text/plain でプリフライト回避）。args は配列（位置引数）。
async function api(action, args) {
  const res = await fetch(window.APP_CONFIG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, token: idToken, args: args || [] })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.result;
}

// google.script.run のシム本体。handler の連鎖と任意メソッド呼び出しをProxyで再現。
function makeRunner(onSuccess, onFailure) {
  return new Proxy({}, {
    get: function (_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'withSuccessHandler') return function (f) { return makeRunner(f, onFailure); };
      if (prop === 'withFailureHandler') return function (f) { return makeRunner(onSuccess, f); };
      if (prop === 'withUserObject') return function () { return makeRunner(onSuccess, onFailure); };
      // それ以外はサーバ関数名とみなす
      return function () {
        var args = Array.prototype.slice.call(arguments);
        api(prop, args)
          .then(function (r) { if (onSuccess) onSuccess(r); })
          .catch(function (e) {
            if (onFailure) onFailure(e);
            else { if (window.busyOff) window.busyOff(); alert(e.message || e); }
          });
      };
    }
  });
}

// window.google に .script を“足す”（GISの .accounts を壊さないよう既存オブジェクトを保持）
function installGasShim() {
  window.google = window.google || {};
  window.google.script = { run: makeRunner(null, null) };
}

// ログイン成功時
function onCredential(resp) {
  idToken = resp.credential;
  var claims = decodeJwt(idToken);
  var msg = document.getElementById('login-msg');
  if (claims.hd !== window.APP_CONFIG.ALLOWED_DOMAIN) {
    msg.textContent = '⛔ ' + window.APP_CONFIG.ALLOWED_DOMAIN +
      ' のアカウントでログインしてください（あなた: ' + (claims.hd || claims.email) + '）';
    msg.className = 'login-msg ng';
    return;
  }
  installGasShim();
  document.getElementById('login').style.display = 'none';
  document.getElementById('loading').style.display = '';
  boot();   // app-core.js
}

// GIS読み込み待ち → 初期化
function initAuth() {
  google.accounts.id.initialize({
    client_id: window.APP_CONFIG.CLIENT_ID,
    callback: onCredential
  });
  google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'outline', size: 'large', width: 260 });
  google.accounts.id.prompt();
}

function waitForGis(tries) {
  tries = tries || 0;
  if (window.google && window.google.accounts && window.google.accounts.id) { initAuth(); return; }
  if (tries > 100) {
    document.getElementById('login-msg').textContent =
      'Googleログインを読み込めませんでした（ネットワーク/拡張機能を確認してください）';
    return;
  }
  setTimeout(function () { waitForGis(tries + 1); }, 50);
}

window.addEventListener('load', function () { waitForGis(0); });
