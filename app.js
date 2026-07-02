/*
 * フェーズ0: Googleログイン → IDトークン取得 → hd(組織ドメイン)確認 → api('ping') 疎通
 *
 * ここで確認したいこと:
 *   1) GitHub Pages(別オリジン)からGASを fetch できる（CORSが通る）
 *   2) hanshinco.com 以外は拒否される（hd検証がGAS側で効く）
 */

let idToken = null;

// JWT(IDトークン)のペイロードをデコード（表示・事前チェック用。本当の検証はGAS側）
function decodeJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  );
  return JSON.parse(json);
}

// Googleログイン成功時のコールバック
function onCredential(resp) {
  idToken = resp.credential;
  const claims = decodeJwt(idToken);
  const who = document.getElementById('who');

  // クライアント側の事前チェック（あくまでUX用。すり抜けてもGAS側で弾かれる）
  if (claims.hd !== window.APP_CONFIG.ALLOWED_DOMAIN) {
    who.textContent = '⛔ 拒否: ' + window.APP_CONFIG.ALLOWED_DOMAIN +
      ' のアカウントでログインしてください（あなた: ' + (claims.hd || claims.email) + '）';
    who.className = 'who ng';
    document.getElementById('pingBtn').disabled = true;
    return;
  }
  who.textContent = '✅ ログイン: ' + claims.email;
  who.className = 'who ok';
  document.getElementById('pingBtn').disabled = false;
}

// GAS API 呼び出しラッパー（Content-Type: text/plain でCORSプリフライトを回避）
async function api(action, args) {
  const res = await fetch(window.APP_CONFIG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, token: idToken, args: args || {} })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return data.result;
}

// pingボタン
async function doPing() {
  const out = document.getElementById('out');
  out.textContent = '呼び出し中…';
  out.className = 'out';
  try {
    const r = await api('ping', {});
    out.textContent = '✅ 疎通OK\n\n' + JSON.stringify(r, null, 2);
    out.className = 'out ok';
  } catch (e) {
    out.textContent = '❌ 失敗: ' + e.message;
    out.className = 'out ng';
  }
}

// 初期化
window.addEventListener('load', function () {
  if (!window.google || !google.accounts || !google.accounts.id) {
    document.getElementById('who').textContent =
      'Google Identity Services を読み込めませんでした（ネットワーク/拡張機能を確認）';
    return;
  }
  google.accounts.id.initialize({
    client_id: window.APP_CONFIG.CLIENT_ID,
    callback: onCredential
  });
  google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'outline', size: 'large' });
  google.accounts.id.prompt();  // ワンタップ表示（任意）
  document.getElementById('pingBtn').addEventListener('click', doPing);
});
