// AAUC2 - ページ読み込みの最初(document_start)に実行して、元のポータル画面が一瞬見えるのを防ぐ。
// AAUC2 を開いた状態が保存されているときだけ、背景色で画面を覆う。AAUC2 の画面ができたら content.js が外す。
(() => {
  try {
    // 動作対象のホスト(自分の大学に合わせて書き換える。content.js の HOST_PATTERN と同じ値にする)
    if (!/^aaaportal\..+\.ac\.jp$/.test(location.hostname)) return;
    if (!/\/portal\/mt0010\.aspx$/i.test(location.pathname)) return; // 時間割を置き換えるトップページだけ
    const read = (key, fallback) => {
      try {
        const v = localStorage.getItem('aauc2.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    };
    if (read('open', true) === false) return; // 閉じた状態(元の画面を見る設定)なら覆わない

    // ライト/ダークは保存された設定に合わせる(自動なら OS の設定)
    const theme = read('theme', 'auto');
    const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

    const style = document.createElement('style');
    style.id = 'aauc2-cover';
    style.textContent = `html { background: ${dark ? '#0b0d1a' : '#f3f4fb'} !important; } body { visibility: hidden !important; }`;
    (document.head || document.documentElement).append(style);

    // 安全策: 週間の表が無いページ、または5秒たっても画面ができないときは、必ず外す(真っ白のままにしない)
    const remove = () => document.getElementById('aauc2-cover')?.remove();
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.getElementById('tabCalender_tabPanelWeek_tblWeek')) remove();
    }, { once: true });
    setTimeout(remove, 5000);
  } catch { /* 失敗しても元の画面がそのまま見えるだけ */ }
})();
