/*
 * フェーズ0 設定ファイル。値を各自の環境に合わせて書き換える。
 * ※どちらの値も「公開されても安全」:
 *   - CLIENT_ID はブラウザ用OAuthクライアントIDで公開前提の値（シークレットではない）
 *   - GAS_URL はトークン検証で保護されており、URLを知られても突破できない
 */
window.APP_CONFIG = {
  // Google Cloud Console で発行した OAuth クライアントID
  CLIENT_ID: 'ここにOAuthクライアントIDを貼る.apps.googleusercontent.com',
  // GAS ウェブアプリのデプロイURL（末尾が /exec のもの）
  GAS_URL: 'ここにGASのexec URLを貼る',
  // 許可する組織ドメイン（クライアント側の事前チェック用。本当の検証はGAS側）
  ALLOWED_DOMAIN: 'hanshinco.com'
};
