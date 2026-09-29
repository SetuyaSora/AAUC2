// AAUC2 - Active Academy Advance ダッシュボード
// トップページ(週間スケジュール)のDOMを読み取り、Shadow DOM内に新しいUIを描画する。
(() => {
  'use strict';

  // 動作対象のホスト(自分の大学に合わせて書き換える。early.js の判定と同じ値にする)。
  // manifest.json の matches は広め(*.ac.jp)にしてあり、実際に動くのはここに合うホストだけ。
  // デモ(demo.html)は、ページ側が __AAUC2_DEMO__ を定義するので通す(拡張機能の実行環境からはページの変数は見えないので、本番では無効)
  const HOST_PATTERN = /^aaaportal\..+\.ac\.jp$/;
  if (!globalThis.__AAUC2_DEMO__ && !HOST_PATTERN.test(location.hostname)) return;

  const ROOT_ID = 'aauc2-root';
  if (document.getElementById(ROOT_ID)) return;

  // ---------- 小さなユーティリティ ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('aauc2.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('aauc2.' + key, JSON.stringify(value)); } catch { /* 保存できなくても動作は継続 */ }
    },
  };

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid);
    }
    return el;
  };

  // アイコン(固定文字列のみを使う。データは埋め込まない)
  const ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    left: '<path d="M15 18l-6-6 6-6"/>',
    right: '<path d="M9 18l6-6-6-6"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    note: '<path d="M4 4h16v11l-7 7H4z"/><path d="M13 22v-6a1 1 0 0 1 1-1h6"/><path d="M8 9h8M8 13h4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M5 3L2 6M22 6l-3-3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  };
  const icon = (name, size = 16) => {
    const span = h('span', { class: 'ico', 'aria-hidden': 'true' });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return span;
  };
  const PORTAL_ICON = { lbtnOshirase: 'bell', lbtnRenraku: 'mail', lbtnCsb: 'book', lbtnKyuhokou: 'cal' };

  const clean = (s) => (s || '').replace(/[\s 　]+/g, ' ').trim();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const fmtSpan = (min) => (min >= 60 ? `${Math.floor(min / 60)}時間${min % 60 ? (min % 60) + '分' : ''}` : `${min}分`);

  // 出席パスワードの受付ルール(学生便覧 補足資料 2025年度): 開始〜3分=出席○、3〜15分=遅刻△、15分超=入力不可(欠席)
  const WIN_ON_TIME = 180;
  const WIN_LATE = 900;
  const fmtClock = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;

  // 授業開始からの経過秒で受付状態を返す。remain は次の境目までの秒数
  function attendWindow(lesson, now = new Date()) {
    const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const d = sec - lesson.start * 60;
    if (d < 0) return { phase: 'before', remain: -d };
    if (d < WIN_ON_TIME) return { phase: 'ok', remain: WIN_ON_TIME - d };
    if (d < WIN_LATE) return { phase: 'late', remain: WIN_LATE - d };
    return { phase: 'closed', remain: 0 };
  }
  function winText(w) {
    switch (w.phase) {
      case 'before': return `受付前 — 開始まで ${w.remain > 600 ? fmtSpan(Math.ceil(w.remain / 60)) : fmtClock(w.remain)}`;
      case 'ok': return `○ 出席で受付中 — 遅刻扱いまであと ${fmtClock(w.remain)}`;
      case 'late': return `△ 遅刻で受付中 — 締切まであと ${fmtClock(w.remain)}`;
      default: return '受付終了(15分経過・欠席扱い)— やむを得ず入力できなかった場合は、受付時間中に担当教員へ申し出てください';
    }
  }

  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const PERIOD_OF = { '09:10': 1, '11:00': 2, '13:40': 3, '15:30': 4, '17:20': 5 };

  // 'YYYY-MM-DD' → '09/29(火)'
  const dateLabelOf = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return `${pad(m)}/${pad(d)}(${DOW[new Date(y, m - 1, d).getDay()]})`;
  };

  // 授業名から安定した色相を決める(同じ授業は常に同じ色)
  const HUES = [232, 168, 336, 32, 268, 196, 8, 104];
  const hueOf = (name) => {
    let x = 0;
    for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return HUES[x % HUES.length];
  };

  // ---------- メモ(科目ごと + 日付ごと) ----------
  const notesStore = {
    all: () => store.get('notes', {}),
    get(name) {
      const n = this.all()[name];
      return { course: n?.course || '', sessions: n?.sessions || {} };
    },
    save(name, scope, dateKey, text) {
      const all = this.all();
      const n = { course: all[name]?.course || '', sessions: { ...(all[name]?.sessions || {}) }, updatedAt: Date.now() };
      if (scope === 'course') n.course = text;
      else if (text.trim()) n.sessions[dateKey] = text;
      else delete n.sessions[dateKey];
      const empty = !n.course.trim() && !Object.keys(n.sessions).length;
      if (empty) delete all[name];
      else all[name] = n;
      store.set('notes', all);
      notesSync.push(name, empty); // 空になったら「削除済み」の印を同期する
    },
    // カードに出す1行プレビュー(その日のメモ優先)
    preview(name, dateKey) {
      const n = this.get(name);
      const t = (dateKey && n.sessions[dateKey]) || n.course;
      return t ? t.split('\n')[0].slice(0, 80) : '';
    },
  };

  // ---------- 出欠表(修学ポートフォリオ > 出欠調査状況表) ----------
  // 授業ごとの行に「MM/DD + 記号」のマスが並ぶ(例: 06/12○)。授業の日付と照合して各授業の出欠を判定する。
  const ATT_URL = '/aa_web/rollManagement/rz0030.aspx?me=IC';
  const MARKS = {
    '○': { k: 'present', label: '出席', sym: '○' },
    '／': { k: 'absent', label: '欠席', sym: '／' },
    '△': { k: 'late', label: '遅刻', sym: '△' },
    '▽': { k: 'excused', label: '公欠', sym: '▽' },
    '-': { k: 'pending', label: '未調査', sym: '－' },
  };
  const markInfo = (raw) => {
    const m = (raw || '').replace('/', '／').replace(/[‐‑–—−ー－―]/g, '-').trim();
    return MARKS[m] || { k: 'other', label: m || '不明', sym: m || '?' };
  };
  const RECORDED = ['present', 'late', 'excused', 'absent']; // 出欠が確定した状態

  // 欠席の規定(学生便覧): 単位取得には全授業の3分の2以上の出席が必要。遅刻・公欠は出席数に数える。
  // 公欠が授業の3分の1以上になると単位認定試験を受験できない。
  // 授業ごとに全回数が違う(10回・15回・18回など)ので、科目ごとに設定できる。
  // 未設定の科目は「どの授業も最低5回はある」前提で、全回数を max(5, これまでの調査回数) と見積もる。
  // 実際の回数は見積もり以上なので、欠席の上限は実際より小さく見積もる(=必ず安全側)。ただし序盤の過剰警告を避けるため、
  // 未設定のときは「あと○回」を出さず、現在の欠席率で判定し、赤の断定表示(上限超過・受験不可)は設定済みの科目だけにする。
  const MIN_TOTAL = 5;
  const totalsStore = {
    all: () => store.get('totals', {}),
    keyOf: (c) => c.code || c.name,
    get(c) { const t = this.all(); return t[this.keyOf(c)] || t[c.name] || 0; },
    set(c, n) {
      const t = this.all();
      if (n > 0) t[this.keyOf(c)] = n; else delete t[this.keyOf(c)];
      store.set('totals', t);
      store.set('totalsAt', Date.now());
      notesSync.pushTotals();
    },
  };

  function attendanceRisk(course) {
    const kinds = course.sessions.map((s) => markInfo(s.mark).k);
    const count = (k) => kinds.filter((x) => x === k).length;
    const known = totalsStore.get(course);
    // 欠席は集計値(全回分)を優先。公欠・遅刻は見えているマスからの数(15回を超える授業では下限の値)
    const absent = Math.max(count('absent'), course.absent);
    const late = count('late');
    const excused = count('excused');
    const attended = Math.max(count('present') + late + excused, course.present);
    const surveyed = Math.max(course.surveyed, course.sessions.length);
    const total = known || Math.max(MIN_TOTAL, surveyed);
    const limit = Math.floor(total / 3); // 欠席の上限(15回なら5回)
    const need = Math.ceil((total * 2) / 3); // 必要な出席数(15回なら10回)
    const excusedLimit = Math.ceil(total / 3); // 公欠がこの回数に達すると受験不可
    const remaining = limit - absent;
    const base = { absent, late, excused, attended, limit, need, remaining, total, assumed: !known, surveyed };

    if (known) {
      let level = 'ok';
      let text = `欠席あと${remaining}回`;
      if (excused >= excusedLimit) { level = 'over'; text = '公欠が3分の1以上(単位認定試験を受験できません)'; }
      else if (remaining < 0) { level = 'over'; text = `欠席が上限を${-remaining}回超えています`; }
      else if (remaining === 0) { level = 'danger'; text = '欠席あと0回(これ以上欠席できません)'; }
      else if (remaining === 1) level = 'danger';
      else if (remaining === 2) level = 'warn';
      return { ...base, level, text };
    }

    // 未設定: 現在の欠席率で目安を出す(序盤の過剰警告を避けるため、「あと○回」は出さない)
    const pct = surveyed ? Math.round((absent / surveyed) * 100) : 0;
    let level = 'ok';
    let text = absent === 0 ? '欠席なし(目安)' : `欠席${absent}回・欠席率${pct}%(目安)`;
    if (excused > 0 && excused >= excusedLimit) { level = 'danger'; text = '公欠が多めです(目安)'; }
    else if (absent > 0 && remaining < 0) { level = 'danger'; text = `欠席率が高めです ${absent}/${surveyed}回(目安)`; }
    else if (absent > 0 && remaining === 0) { level = 'warn'; text = `欠席率が上限(1/3)に近いです ${absent}/${surveyed}回(目安)`; }
    return { ...base, level, text };
  }

  function parseAttendance(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.getElementById('ctl00_cphMain_gdvSyukketuJoukyou');
    if (!table) return null; // ログイン切れなどで表が無い
    const num = (s) => parseInt(s, 10) || 0;
    // ページ送りの実物(ダミー画像以外)があれば、マスが1ページ(15回)に収まっていない
    const pagerActive = [...doc.querySelectorAll('[id*="ctlSyukketuPager"]')].some((e) => !/Dumy$/.test(e.id));
    const courses = [...table.querySelectorAll('tr.serach_list')].map((tr) => {
      const c = tr.cells;
      const span = (id) => clean(tr.querySelector(`[id$="${id}"]`)?.textContent);
      const sessions = [...c].slice(6).map((td) => clean(td.textContent)).map((t) => {
        const m = t.match(/^(\d{1,2})\/(\d{1,2})\s*(.*)$/);
        return m ? { md: `${pad(m[1])}-${pad(m[2])}`, date: `${pad(m[1])}/${pad(m[2])}`, mark: m[3] } : null;
      }).filter(Boolean);
      const surveyed = num(span('lblCousakiKaisu'));
      return {
        code: clean(c[0]?.textContent), name: clean(c[2]?.textContent), teacher: clean(c[3]?.textContent),
        surveyed, present: num(span('lblSyussekiKaisu')), absent: num(span('lblKessekiKaisu')),
        rate: span('lblKessekiRitu'), sessions,
        // 集計(調査回数)より見えているマスが少ない = 15回を超えた分が別ページにあり、ここでは見えない
        partial: pagerActive || surveyed > sessions.length,
      };
    });
    return { term: clean(doc.getElementById('ctl00_cphMain_lbl2')?.textContent), courses };
  }

  // ポータルのセッションは、最後の通信から20分で切れる(修学ポートフォリオのカウントダウン「残り時間20分」で確認)。
  // トップページには残り時間の表示が無く、出席コードを入力する時に初めて切れていると気づく。
  const SESSION_MIN = 20;
  // buildUI() が実体を差し込む(出席送信からセッション状態を更新・確認するため)
  const sessionHooks = { touch: () => {}, check: async () => true };

  // 出席送信中は、ポータルの画面遷移状態を動かさないよう出欠表の取得を待たせる
  let attendBusy = 0;

  // 重要: ポータルはサーバー側で画面遷移を検証していて、出欠表(rz0030)を直接取得すると
  // 「画面遷移が不正です」エラーになりセッションが切れる。
  // そのため、メニュー「修学ポートフォリオ」への正規の遷移(トップのフォーム送信)を経由してから取得する。
  async function fetchAttendance() {
    // デモ用フック(通常の拡張機能ではページ側のグローバルは見えないので無効)
    const demo = globalThis.__AAUC2_DEMO__;
    if (demo?.attendanceHtml) return parseAttendance(demo.attendanceHtml());

    await waitFor(() => attendBusy === 0, 15000);
    const form = document.getElementById('form1');
    const menu = form?.querySelector('input[type="image"][alt="修学ポートフォリオ"]');
    if (!form || !menu) return null;

    const fd = new FormData(form);
    fd.set(`${menu.name}.x`, '5');
    fd.set(`${menu.name}.y`, '5');
    const step1 = await fetch(form.action, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!step1.ok || !step1.url.includes('/StudentCard/')) return null; // 想定外の遷移になったら中止

    const step2 = await fetch(ATT_URL, { credentials: 'same-origin' });
    if (!step2.ok || step2.url.includes('denshoError')) return null;
    return parseAttendance(await step2.text());
  }

  const findCourse = (data, { code, name }) => data?.courses.find((c) => (code && c.code === code) || c.name === name);

  // ---------- メモの同期(Chrome の chrome.storage.sync) ----------
  // 科目ごとに 1 アイテム('n:授業名')。新しい updatedAt が勝つ。削除は「deleted」の印を残して、オフラインだった端末で復活しないようにする。
  // Chrome にログインして同期をオンにしていれば別の PC とも共有される(そうでなければこの PC 内のみ)。
  const hasSync = typeof chrome !== 'undefined' && !!chrome.storage?.sync;
  const notesSync = {
    enabled: hasSync,
    lastAt: 0,
    onError: null,
    onRemoteChange: null,

    async push(name, tombstone = false) {
      if (!hasSync) return;
      const payload = tombstone ? { course: '', sessions: {}, updatedAt: Date.now(), deleted: true } : notesStore.all()[name];
      if (!payload) return;
      try {
        await chrome.storage.sync.set({ [`n:${name}`]: payload });
        this.lastAt = Date.now();
      } catch (e) {
        this.onError?.(e);
      }
    },

    // 科目ごとの全回数(小さいので1アイテムにまとめて、新しい方を採用)
    async pushTotals() {
      if (!hasSync) return;
      try {
        await chrome.storage.sync.set({ totals: { map: store.get('totals', {}), at: store.get('totalsAt', Date.now()) } });
      } catch (e) {
        this.onError?.(e);
      }
    },

    // 起動時: リモートとローカルを突き合わせる(新しい方を採用)
    async pull() {
      if (!hasSync) return false;
      try {
        const remote = await chrome.storage.sync.get(null);
        const local = notesStore.all();
        let changed = false;
        const seen = new Set();

        // 全回数
        const rt = remote.totals;
        const localAt = store.get('totalsAt', 0);
        if (rt && (rt.at || 0) > localAt) { store.set('totals', rt.map || {}); store.set('totalsAt', rt.at); changed = true; }
        else if (!rt && Object.keys(store.get('totals', {})).length) await this.pushTotals();
        else if (rt && localAt > (rt.at || 0)) await this.pushTotals();
        for (const [key, val] of Object.entries(remote)) {
          if (!key.startsWith('n:')) continue;
          const name = key.slice(2);
          seen.add(name);
          const l = local[name];
          const rt = val.updatedAt || 0;
          const lt = l?.updatedAt || 0;
          if (rt > lt) {
            if (val.deleted) { if (l) { delete local[name]; changed = true; } }
            else { local[name] = val; changed = true; }
          } else if (l && lt > rt) {
            await chrome.storage.sync.set({ [key]: l });
          }
        }
        for (const [name, l] of Object.entries(local)) {
          if (seen.has(name)) continue;
          l.updatedAt = l.updatedAt || Date.now();
          await chrome.storage.sync.set({ [`n:${name}`]: l });
          changed = true;
        }
        if (changed) store.set('notes', local);
        this.lastAt = Date.now();
        return changed;
      } catch (e) {
        this.onError?.(e);
        return false;
      }
    },

    // 他の PC で変更されたら反映
    listen() {
      if (!hasSync) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        const local = notesStore.all();
        let changed = false;
        for (const [key, { newValue }] of Object.entries(changes)) {
          if (key === 'totals' && newValue && (newValue.at || 0) > store.get('totalsAt', 0)) {
            store.set('totals', newValue.map || {});
            store.set('totalsAt', newValue.at);
            changed = true;
            continue;
          }
          if (!key.startsWith('n:')) continue;
          const name = key.slice(2);
          const lt = local[name]?.updatedAt || 0;
          if (!newValue || newValue.deleted) {
            if (local[name] && (!newValue || (newValue.updatedAt || 0) >= lt)) { delete local[name]; changed = true; }
          } else if ((newValue.updatedAt || 0) > lt) {
            local[name] = newValue;
            changed = true;
          }
        }
        if (changed) { store.set('notes', local); this.onRemoteChange?.(); }
      });
    },
  };

  // ---------- 時間割の .ics 書き出し(Google カレンダー / iPhone / Outlook などに取り込める) ----------
  const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // RFC 5545: 1行は 75 オクテットまで。文字を分断しないよう UTF-8 のバイト数で折り返す
  function icsFold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) { out.push(cur); cur = ` ${ch}`; bytes = 1 + b; }
      else { cur += ch; bytes += b; }
    }
    out.push(cur);
    return out.join('\r\n');
  }

  const icsStamp = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };

  // week: readWeek() の結果。weeks: この週から何週分か。時刻は日本時間(JST)として UTC に変換する
  function buildIcs(week, { weeks = 1, alarm = false } = {}) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AAUC2//Timetable//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:AAUC2 時間割', 'X-WR-TIMEZONE:Asia/Tokyo'];
    const stamp = icsStamp(Date.now());
    let count = 0;
    for (let w = 0; w < weeks; w++) {
      for (const day of week.days) {
        const [y, m, d] = day.key.split('-').map(Number);
        for (const l of day.lessons) {
          const startMs = Date.UTC(y, m - 1, d + w * 7, 0, l.start - 9 * 60);
          const endMs = startMs + (l.end - l.start) * 60000;
          const uid = `${day.key}-w${w}-${l.start}-${l.code || l.name}`.replace(/\s+/g, '_');
          lines.push('BEGIN:VEVENT', `UID:${icsEscape(uid)}@aauc2`, `DTSTAMP:${stamp}`,
            `DTSTART:${icsStamp(startMs)}`, `DTEND:${icsStamp(endMs)}`,
            `SUMMARY:${icsEscape(l.name)}`,
            `DESCRIPTION:${icsEscape([l.teacher, l.kind, l.code && `授業コード: ${l.code}`].filter(Boolean).join('\n'))}`);
          if (alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`${l.name} が始まります`)}`, 'TRIGGER:-PT10M', 'END:VALARM');
          lines.push('END:VEVENT');
          count++;
        }
      }
    }
    lines.push('END:VCALENDAR');
    return { text: lines.map(icsFold).join('\r\n') + '\r\n', count };
  }

  function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---------- ポータルのDOM読み取り ----------
  function readLesson(waku) {
    const time = clean(waku.querySelector('.wschedule')?.textContent);
    const m = time.match(/(\d{1,2}):(\d{2})\s*[～~〜-]\s*(\d{1,2}):(\d{2})/);
    if (!m) return null; // 時刻が無い枠は「予定(イベント)」として扱う

    // ポップアップ内の非省略テキスト: [区分, 授業名, 教員名]
    const full = [...waku.querySelectorAll('span.long_text')].map((s) => clean(s.textContent));
    const shown = [...waku.children].filter((c) => !c.id);
    const start = +m[1] * 60 + +m[2];
    const end = +m[3] * 60 + +m[4];
    const name = full[1] || clean(waku.querySelector('.wscheduleJugyou')?.textContent);
    // 「スレッド一覧」リンクの onclick に授業コードが入っている: '2026,2,ABCD123456,授業名'
    const linkArgs = [...waku.querySelectorAll('a[onclick]')].map((a) => a.getAttribute('onclick')).join(' ');
    const code = (linkArgs.match(/'\d{4},\d+,([A-Za-z0-9]+),/) || [])[1] || '';
    return {
      el: waku,
      code,
      start,
      end,
      startLabel: fmtMin(start),
      endLabel: fmtMin(end),
      kind: full[0] || clean(shown[1]?.textContent),
      name,
      teacher: full[2] || clean(shown[3]?.textContent),
      hue: hueOf(name),
      dateKey: '',
    };
  }

  function readWeek() {
    const tbl = document.getElementById('tabCalender_tabPanelWeek_tblWeek');
    if (!tbl || tbl.rows.length < 2) return null;

    const heads = [...tbl.rows[0].querySelectorAll('a.week_day')].map((a) => clean(a.textContent));
    if (heads.length !== 7) return null;
    const range = clean(document.getElementById('tabCalender_tabPanelWeek_lblWeek')?.textContent);

    // 週の開始年月から各日の完全な日付(年またぎ対応)を作る
    const ym = range.match(/(\d{4})\/(\d{1,2})/);
    const y0 = ym ? +ym[1] : new Date().getFullYear();
    const m0 = ym ? +ym[2] : 1;
    const days = heads.map((label, dow) => {
      const [mm, dd] = label.slice(0, 5).split('/').map(Number);
      return { label, date: label.slice(0, 5), key: `${y0 + (mm < m0 ? 1 : 0)}-${pad(mm)}-${pad(dd)}`, dow, lessons: [], events: [] };
    });

    [...tbl.rows[1].cells].forEach((td, i) => {
      const day = days[i];
      if (!day) return;
      td.querySelectorAll('.wscheduleWaku').forEach((waku) => {
        const lesson = readLesson(waku);
        if (lesson) { lesson.dateKey = day.key; day.lessons.push(lesson); }
        else {
          const title = clean(waku.title || waku.querySelector('.wscheduleJugyou')?.textContent);
          if (title) day.events.push(title);
        }
      });
      day.lessons.sort((a, b) => a.start - b.start);
    });

    return {
      days,
      intensive: [...tbl.querySelectorAll('.mscheduleetc')].map((e) => clean(e.textContent)).filter(Boolean),
      term: clean(document.getElementById('lblGakki')?.textContent),
      range,
    };
  }

  // 「お知らせ」等のリンク横の件数(取得できたときだけ)
  function readCounts() {
    const defs = [
      ['お知らせ', 'lbtnOshirase'],
      ['連絡事項', 'lbtnRenraku'],
      ['授業一覧', 'lbtnCsb'],
      ['休補講', 'lbtnKyuhokou'],
    ];
    return defs.map(([label, id]) => {
      const a = document.getElementById(id);
      let count = null;
      if (a?.parentElement) {
        const rest = clean(a.parentElement.textContent.replace(a.textContent, ''));
        if (/^\d+$/.test(rest)) count = +rest;
      }
      return { label, id, count, available: !!a };
    }).filter((d) => d.available);
  }

  function pageAction(id) {
    const el = document.getElementById(id);
    if (el) el.click();
  }

  // ---------- 出席登録 ----------
  const waitFor = (fn, timeout = 5000, step = 100) => new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(tick, step);
    };
    tick();
  });

  // ポータルの出席パスワード画面は、ページ内に最初から隠れているモーダル(#pnlPassword)。
  // 「出席」リンクの非同期ポストバックで表示され、#ibtnOK も非同期で送信される。
  // #txtPassword / #ibtnOK は常に存在するため、モーダルが実際に表示されるのを待つ必要がある。
  const isShown = (el) => !!el && getComputedStyle(el).display !== 'none';

  // 出席パスワード画面が開いていて、まだ送信前(入力待ち)か。
  // この間にバックグラウンドで画面遷移を動かすと、送信が「古い画面」扱いになる恐れがあるので、出欠表の取得を避ける。
  // 送信後の「登録完了」表示中は含めない。
  function attendModalPending() {
    const panel = document.getElementById('pnlPassword');
    if (!isShown(panel)) return false;
    if (/登録完了|完了しました/.test(clean(panel.textContent))) return false;
    return isShown(document.getElementById('txtPassword'));
  }

  async function submitAttendance(lesson, password, setState) {
    attendBusy++;
    try { await submitAttendanceInner(lesson, password, setState); } finally { attendBusy--; }
  }

  async function submitAttendanceInner(lesson, password, setState) {
    const link = [...lesson.el.querySelectorAll('a')].find((a) => a.textContent.includes('出席'));
    if (!link) return setState('unavailable', '出席リンクなし');

    setState('busy', '画面を開いています…');
    link.click();
    sessionHooks.touch(); // ポータルへ通信した(セッションが延びる)

    const modal = await waitFor(() => (isShown(document.getElementById('pnlPassword')) ? true : null), 8000);
    const input = document.getElementById('txtPassword');
    const ok = document.getElementById('ibtnOK');
    if (!modal || !input || !ok) {
      // 画面が開けない原因がログイン切れかもしれないので確認する
      const alive = await sessionHooks.check();
      return setState('error', alive === false ? 'ログインが切れています' : '出席画面が開けません');
    }

    input.value = password;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setState('busy', '送信中…');
    ok.click();
    sessionHooks.touch();

    // 結果: 大学の案内では、登録後は「登録完了」画面が表示される。
    // 「登録完了」の文言 → 成功 / #lblMessage にエラー文 → 失敗 / モーダルが閉じただけ → 出欠表で確認する
    const result = await waitFor(() => {
      const panel = document.getElementById('pnlPassword');
      const text = clean(panel?.textContent);
      if (/登録完了|完了しました/.test(text)) return { done: (text.match(/[^。]*(?:登録完了|完了しました)[^。]*/) || [text])[0].trim() };
      const msg = clean(document.getElementById('lblMessage')?.textContent);
      if (msg) return { error: msg };
      if (!isShown(panel)) return { closed: true };
      return null;
    }, 8000);
    if (!result) return setState('unknown', '結果不明(ポータルで確認)');
    if (result.error) return setState('error', result.error.slice(0, 40));
    if (result.done) return setState('done', '登録完了', result.done);
    setState('done', '送信しました(出欠表で確認中)');
  }

  // ---------- スタイル ----------
  const LIGHT = `
    --bg:#f3f4fb; --surface:#ffffff; --surface2:#eef0fa; --text:#171a2b; --muted:#6b7391; --line:#e3e6f3;
    --accent:#5b5bf0; --accent2:#9a5cf6; --ok:#12a37d; --warn:#dc8500; --danger:#e5484d; --cl:52%;
    --shadow:0 1px 2px rgba(20,24,60,.06), 0 10px 28px rgba(20,24,60,.07);
    --shadow-hover:0 2px 4px rgba(20,24,60,.08), 0 18px 38px rgba(20,24,60,.15);
    --glow1:rgba(91,91,240,.14); --glow2:rgba(154,92,246,.10);
    --hero-a:#5b5bf0; --hero-b:#9a5cf6;
  `;
  const DARK = `
    --bg:#0b0d1a; --surface:#14172e; --surface2:#1b1f3d; --text:#eceffc; --muted:#98a0c3; --line:#252a4d;
    --accent:#8b8bff; --accent2:#b18cff; --ok:#3ddbaa; --warn:#ffb547; --danger:#ff7a80; --cl:68%;
    --shadow:0 1px 2px rgba(0,0,0,.45), 0 12px 32px rgba(0,0,0,.4);
    --shadow-hover:0 2px 4px rgba(0,0,0,.5), 0 20px 44px rgba(0,0,0,.55);
    --glow1:rgba(110,110,255,.20); --glow2:rgba(170,110,255,.14);
    --hero-a:#3f3fc9; --hero-b:#7a3fd1;
  `;

  const CSS = `
    :host { all: initial; }
    .overlay, .launcher, .backdrop { ${LIGHT} font: 14px/1.55 "Yu Gothic UI","Hiragino Sans","Meiryo",system-ui,sans-serif; color: var(--text); }
    @media (prefers-color-scheme: dark) {
      .overlay[data-theme="auto"], .launcher[data-theme="auto"], .backdrop[data-theme="auto"] { ${DARK} }
    }
    .overlay[data-theme="dark"], .launcher[data-theme="dark"], .backdrop[data-theme="dark"] { ${DARK} }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:active { transform: scale(.96); }
    .ico { display: inline-flex; vertical-align: middle; }

    /* アニメーション */
    @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pop { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }
    @keyframes launcher-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
    .overlay:not([hidden]) { animation: fade .22s ease; }
    .launcher:not([hidden]) { animation: launcher-in .3s cubic-bezier(.2,.9,.3,1.3); }
    .hero, .stack > section, .stack > .weekbar, .stack > .scroller, .stack > .empty, .wrap > .empty { animation: rise .45s cubic-bezier(.2,.7,.2,1) backwards; }
    .tl-row, .cell, .ncard { animation: rise .5s cubic-bezier(.2,.7,.2,1) backwards; animation-delay: calc(var(--i, 0) * 55ms + 90ms); }

    .overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; overflow: hidden;
      background: radial-gradient(900px 420px at 8% -12%, var(--glow1), transparent 70%),
                  radial-gradient(800px 420px at 100% -8%, var(--glow2), transparent 70%), var(--bg); }
    .overlay[hidden] { display: none; }

    /* ヘッダー */
    header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 22px;
      background: color-mix(in srgb, var(--surface) 82%, transparent); backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--line); transition: background-color .3s, border-color .3s; }
    .logo { display: flex; align-items: center; gap: 10px; }
    .mark { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 13px; letter-spacing: -.02em;
      background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 45%, transparent); transition: transform .3s cubic-bezier(.2,.9,.3,1.4); }
    .logo:hover .mark { transform: rotate(-8deg) scale(1.08); }
    .brand b { display: block; font-size: 16px; font-weight: 800; line-height: 1.2; }
    .brand small { color: var(--muted); font-size: 11.5px; }
    .spacer { flex: 1; }
    nav.tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--surface2); }
    .tab { border: 0; background: transparent; padding: 6px 18px; border-radius: 9px; color: var(--muted); font-weight: 600; transition: background-color .2s, color .2s, box-shadow .2s, transform .1s; }
    .tab:hover { color: var(--text); }
    .tab[aria-selected="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,.14); }
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .pill { position: relative; display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); background: var(--surface);
      padding: 6px 12px; border-radius: 999px; color: var(--text); transition: transform .18s, border-color .18s, color .18s, background-color .3s, box-shadow .18s; }
    .pill:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-2px); box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 20%, transparent); }
    .pill:active { transform: scale(.95); }
    .pill.icon-only { padding: 7px; }
    .pill.icon-only:hover .ico { animation: wiggle .5s; }
    @keyframes wiggle { 30% { transform: rotate(-14deg); } 60% { transform: rotate(10deg); } 100% { transform: none; } }
    .badge { position: absolute; top: -5px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--danger); color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; }

    main { flex: 1; overflow: auto; padding: 22px; scroll-behavior: smooth; }
    .wrap { max-width: 1160px; margin: 0 auto; display: grid; gap: 20px; }
    .stack { display: grid; gap: 20px; min-width: 0; }

    /* ヒーロー */
    .hero { display: grid; grid-template-columns: auto 1fr; gap: 18px 36px; align-items: center; padding: 24px 28px; border-radius: 24px; color: #fff;
      background: linear-gradient(120deg, var(--hero-a), var(--hero-b)); box-shadow: 0 16px 40px color-mix(in srgb, var(--hero-a) 38%, transparent); position: relative; overflow: hidden; }
    .hero::after { content: ""; position: absolute; width: 340px; height: 340px; right: -90px; top: -140px; border-radius: 50%; background: rgba(255,255,255,.09); pointer-events: none; animation: float 9s ease-in-out infinite; }
    @keyframes float { 50% { transform: translate(-24px, 18px) scale(1.08); } }
    .hero-date .md { font-size: 15px; font-weight: 700; opacity: .9; }
    .hero-date .clock { font-size: 46px; font-weight: 800; line-height: 1.05; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .hero-main { position: relative; z-index: 1; min-width: 0; }
    .hero-label { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 800; letter-spacing: .12em; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.2); }
    .hero-label .dot { width: 7px; height: 7px; border-radius: 50%; background: #fff; }
    .hero-label[data-mode="now"] .dot { animation: pulse 1.6s infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.7); } 100% { box-shadow: 0 0 0 9px rgba(255,255,255,0); } }
    .hero-title { font-size: 24px; font-weight: 800; line-height: 1.3; margin: 8px 0 2px; overflow-wrap: anywhere; }
    .hero-sub { opacity: .88; }
    .progress { height: 8px; margin-top: 12px; border-radius: 99px; background: rgba(255,255,255,.25); overflow: hidden; }
    .progress > i { display: block; height: 100%; border-radius: inherit; background: #fff; transition: width .6s; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .stat { font-size: 12px; padding: 3px 11px; border-radius: 999px; background: rgba(255,255,255,.16); }

    h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13px; color: var(--muted); letter-spacing: .1em; font-weight: 800; }
    h2::after { content: ""; flex: 1; height: 1px; background: var(--line); }

    /* タイムライン */
    .timeline { display: grid; gap: 4px; }
    .tl-row { display: grid; grid-template-columns: 62px 1fr; gap: 14px; }
    .tl-time { padding-top: 14px; text-align: right; font-variant-numeric: tabular-nums; line-height: 1.2; }
    .tl-time b { display: block; font-size: 16px; }
    .tl-time span { font-size: 12px; color: var(--muted); }
    .gap { margin: 2px 0 2px 76px; padding: 2px 12px; font-size: 12px; color: var(--muted); border-left: 2px dashed var(--line); }

    .lcard { --c: hsl(var(--h) 74% var(--cl)); --cs: hsl(var(--h) 85% 60% / .13);
      position: relative; overflow: hidden; padding: 14px 16px 14px 20px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line);
      box-shadow: var(--shadow); transition: transform .2s cubic-bezier(.2,.8,.3,1), box-shadow .2s, background-color .3s, border-color .3s, opacity .3s; }
    .lcard::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--c); transition: width .2s; }
    .lcard:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }
    .lcard:hover::before { width: 9px; }
    .lcard[data-status="now"] { background: linear-gradient(var(--cs), var(--cs)), var(--surface); box-shadow: 0 0 0 2px var(--c), var(--shadow); }
    .lcard[data-status="now"]:hover { box-shadow: 0 0 0 2px var(--c), var(--shadow-hover); }
    .lcard[data-status="next"] { background: linear-gradient(var(--cs), var(--cs)), var(--surface); }
    .lcard[data-status="done"] { opacity: .5; }
    .lcard[data-status="done"]:hover { opacity: .85; }
    .lhead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
    .name { font-size: 17px; font-weight: 800; line-height: 1.35; overflow-wrap: anywhere; }
    .meta { display: flex; flex-wrap: wrap; gap: 2px 14px; margin-top: 2px; color: var(--muted); font-size: 13px; }
    .meta span { display: inline-flex; align-items: center; gap: 4px; }
    .chip { font-size: 11px; font-weight: 800; padding: 1px 9px; border-radius: 999px; background: var(--surface2); color: var(--muted); }
    .chip:empty { display: none; }
    .chip[data-s="now"] { background: var(--c); color: #fff; }
    .chip[data-s="next"] { background: var(--warn); color: #fff; }
    .lbar { height: 5px; margin-top: 10px; border-radius: 99px; background: var(--surface2); overflow: hidden; display: none; }
    .lcard[data-status="now"] .lbar { display: block; }
    .lbar > i { display: block; height: 100%; background: var(--c); border-radius: inherit; transition: width .6s; }

    .memo-btn { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; border: 1px solid var(--line); background: var(--surface); padding: 3px 11px; border-radius: 999px;
      font-size: 12px; color: var(--muted); transition: border-color .15s, color .15s, transform .15s, background-color .3s; }
    .memo-btn:hover { border-color: var(--c); color: var(--c); transform: translateY(-1px); }
    .notepreview { display: flex; gap: 6px; align-items: flex-start; margin-top: 9px; padding: 7px 11px; border-radius: 10px; background: var(--cs); font-size: 13px; overflow-wrap: anywhere; }
    .notepreview .ico { color: var(--c); margin-top: 2px; flex: none; }
    .notepreview[hidden] { display: none; }

    .attend { display: flex; gap: 8px; margin-top: 12px; }
    .lcard[data-status="done"] .attend { display: none; }
    .attend input { flex: 1; min-width: 0; max-width: 240px; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; transition: border-color .15s, box-shadow .15s, background-color .3s; }
    .attend input:focus { outline: none; border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent); background: var(--surface); }
    .attend button { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 8px 18px; background: var(--c); color: #fff; font-weight: 800; transition: filter .15s, transform .15s, background-color .25s; }
    .attend button:hover { filter: brightness(1.1); transform: translateY(-2px); }
    .attend button:active { transform: scale(.95); }
    .attend button[data-state="busy"] { opacity: .65; pointer-events: none; }
    .attend button[data-state="done"] { background: var(--ok); animation: pop .35s; }
    .attend button[data-state="error"], .attend button[data-state="unavailable"], .attend button[data-state="empty"] { background: var(--danger); animation: shake .4s; }
    .attend button[data-state="unknown"] { background: var(--warn); }
    @keyframes shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }

    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .tag { display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px; border-radius: 999px; background: var(--surface); border: 1px solid var(--line); font-size: 13px; transition: transform .15s, border-color .15s, background-color .3s; }
    .tag:hover { transform: translateY(-1px); border-color: var(--accent); }
    .empty { padding: 30px; text-align: center; color: var(--muted); background: var(--surface); border: 1px dashed var(--line); border-radius: 16px; }

    /* 週間 */
    .weekbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .weekbar .range { font-weight: 800; font-size: 16px; }
    .hint { color: var(--muted); font-size: 12px; margin-top: -8px; }
    .scroller { overflow-x: auto; padding-bottom: 6px; }
    .grid { display: grid; gap: 8px; min-width: 780px; }
    .colhead { padding: 10px 6px; text-align: center; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); font-weight: 800; transition: background-color .3s, border-color .3s; }
    .colhead small { display: block; color: var(--muted); font-weight: 600; }
    .colhead.today { background: linear-gradient(135deg, var(--hero-a), var(--hero-b)); border-color: transparent; color: #fff; box-shadow: 0 8px 20px color-mix(in srgb, var(--hero-a) 35%, transparent); }
    .colhead.today small { color: rgba(255,255,255,.85); }
    .colhead.sun { color: var(--danger); }
    .colhead.sat { color: var(--accent); }
    .colhead.today.sun, .colhead.today.sat { color: #fff; }
    .evrow { display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
    .evrow .tag { padding: 2px 9px; font-size: 11.5px; }
    .rowhead { padding-top: 10px; text-align: right; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; line-height: 1.3; }
    .rowhead b { display: block; color: var(--text); font-size: 15px; }
    .cell { min-height: 84px; border-radius: 14px; }
    .cell.today-col { background: color-mix(in srgb, var(--accent) 7%, transparent); }
    .cell.blank { border: 1px dashed var(--line); opacity: .55; }
    .cell .lcard { height: 100%; padding: 9px 10px 9px 15px; border-radius: 13px; cursor: pointer; }
    .cell .lcard::before { width: 5px; }
    .cell .lcard:focus-visible { outline: 2px solid var(--c); outline-offset: 2px; }
    .cell .name { font-size: 13px; line-height: 1.35; }
    .cell .wtime { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .cell .wteacher { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .cell .abadge { margin-top: 6px; }
    .cell .lcard .chip { font-size: 10px; padding: 0 7px; }
    .wnote { color: var(--c); }
    .wnote[hidden] { display: none; }

    /* メモ一覧 */
    .ncard { margin-bottom: 0; }
    .ntext { white-space: pre-wrap; margin-top: 8px; overflow-wrap: anywhere; }
    .nsess { display: grid; grid-template-columns: 82px 1fr; gap: 8px; margin-top: 8px; font-size: 13px; }
    .nsess .nd { color: var(--muted); font-variant-numeric: tabular-nums; }
    .nsess .nt { white-space: pre-wrap; overflow-wrap: anywhere; }

    /* 出欠 */
    .abadge { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 800; padding: 1px 10px; border-radius: 999px;
      background: var(--surface2); color: var(--muted); border: 1px solid transparent; white-space: nowrap; }
    .abadge[hidden], .meta .attsum[hidden] { display: none; }
    .abadge[data-k="present"] { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
    .abadge[data-k="absent"] { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
    .abadge[data-k="late"] { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
    .abadge[data-k="excused"] { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
    .abadge[data-k="none"], .abadge[data-k="pending"] { background: transparent; border: 1px dashed var(--muted); }
    .abadge.mini { padding: 0 7px; font-size: 11px; }
    .abadge.pop { animation: pop .4s cubic-bezier(.2,.9,.3,1.4); }
    .attsum { color: var(--muted); }
    .strip { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .sess { display: inline-flex; flex-direction: column; align-items: center; min-width: 48px; padding: 3px 7px; border-radius: 10px; background: var(--surface2);
      font-variant-numeric: tabular-nums; line-height: 1.25; transition: transform .15s; }
    .sess:hover { transform: translateY(-2px); }
    .sess small { font-size: 10.5px; color: var(--muted); }
    .sess b { font-size: 15px; }
    .sess[data-k="present"] b { color: var(--ok); }
    .sess[data-k="absent"] b { color: var(--danger); }
    .sess[data-k="late"] b { color: var(--warn); }
    .sess[data-k="excused"] b { color: var(--accent); }
    .sess.cur { outline: 2px solid var(--accent); outline-offset: 1px; }
    .attnote { margin-top: 8px; font-size: 12.5px; color: var(--muted); }
    .attnote[hidden] { display: none; }
    .attnote[data-k="present"], .attnote[data-k="excused"] { color: var(--ok); font-weight: 700; }
    .attnote[data-k="absent"] { color: var(--danger); font-weight: 700; }
    .attnote[data-k="late"] { color: var(--warn); font-weight: 700; }
    .spin .ico { animation: spin .9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ログイン(セッション)の期限 */
    .pill.sess[data-level="warn"] { border-color: var(--warn); color: var(--warn); }
    .pill.sess[data-level="expired"] { border-color: var(--danger); color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--surface)); }
    .sessbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 22px; font-weight: 700;
      background: color-mix(in srgb, var(--warn) 18%, var(--surface)); color: var(--warn); border-bottom: 1px solid color-mix(in srgb, var(--warn) 40%, transparent); animation: rise .3s ease; }
    .sessbar[data-level="expired"] { background: color-mix(in srgb, var(--danger) 16%, var(--surface)); color: var(--danger); border-bottom-color: color-mix(in srgb, var(--danger) 45%, transparent); }
    .sessbar[hidden] { display: none; }
    .sessbar .msg { flex: 1; min-width: 200px; }
    .sessbar .go { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 6px 16px; background: var(--warn); color: #fff; font-weight: 800; transition: filter .15s, transform .15s; }
    .sessbar[data-level="expired"] .go { background: var(--danger); }
    .sessbar .go:hover { filter: brightness(1.1); transform: translateY(-1px); }

    /* 欠席の警告 */
    .risk { display: inline-flex; align-items: center; font-size: 12px; font-weight: 800; padding: 1px 10px; border-radius: 999px; background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
    .risk[hidden], .meta .risk[hidden] { display: none; }
    .risk[data-level="warn"] { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
    .risk[data-level="danger"] { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
    .risk[data-level="over"] { background: var(--danger); color: #fff; }
    .risk.mini { font-size: 11px; padding: 0 7px; margin-top: 6px; }
    .cell .risk.mini { display: inline-flex; margin-left: 4px; }
    .tag.risk { padding: 5px 13px; font-size: 13px; }
    .lhead .risk { margin-left: 2px; }
    .total-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 10px; }
    .total-row label { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
    .total-row input { width: 68px; padding: 4px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; text-align: center; transition: border-color .15s, box-shadow .15s; }
    .total-row input.assumed { border-style: dashed; border-color: var(--warn); }
    .total-row input:focus { outline: none; border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent); }
    .total-row .muted { margin: 0; }
    .meter { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12.5px; color: var(--muted); }
    .meter-bar { flex: 1; max-width: 240px; height: 7px; border-radius: 99px; background: var(--surface2); overflow: hidden; }
    .meter-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--ok); transition: width .6s; }
    .meter-bar > i[data-level="warn"] { background: var(--warn); }
    .meter-bar > i[data-level="danger"], .meter-bar > i[data-level="over"] { background: var(--danger); }

    /* 出席受付の状態 */
    .awin { margin-top: 12px; padding: 7px 14px; border-radius: 12px; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
      background: var(--surface2); color: var(--muted); transition: background-color .3s, color .3s; }
    .awin[hidden] { display: none; }
    .awin[data-phase="ok"] { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
    .awin[data-phase="late"] { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
    .awin[data-phase="closed"] { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); }
    .awin + .attend { margin-top: 8px; }
    .attend button.chk { background: transparent; color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); padding: 7px 14px; font-weight: 700; }
    .attend button.chk:hover { background: color-mix(in srgb, var(--c) 12%, transparent); filter: none; }
    .attend { flex-wrap: wrap; }
    .lcard[data-status="done"] .awin { display: none; }
    .hero-win { display: inline-block; margin-top: 10px; padding: 5px 14px; border-radius: 12px; font-weight: 800; font-variant-numeric: tabular-nums; background: rgba(255,255,255,.2); }
    .hero-win[data-phase="ok"] { background: #12a37d; box-shadow: 0 4px 14px rgba(18,163,125,.5); }
    .hero-win[data-phase="late"] { background: #dc8500; box-shadow: 0 4px 14px rgba(220,133,0,.5); }
    .hero-win[data-phase="closed"] { background: #d63c3c; }
    .pill[data-on="true"] { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--surface)); }
    .toast { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 5; max-width: calc(100% - 32px); padding: 9px 18px; border-radius: 999px;
      background: var(--text); color: var(--bg); font-size: 13px; font-weight: 700; box-shadow: var(--shadow-hover); animation: toast-in .3s cubic-bezier(.2,.9,.3,1.2); }
    @keyframes toast-in { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }

    /* 詳細ダイアログ */
    .backdrop { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 16px; background: rgba(8,10,25,.5); backdrop-filter: blur(6px); animation: fade .18s ease; }
    .modal { --c: hsl(var(--h) 74% var(--cl)); width: min(580px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: var(--surface); border: 1px solid var(--line);
      border-top: 5px solid var(--c); border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.4); padding: 20px 22px; animation: pop .3s cubic-bezier(.2,.8,.2,1); }
    .mhead { display: flex; align-items: flex-start; gap: 12px; }
    .mtitle { flex: 1; min-width: 0; }
    .mtitle b { display: block; font-size: 19px; line-height: 1.35; overflow-wrap: anywhere; }
    .mtitle small { color: var(--muted); }
    .modal h3 { margin: 18px 0 8px; font-size: 12px; letter-spacing: .1em; color: var(--muted); font-weight: 800; }
    .modal textarea { width: 100%; min-height: 92px; resize: vertical; padding: 10px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; line-height: 1.55; transition: border-color .15s, box-shadow .15s, background-color .3s; }
    .modal textarea:focus { outline: none; border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent); background: var(--surface); }
    .muted { margin: 0; color: var(--muted); }
    .muted.small { font-size: 12.5px; margin-top: 12px; }
    .pill.export { margin-left: auto; }
    .modal .row2 { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 10px; }
    .modal input[type="number"] { width: 84px; padding: 7px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; }
    .modal input[type="number"]:focus { outline: none; border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent); }
    .modal label { cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .modal .go { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 9px 22px; background: var(--c); color: #fff; font-weight: 800; transition: filter .15s, transform .15s; }
    .modal .go:hover { filter: brightness(1.1); transform: translateY(-2px); }
    .mfoot { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; color: var(--muted); font-size: 12px; }
    .saved { color: var(--ok); font-weight: 700; }

    .launcher { position: fixed; right: 22px; bottom: 22px; z-index: 2147482999; display: inline-flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 12px 20px;
      background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; font-weight: 800; letter-spacing: .03em;
      box-shadow: 0 10px 28px color-mix(in srgb, var(--accent) 50%, transparent); transition: transform .2s, box-shadow .2s; }
    .launcher:hover { transform: translateY(-3px) scale(1.03); box-shadow: 0 16px 34px color-mix(in srgb, var(--accent) 55%, transparent); }
    .launcher[hidden] { display: none; }

    @media (max-width: 720px) {
      header { padding: 10px 12px; }
      main { padding: 12px; }
      .hero { grid-template-columns: 1fr; padding: 18px; }
      .hero-date { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
      .hero-date .clock { font-size: 34px; }
      .hero-title { font-size: 20px; }
      .tl-row { grid-template-columns: 48px 1fr; gap: 8px; }
      .gap { margin-left: 56px; }
      .pill .lbl { display: none; }
      .modal { padding: 16px; }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  `;

  const THEME_ORDER = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: '自動(OS設定に合わせる)', light: 'ライト', dark: 'ダーク' };
  const THEME_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

  function buildUI() {
    const host = h('div', { id: ROOT_ID });
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(h('style', {}, CSS));
    document.documentElement.append(host);

    const state = {
      week: null,
      view: ['today', 'week', 'att', 'notes'].includes(store.get('view', 'today')) ? store.get('view', 'today') : 'today',
      open: store.get('open', true),
      theme: THEME_ORDER.includes(store.get('theme', 'auto')) ? store.get('theme', 'auto') : 'auto',
      cards: [], // {lesson, card, chip, bar, paint, paintAtt}
      dialog: null, // {el, persist, repaintAtt}
      att: { data: null, status: 'idle', at: 0 }, // 出欠表(修学ポートフォリオ)
      hero: null,
      refreshBtn: null,
      sessChip: null, // ヘッダーの「ログイン 残り○分」
      sessBar: h('div', { class: 'sessbar', hidden: true, role: 'alert' }), // 切れそう/切れたときの警告バナー
      extras: [], // 出欠データ更新時に描き直す部品(欠席の警告など)
      wins: new Set(), // 出席受付の状態表示 {el, paint}
      notify: store.get('notify', false) === true,
      submitted: new Set(), // このページから出席送信した授業(通知を止める)
    };

    // ログイン(セッション)の状態。最後にポータルと通信した時刻から20分で切れる
    const sess = { last: Date.now(), expired: false, checking: false, lastTry: 0, checked: new Set() };

    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-label': 'AAUC2 時間割' });
    const launcher = h('button', { class: 'launcher', title: 'AAUC2 を開く (Alt+A)' }, icon('cal', 18), 'AAUC2');
    shadow.append(overlay, launcher);

    const applyTheme = () => {
      for (const el of [overlay, launcher, state.dialog?.el]) if (el) el.dataset.theme = state.theme;
    };
    applyTheme();

    const setOpen = (open) => {
      state.open = open;
      store.set('open', open);
      overlay.hidden = !open;
      launcher.hidden = open;
      document.documentElement.style.overflow = open ? 'hidden' : '';
      if (!open) closeDialog();
    };
    launcher.addEventListener('click', () => setOpen(true));
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); setOpen(!state.open); }
      else if (e.key === 'Escape' && state.dialog) closeDialog();
      else if (e.key === 'Escape' && state.open) setOpen(false);
    });

    function todayInfo(week) {
      const now = new Date();
      const key = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
      return { now, nowMin: now.getHours() * 60 + now.getMinutes(), day: week.days.find((d) => d.date === key) || null };
    }
    const isTodayLesson = (lesson) => {
      if (!state.week) return false;
      const { day } = todayInfo(state.week);
      return !!day && day.lessons.includes(lesson);
    };

    const statusOf = (lesson, nowMin) => (nowMin >= lesson.end ? 'done' : nowMin >= lesson.start ? 'now' : 'later');
    const hueStyle = (lesson) => `--h:${lesson.hue}`;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const todayKey = () => {
      const n = new Date();
      return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
    };

    // ---- 出欠表の取得と照合 ----
    let attPromise = null;
    function loadAttendance(force = false) {
      if (attPromise) return attPromise;
      if (!force && state.att.status === 'ok' && Date.now() - state.att.at < 30000) return Promise.resolve();
      state.att.status = 'loading';
      refreshAtt();
      attPromise = fetchAttendance()
        .then((data) => {
          state.att = data ? { data, status: 'ok', at: Date.now() } : { ...state.att, status: 'error', at: Date.now() };
          if (data) touchSession(); // 出欠表の取得もポータルへの通信なので、セッションが延びる
        })
        .catch(() => { state.att = { ...state.att, status: 'error', at: Date.now() }; })
        .finally(() => { attPromise = null; refreshAtt(); });
      return attPromise;
    }

    function refreshAtt() {
      for (const c of state.cards) c.paintAtt?.();
      for (const paint of state.extras) paint();
      state.hero?.update();
      state.dialog?.repaintAtt?.();
      refreshAttButton();
      if (state.view === 'att' && state.att.status !== 'loading') render();
    }

    // 同じ日に同じ授業が複数コマあるとき、何番目か
    const lessonNth = (lesson) => {
      const day = state.week?.days.find((d) => d.key === lesson.dateKey);
      return day ? Math.max(0, day.lessons.filter((l) => l.name === lesson.name).indexOf(lesson)) : 0;
    };

    const lessonKey = (l) => `${l.dateKey}|${l.start}|${l.name}`;
    const isRecorded = (lesson) => {
      const s = attInfo(lesson)?.session;
      return !!s && RECORDED.includes(markInfo(s.mark).k);
    };

    // 授業1コマ分の出欠表の記録: {course, session|null}
    function attInfo(lesson) {
      const course = findCourse(state.att.data, lesson);
      if (!course) return null;
      const hits = course.sessions.filter((s) => s.md === lesson.dateKey.slice(5));
      const session = hits.length ? hits[Math.min(lessonNth(lesson), hits.length - 1)] : null;
      return { course, session };
    }

    // バッジ表示用: 開始済みの授業だけ「記録なし/未反映」を出す
    function badgeOf(lesson) {
      const info = attInfo(lesson);
      if (!info) return null;
      if (info.session) return markInfo(info.session.mark);
      // 15回を超えた分のマスは別ページにあって見えない授業は、「未反映」と誤表示しない
      if (info.course.partial) return null;
      const { nowMin } = todayInfo(state.week);
      const today = todayKey();
      const started = lesson.dateKey < today || (lesson.dateKey === today && nowMin >= lesson.start);
      if (!started) return null;
      return { k: 'none', sym: '…', label: lesson.dateKey === today ? '未反映' : '記録なし' };
    }

    const sessionStrip = (course, curMd) => h('div', { class: 'strip' },
      course.sessions.length
        ? course.sessions.map((s) => {
          const m = markInfo(s.mark);
          return h('span', { class: `sess${s.md === curMd ? ' cur' : ''}`, 'data-k': m.k, title: `${s.date} ${m.label}` }, h('small', {}, s.date), h('b', {}, m.sym));
        })
        : h('span', { class: 'muted' }, 'まだ記録がありません'));

    // ---- 出席フォーム ----
    function attendForm(lesson) {
      const input = h('input', { type: 'text', placeholder: '出席パスワード', autocomplete: 'off', 'aria-label': `${lesson.name} の出席パスワード` });
      const btn = h('button', { type: 'button' }, icon('check', 15), h('span', { class: 'txt' }, '出席'));
      const note = h('div', { class: 'attnote', hidden: true });
      let baseCounts = null; // 送信前の集計(調査/出席回数)。マスが見えない授業は、この増加で反映を判定する
      const pmsg = h('div', { class: 'attnote', 'data-k': 'present', hidden: true });

      // 受付状態(出席/遅刻/締切)のカウントダウン。ボタンは常に押せる(ルールが授業ごとに違っても入力できるように)
      const win = h('div', { class: 'awin', hidden: true }, h('span', { class: 'txt' }));
      const paintWin = () => {
        const w = attendWindow(lesson);
        const hide = isRecorded(lesson) || state.submitted.has(lessonKey(lesson))
          || (w.phase === 'before' && w.remain > 1800)
          || (w.phase === 'closed' && !state.att.data);
        win.hidden = hide;
        if (hide) return;
        win.dataset.phase = w.phase;
        win.querySelector('.txt').textContent = winText(w);
      };
      paintWin();
      state.wins.add({ el: win, paint: paintWin });

      // 送信後、出欠表(修学ポートフォリオ)に反映されるまで数秒おきに確認する
      const watch = async () => {
        note.hidden = false;
        note.dataset.k = '';
        note.textContent = '出欠表への反映を確認中…';
        for (let i = 0; i < 8; i++) {
          await sleep(i === 0 ? 1500 : 4000);
          await loadAttendance(true);
          const b = badgeOf(lesson);
          if (b && RECORDED.includes(b.k)) {
            note.dataset.k = b.k;
            note.textContent = `出欠表に反映されました: ${b.sym} ${b.label}`;
            return;
          }
          // マスが見えない授業(15回超)は、集計の調査回数が増えたかで判定する
          const c = attInfo(lesson)?.course;
          if (c?.partial && baseCounts && c.surveyed > baseCounts.surveyed) {
            note.dataset.k = c.present > baseCounts.present ? 'present' : '';
            note.textContent = `出欠表の集計に反映されました(調査 ${baseCounts.surveyed}→${c.surveyed}回 / 出席 ${baseCounts.present}→${c.present}回)`;
            return;
          }
        }
        note.textContent = state.att.status === 'error'
          ? '出欠表を取得できませんでした。ポータルで確認してください。'
          : 'まだ反映されていません。少し待って、右上の「出欠更新」で再確認してください。';
      };

      // 「出欠を確認」: 受付時間帯は自動取得を止めているので、送信できたかをいつでも手動で確かめられるようにする
      const chk = h('button', { class: 'chk', type: 'button', title: '出欠表で、この授業の出席が記録されたか確認します' }, icon('refresh', 15), h('span', { class: 'txt' }, '出欠を確認'));
      const showNote = (text, k = '') => { note.hidden = false; note.dataset.k = k; note.textContent = text; };
      chk.addEventListener('click', async () => {
        if (attendModalPending()) return showNote('出席パスワード画面が開いています。送信するか閉じてから確認してください。');
        chk.classList.add('spin');
        showNote('出欠表を確認中…');
        await loadAttendance(true);
        chk.classList.remove('spin');
        const b = badgeOf(lesson);
        if (b && RECORDED.includes(b.k)) showNote(`出欠表: ${b.sym} ${b.label} で記録されています`, b.k);
        else if (state.att.status === 'error') showNote('出欠表を取得できませんでした。ポータルで確認してください。');
        else showNote('出欠表にはまだ記録されていません。送信済みなら、少し待ってからもう一度確認してください。');
      });

      const setState = (s, text, portalMsg) => {
        btn.dataset.state = s;
        btn.querySelector('.txt').textContent = text;
        // ポータル自身の「登録完了」画面は AAUC2 の下に隠れるので、その文言をここにも表示する
        if (portalMsg) { pmsg.hidden = false; pmsg.textContent = `ポータルの表示: ${portalMsg}`; }
        if (s === 'done' || s === 'unknown') { if (s === 'done') state.submitted.add(lessonKey(lesson)); paintWin(); watch(); }
        if (['empty', 'error', 'unavailable', 'unknown'].includes(s)) {
          setTimeout(() => { delete btn.dataset.state; btn.querySelector('.txt').textContent = '出席'; }, 4000);
        }
      };
      const go = () => {
        const pw = input.value.trim();
        if (!pw) return setState('empty', 'パスワードを入力');
        baseCounts = attInfo(lesson)?.course ? { surveyed: attInfo(lesson).course.surveyed, present: attInfo(lesson).course.present } : null;
        submitAttendance(lesson, pw, setState);
      };
      btn.addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      return h('div', { class: 'attendwrap' }, win, h('div', { class: 'attend' }, input, btn, chk), pmsg, note);
    }

    // ---- 詳細ダイアログ(出席 + メモ) ----
    function closeDialog() {
      if (!state.dialog) return;
      state.dialog.persist();
      state.dialog.el.remove();
      state.dialog = null;
      refreshNotes();
    }

    // ctx: {name, hue, teacher, kind, time, dateKey, lesson|null, canAttend}
    function openDialog(ctx) {
      closeDialog();
      const saved = h('span', { class: 'saved' });
      let timer = null;
      let courseTa = null;
      let sessionTa = null;

      const persist = () => {
        clearTimeout(timer);
        notesStore.save(ctx.name, 'course', '', courseTa.value);
        if (sessionTa) notesStore.save(ctx.name, 'session', ctx.dateKey, sessionTa.value);
      };
      const onInput = () => {
        saved.textContent = '入力中…';
        clearTimeout(timer);
        timer = setTimeout(() => { persist(); saved.textContent = '保存しました'; refreshNotes(); }, 400);
      };
      const area = (value, placeholder, label) => {
        const ta = h('textarea', { placeholder, 'aria-label': label });
        ta.value = value;
        ta.addEventListener('input', onInput);
        return ta;
      };

      const n = notesStore.get(ctx.name);
      courseTa = area(n.course, '科目全体のメモ(課題・持ち物・試験範囲など)', `${ctx.name} の科目メモ`);
      if (ctx.dateKey) sessionTa = area(n.sessions[ctx.dateKey] || '', 'この回のメモ(配布資料・宿題・気づきなど)', `${ctx.name} の${ctx.dateKey}のメモ`);

      const dateLabel = ctx.dateKey ? dateLabelOf(ctx.dateKey) : '';

      // 出欠状況(出欠表から取得済みのデータで描画。更新されたら描き直す)
      const attWrap = h('div');
      const repaintAtt = () => {
        const course = findCourse(state.att.data, ctx);
        attWrap.replaceChildren(
          h('h3', {}, '出欠状況(修学ポートフォリオ)'),
          course
            ? h('div', {},
              h('div', { class: 'meta' },
                h('span', {}, `出席 ${course.present} / 調査 ${course.surveyed}回`),
                h('span', {}, `欠席 ${course.absent}`),
                h('span', {}, `欠席率 ${course.rate || '0%'}`)),
              sessionStrip(course, ctx.dateKey ? ctx.dateKey.slice(5) : ''))
            : h('p', { class: 'muted' }, state.att.status === 'loading' ? '読み込み中…' : '出欠表に該当する授業が見つかりません。'),
        );
      };

      const backdrop = h('div', { class: 'backdrop' },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${ctx.name} の詳細`, style: `--h:${ctx.hue}` },
          h('div', { class: 'mhead' },
            h('div', { class: 'mtitle' },
              h('b', {}, ctx.name),
              h('small', {}, [dateLabel, ctx.time, ctx.teacher, ctx.kind].filter(Boolean).join(' · ')),
            ),
            h('button', { class: 'pill icon-only', type: 'button', title: '閉じる (Esc)', onclick: closeDialog }, icon('x', 17)),
          ),
          ctx.lesson && h('div', {},
            h('h3', {}, '出席登録'),
            ctx.canAttend ? attendForm(ctx.lesson) : h('p', { class: 'muted' }, '出席登録は授業当日のみ行えます。'),
          ),
          attWrap,
          sessionTa && h('div', {}, h('h3', {}, `この回のメモ (${dateLabel})`), sessionTa),
          h('div', {}, h('h3', {}, '科目メモ(全回共通)'), courseTa),
          h('div', { class: 'mfoot' }, saved, h('span', {}, notesSync.enabled ? '自動保存(Chrome の同期で他の PC とも共有)' : '自動保存(このブラウザ内)')),
        ),
      );
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeDialog(); });
      shadow.append(backdrop);
      state.dialog = { el: backdrop, persist, repaintAtt };
      repaintAtt();
      applyTheme();
      (backdrop.querySelector('.attend input') || sessionTa || courseTa).focus();
    }

    // ---- カレンダーへ書き出し(.ics) ----
    function openExportDialog(week) {
      closeDialog();
      const lessonCount = week.days.reduce((n, d) => n + d.lessons.length, 0);
      const weeksInput = h('input', { type: 'number', min: '1', max: '30', value: '1', 'aria-label': '書き出す週数' });
      const alarmInput = h('input', { type: 'checkbox' });
      const msg = h('p', { class: 'muted' });
      const go = () => {
        const weeks = Math.max(1, Math.min(30, parseInt(weeksInput.value, 10) || 1));
        const { text, count } = buildIcs(week, { weeks, alarm: alarmInput.checked });
        if (!count) { msg.textContent = 'この週に書き出せる授業がありません。'; return; }
        const first = week.days[0].key;
        downloadText(`AAUC2-timetable-${first}${weeks > 1 ? `-${weeks}w` : ''}.ics`, text, 'text/calendar;charset=utf-8');
        msg.textContent = `${count} 件の授業を書き出しました。ダウンロードした .ics をカレンダーアプリで開いて取り込んでください。`;
      };
      const backdrop = h('div', { class: 'backdrop' },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'カレンダーへ書き出し', style: '--h:232' },
          h('div', { class: 'mhead' },
            h('div', { class: 'mtitle' }, h('b', {}, 'カレンダーへ書き出し (.ics)'), h('small', {}, `${week.range} · 授業 ${lessonCount} コマ`)),
            h('button', { class: 'pill icon-only', type: 'button', title: '閉じる (Esc)', onclick: closeDialog }, icon('x', 17)),
          ),
          h('h3', {}, '書き出す範囲'),
          h('div', { class: 'row2' }, h('span', {}, 'この週から'), weeksInput, h('span', {}, '週分(毎週同じ時間割として繰り返し)')),
          h('div', { class: 'row2' }, h('label', {}, alarmInput, ' 授業の10分前に通知を付ける')),
          h('p', { class: 'muted small' }, '祝日・休講・時間割の変更は反映されません。Google カレンダーは「設定 → インポート」、iPhone はファイルを開くと取り込めます。'),
          h('div', { class: 'row2' }, h('button', { class: 'go', type: 'button', onclick: go }, icon('cal', 15), '書き出す')),
          msg,
        ),
      );
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeDialog(); });
      shadow.append(backdrop);
      state.dialog = { el: backdrop, persist: () => {} };
      applyTheme();
      weeksInput.focus();
    }

    const ctxOf = (lesson) => ({
      name: lesson.name, code: lesson.code, hue: lesson.hue, teacher: lesson.teacher, kind: lesson.kind,
      time: `${lesson.startLabel} – ${lesson.endLabel}`, dateKey: lesson.dateKey,
      lesson, canAttend: isTodayLesson(lesson),
    });

    function refreshNotes() {
      if (state.view === 'notes') { render(); return; }
      for (const c of state.cards) c.paint?.();
    }

    // タイムライン用の詳細カード
    function lessonCard(lesson) {
      const chip = h('span', { class: 'chip' });
      const bar = h('i');
      const notePreview = h('div', { class: 'notepreview' });
      const noteText = h('span');
      notePreview.append(icon('note', 14), noteText);
      const paint = () => {
        const t = notesStore.preview(lesson.name, lesson.dateKey);
        noteText.textContent = t;
        notePreview.hidden = !t;
      };
      const abadge = h('span', { class: 'abadge', hidden: true });
      const attsum = h('span', { class: 'attsum', hidden: true });
      const risk = h('span', { class: 'risk', hidden: true });
      let lastK = '';
      const paintAtt = () => {
        const b = badgeOf(lesson);
        abadge.hidden = !b;
        if (b) {
          abadge.dataset.k = b.k;
          abadge.textContent = `${b.sym} ${b.label}`;
          abadge.title = `出欠表: ${b.label}`;
          if (b.k !== lastK && lastK) { abadge.classList.remove('pop'); void abadge.offsetWidth; abadge.classList.add('pop'); }
          lastK = b.k;
        }
        const info = attInfo(lesson);
        attsum.hidden = !info;
        if (info) attsum.replaceChildren(icon('check', 14), `出席 ${info.course.present}/${info.course.surveyed}回 · 欠席率 ${info.course.rate || '0%'}`);
        const r = info && attendanceRisk(info.course);
        risk.hidden = !r;
        if (r) {
          risk.dataset.level = r.level;
          risk.textContent = r.text;
          risk.title = r.assumed
            ? `全回数が未設定のため、調査済み${r.surveyed}回(最低${MIN_TOTAL}回)から目安で判定しています。「出欠」タブで全回数を設定すると正確になります`
            : `欠席 ${r.absent}回 / 上限 ${r.limit}回(全${r.total}回)。出席 ${r.attended}回 / 必要 ${r.need}回`;
        }
      };
      const card = h('article', { class: 'lcard', style: hueStyle(lesson) },
        h('div', { class: 'lhead' },
          h('span', { class: 'name' }, lesson.name),
          chip,
          abadge,
          h('button', { class: 'memo-btn', type: 'button', title: 'メモ・詳細', onclick: () => openDialog(ctxOf(lesson)) }, icon('note', 14), 'メモ'),
        ),
        h('div', { class: 'meta' },
          lesson.teacher && h('span', {}, icon('user', 14), lesson.teacher),
          lesson.kind && h('span', {}, icon('pin', 14), lesson.kind),
          h('span', {}, `${lesson.end - lesson.start}分`),
          attsum,
          risk,
        ),
        notePreview,
        h('div', { class: 'lbar' }, bar),
        attendForm(lesson),
      );
      paint();
      paintAtt();
      state.cards.push({ lesson, card, chip, bar, paint, paintAtt });
      return card;
    }

    // 週間グリッド用のコンパクトなブロック(クリックで詳細・出席・メモ)
    function weekBlock(lesson) {
      const chip = h('span', { class: 'chip' });
      const noteIcon = h('span', { class: 'wnote', title: 'メモあり' }, icon('note', 13));
      const paint = () => { noteIcon.hidden = !notesStore.preview(lesson.name, lesson.dateKey); };
      const abadge = h('span', { class: 'abadge mini', hidden: true });
      let lastK = '';
      const wrisk = h('span', { class: 'risk mini', hidden: true });
      const paintAtt = () => {
        // 欠席の余裕が少ない科目だけ、ブロックにも警告を出す
        const info = attInfo(lesson);
        const r = info && attendanceRisk(info.course);
        wrisk.hidden = !r || r.level === 'ok';
        if (r && r.level !== 'ok') { wrisk.dataset.level = r.level; wrisk.textContent = r.level === 'over' ? '要確認' : r.assumed ? (r.level === 'danger' ? '欠席率 高め' : '欠席率 注意') : `欠席あと${r.remaining}回`; wrisk.title = r.text; }
        const b = badgeOf(lesson);
        abadge.hidden = !b;
        if (!b) return;
        abadge.dataset.k = b.k;
        abadge.textContent = b.k === 'none' ? b.label : `${b.sym} ${b.label}`;
        abadge.title = `出欠表: ${b.label}`;
        if (b.k !== lastK && lastK) { abadge.classList.remove('pop'); void abadge.offsetWidth; abadge.classList.add('pop'); }
        lastK = b.k;
      };
      const open = () => openDialog(ctxOf(lesson));
      const card = h('article', {
        class: 'lcard', style: hueStyle(lesson), role: 'button', tabindex: '0',
        'aria-label': `${lesson.name} の詳細を開く`,
        onclick: open,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
      },
        h('div', { class: 'wtime' }, `${lesson.startLabel} – ${lesson.endLabel}`, chip, noteIcon),
        h('div', { class: 'name' }, lesson.name),
        lesson.teacher && h('div', { class: 'wteacher' }, lesson.teacher),
        abadge,
        wrisk,
      );
      paint();
      paintAtt();
      state.cards.push({ lesson, card, chip, bar: null, paint, paintAtt });
      return card;
    }

    function renderHero(week) {
      const el = h('section', { class: 'hero' });

      // 出席受付中(または直前・締切後で未記録)の授業を1つ選ぶ
      const pickWinLesson = (day) => {
        if (!day) return null;
        return day.lessons.find((l) => {
          if (isRecorded(l) || state.submitted.has(lessonKey(l))) return false;
          const w = attendWindow(l);
          if (w.phase === 'before') return w.remain <= 600;
          if (w.phase === 'closed') return !!state.att.data && new Date().getHours() * 60 + new Date().getMinutes() < l.end;
          return true;
        }) || null;
      };
      let winLesson = null;
      let winEl = null;
      let winKey = '';
      const winKeyOf = (l) => (l ? `${lessonKey(l)}|${attendWindow(l).phase}` : '');
      const paintHeroWin = () => {
        if (!winEl || !winLesson) return;
        const w = attendWindow(winLesson);
        winEl.dataset.phase = w.phase;
        winEl.textContent = `${winLesson.name} — ${winText(w)}`;
      };

      const update = () => {
        const { now, nowMin, day } = todayInfo(week);
        winLesson = pickWinLesson(day);
        winKey = winKeyOf(winLesson);
        winEl = winLesson ? h('div', { class: 'hero-win' }) : null;
        paintHeroWin();
        const current = day?.lessons.find((l) => statusOf(l, nowMin) === 'now');
        const upcoming = day?.lessons.find((l) => statusOf(l, nowMin) === 'later');

        let mode = 'idle', label = '今日', title = '', sub = '', pct = null;
        if (!day) { title = '表示中の週に今日は含まれていません'; sub = '「週間」タブで週を移動できます'; }
        else if (current) {
          mode = 'now'; label = '授業中'; title = current.name;
          sub = `${current.endLabel} まで · 残り ${fmtSpan(current.end - nowMin)}`;
          pct = ((nowMin - current.start) / (current.end - current.start)) * 100;
        } else if (upcoming) {
          mode = 'next'; label = '次の授業'; title = upcoming.name;
          sub = `${upcoming.startLabel} 開始 · あと ${fmtSpan(upcoming.start - nowMin)}`;
        } else if (day.lessons.length) { title = '本日の授業はすべて終了しました'; sub = 'おつかれさまでした'; }
        else { title = '今日は授業がありません'; sub = 'ゆっくり過ごしましょう'; }

        const total = day?.lessons.length || 0;
        const finished = day ? day.lessons.filter((l) => statusOf(l, nowMin) === 'done').length : 0;

        // 出欠表への反映状況(開始済みの授業のうち、出欠が記録された数)
        const startedLessons = day ? day.lessons.filter((l) => l.start <= nowMin && !attInfo(l)?.course.partial) : [];
        const reflected = startedLessons.filter((l) => {
          const s = attInfo(l)?.session;
          return s && RECORDED.includes(markInfo(s.mark).k);
        }).length;
        const showAtt = !!state.att.data && startedLessons.length > 0;

        el.replaceChildren(
          h('div', { class: 'hero-date' },
            h('div', { class: 'md' }, `${now.getMonth() + 1}月${now.getDate()}日 ${DOW[now.getDay()]}曜日`),
            h('div', { class: 'clock' }, `${pad(now.getHours())}:${pad(now.getMinutes())}`),
          ),
          h('div', { class: 'hero-main' },
            h('span', { class: 'hero-label', 'data-mode': mode }, h('span', { class: 'dot' }), label),
            h('div', { class: 'hero-title' }, title),
            h('div', { class: 'hero-sub' }, sub),
            winEl,
            pct != null && h('div', { class: 'progress' }, h('i', { style: `width:${Math.max(2, Math.min(100, pct)).toFixed(1)}%` })),
            total > 0 && h('div', { class: 'stats' },
              h('span', { class: 'stat' }, `今日 ${total} コマ`),
              h('span', { class: 'stat' }, `終了 ${finished} / ${total}`),
              showAtt && h('span', { class: 'stat' }, `出欠反映 ${reflected} / ${startedLessons.length}`),
              day.lessons[0] && h('span', { class: 'stat' }, `${day.lessons[0].startLabel} 〜 ${day.lessons[day.lessons.length - 1].endLabel}`),
            ),
          ),
        );
      };
      // 毎秒: 受付状態が変わったときだけ作り直し、それ以外は文言だけ更新(点滅アニメを保つ)
      const tick = () => {
        const { day } = todayInfo(week);
        if (winKeyOf(pickWinLesson(day)) !== winKey) update();
        else paintHeroWin();
      };
      update();
      return { el, update, tick };
    }

    function refreshStatuses(week) {
      const { day, nowMin } = todayInfo(week);
      const next = day?.lessons.find((l) => statusOf(l, nowMin) === 'later');
      for (const { lesson, card, chip, bar } of state.cards) {
        if (!day || !day.lessons.includes(lesson)) { delete card.dataset.status; chip.textContent = ''; continue; }
        let s = statusOf(lesson, nowMin);
        if (lesson === next) s = 'next';
        card.dataset.status = s;
        chip.dataset.s = s;
        chip.textContent = { now: '授業中', next: '次', done: '終了', later: '' }[s];
        if (bar) bar.style.width = s === 'now' ? `${((nowMin - lesson.start) / (lesson.end - lesson.start)) * 100}%` : '0';
      }
    }

    const tagList = (items, iconName) => h('div', { class: 'chips' }, items.map((t) => h('span', { class: 'tag' }, icon(iconName, 14), t)));

    function renderToday(week) {
      const { day } = todayInfo(week);
      if (!day) return h('div', { class: 'empty' }, '表示中の週に今日が含まれていません。「週間」タブで週を移動できます。');
      const box = h('div', { class: 'stack' });

      // 欠席の余裕が少ない科目(欠席あと2回以下・上限超過)があれば、授業一覧の上に警告する
      const alertBox = h('section', { class: 'riskbox', hidden: true });
      const paintAlert = () => {
        const list = (state.att.data?.courses || []).map((c) => ({ c, r: attendanceRisk(c) })).filter((x) => x.r.level !== 'ok');
        alertBox.hidden = !list.length;
        alertBox.replaceChildren(
          h('h2', {}, '欠席に注意'),
          h('div', { class: 'chips' }, list.map(({ c, r }) => h('span', { class: 'tag risk', 'data-level': r.level, title: `全${r.total}回のうち欠席は${r.limit}回まで` }, `${c.name} — ${r.text}`))),
        );
      };
      paintAlert();
      state.extras.push(paintAlert);
      box.append(alertBox);

      const sec = h('section');
      sec.append(h('h2', {}, `${day.label} の授業`));
      if (day.lessons.length) {
        const tl = h('div', { class: 'timeline' });
        day.lessons.forEach((l, i) => {
          const prev = day.lessons[i - 1];
          if (prev && l.start - prev.end >= 5) tl.append(h('div', { class: 'gap' }, `空き時間 ${fmtSpan(l.start - prev.end)}`));
          tl.append(h('div', { class: 'tl-row', style: `--i:${i}` },
            h('div', { class: 'tl-time' }, h('b', {}, l.startLabel), h('span', {}, l.endLabel)),
            lessonCard(l),
          ));
        });
        sec.append(tl);
      } else {
        sec.append(h('div', { class: 'empty' }, '今日は授業がありません。'));
      }
      box.append(sec);
      if (day.events.length) box.append(h('section', {}, h('h2', {}, '今日の予定'), tagList(day.events, 'cal')));
      if (week.intensive.length) box.append(h('section', {}, h('h2', {}, '集中・その他'), tagList(week.intensive, 'book')));
      return box;
    }

    function renderWeek(week) {
      const { day: today } = todayInfo(week);
      const box = h('div', { class: 'stack' });

      box.append(h('div', { class: 'weekbar' },
        h('button', { class: 'pill', type: 'button', onclick: () => pageAction('tabCalender_tabPanelWeek_imgLastWeek') }, icon('left'), '前の週'),
        h('span', { class: 'range' }, week.range),
        h('button', { class: 'pill', type: 'button', onclick: () => pageAction('tabCalender_tabPanelWeek_imgNextWeek') }, '次の週', icon('right')),
        h('button', { class: 'pill export', type: 'button', title: '時間割を .ics ファイルにして、カレンダーに取り込めます', onclick: () => openExportDialog(week) }, icon('cal'), 'カレンダーへ書き出し'),
      ));
      box.append(h('div', { class: 'hint' }, '授業ブロックをクリックすると、出席登録(当日のみ)とメモを開けます。'));

      const shown = week.days.filter((d) => d.dow !== 0 || d.lessons.length || d.events.length);
      const starts = [...new Set(week.days.flatMap((d) => d.lessons.map((l) => l.startLabel)))].sort();

      const grid = h('div', { class: 'grid' });
      grid.style.gridTemplateColumns = `58px repeat(${shown.length}, minmax(0, 1fr))`;
      grid.append(h('div'));
      for (const d of shown) {
        const cls = ['colhead', d === today && 'today', d.dow === 0 && 'sun', d.dow === 6 && 'sat'].filter(Boolean).join(' ');
        grid.append(h('div', { class: cls }, d.date, h('small', {}, `${DOW[d.dow]}曜日`)));
      }
      if (shown.some((d) => d.events.length)) {
        grid.append(h('div'));
        for (const d of shown) grid.append(h('div', { class: 'evrow' }, d.events.map((e) => h('span', { class: 'tag' }, e))));
      }
      starts.forEach((st, r) => {
        grid.append(h('div', { class: 'rowhead' }, PERIOD_OF[st] ? h('b', {}, `${PERIOD_OF[st]}限`) : null, st));
        shown.forEach((d, c) => {
          const lesson = d.lessons.find((l) => l.startLabel === st);
          const col = d === today ? ' today-col' : '';
          const delay = `--i:${Math.min(r + c, 10)}`;
          grid.append(lesson
            ? h('div', { class: `cell${col}`, style: delay }, weekBlock(lesson))
            : h('div', { class: `cell blank${col}`, style: delay }));
        });
      });
      box.append(h('div', { class: 'scroller' }, grid));
      if (!starts.length) box.append(h('div', { class: 'empty' }, 'この週に授業はありません。'));
      if (week.intensive.length) box.append(h('section', {}, h('h2', {}, '集中・その他'), tagList(week.intensive, 'book')));
      return box;
    }

    // 全回数の入力欄(変更したら保存して、上限・警告を再計算する)
    function totalInput(course, r) {
      const input = h('input', { type: 'number', min: '1', max: '40', value: r.assumed ? '' : String(r.total), placeholder: '自動', 'aria-label': `${course.name} の全回数`, class: r.assumed ? 'assumed' : '' });
      input.addEventListener('change', () => {
        const n = Math.max(0, Math.min(40, parseInt(input.value, 10) || 0));
        totalsStore.set(course, n);
        render();
      });
      return input;
    }

    // 出欠タブ: 出欠調査状況表(修学ポートフォリオ)の内容を科目ごとに表示
    function renderAttendance() {
      const a = state.att;
      const box = h('div', { class: 'stack' });
      box.append(h('section', {}, h('h2', {}, `出欠状況${a.data?.term ? `(${a.data.term})` : ''}`)));
      if (!a.data) {
        box.append(h('div', { class: 'empty' }, a.status === 'error'
          ? '出欠表を取得できませんでした。ポータルにログインしているか確認して、右上の「出欠更新」を押してください。'
          : a.status === 'loading'
            ? '出欠表を読み込み中…'
            : '出欠表はまだ読み込んでいません。右上の「出欠更新」を押してください。'));
        return box;
      }
      const t = new Date(a.at);
      box.append(h('div', { class: 'hint' }, `凡例  ○ 出席 ／ 欠席 △ 遅刻 ▽ 内公欠 － 未調査  ·  最終更新 ${pad(t.getHours())}:${pad(t.getMinutes())}(修学ポートフォリオ > 出欠調査状況表)`));
      box.append(h('div', { class: 'hint' }, '出席パスワードの受付: 授業開始〜3分=○出席 / 3〜15分=△遅刻 / 15分超は入力不可(欠席)。△は臨地実務実習などに影響します。'));
      box.append(h('div', { class: 'hint' }, `単位取得には全授業の3分の2以上の出席が必要です(遅刻・公欠は出席に数えます)。公欠が3分の1以上だと単位認定試験を受験できません。授業ごとに全回数が違うので、分かる科目は「全○回」を設定してください。未設定の科目は、最低${MIN_TOTAL}回ある前提でこれまでの調査回数から見積もり、現在の欠席率で「(目安)」として判定します(見積もりは実際より厳しめです)。`));
      if (!a.data.courses.length) box.append(h('div', { class: 'empty' }, '出欠表に授業がありません。'));
      const todayMd = todayKey().slice(5);
      a.data.courses.forEach((c, i) => {
        const r = attendanceRisk(c);
        box.append(h('article', { class: 'lcard ncard', style: `--h:${hueOf(c.name)};--i:${Math.min(i, 8)}` },
          h('div', { class: 'lhead' }, h('span', { class: 'name' }, c.name), h('span', { class: 'risk', 'data-level': r.level }, r.text)),
          h('div', { class: 'meta' },
            c.teacher && h('span', {}, icon('user', 14), c.teacher),
            h('span', {}, `出席 ${c.present} / 調査 ${c.surveyed}回`),
            h('span', {}, `欠席 ${c.absent}`),
            h('span', {}, `欠席率 ${c.rate || '0%'}`),
            r.excused > 0 && h('span', {}, `公欠 ${r.excused}回`),
          ),
          // 科目ごとの全回数(授業によって10回・15回・18回など違う)。変更すると上限が再計算される
          h('div', { class: 'total-row' },
            h('label', {}, '全', totalInput(c, r), '回'),
            h('span', { class: 'muted small' }, r.assumed ? `未設定(自動): 調査済み${r.surveyed}回から目安で判定中。全回数が分かれば入力すると正確になります` : `出席は ${r.need}回以上必要(欠席は ${r.limit}回まで)`),
          ),
          // 欠席の上限に対する使用量
          h('div', { class: 'meter', title: `全${r.total}回のうち、出席が${r.need}回以上必要(欠席は${r.limit}回まで)` },
            h('div', { class: 'meter-bar' }, h('i', { 'data-level': r.level, style: `width:${Math.min(100, (r.absent / Math.max(1, r.limit)) * 100)}%` })),
            h('span', {}, `欠席 ${r.absent} / 上限 ${r.limit}回`),
          ),
          sessionStrip(c, todayMd),
          c.partial && h('p', { class: 'muted small' }, '15回を超える分のマスは出欠表のページ送りにあるため、ここには表示されません(欠席の判定は集計値を使っています)。'),
        ));
      });
      return box;
    }

    // メモタブ: 書いたメモを科目ごとに一覧
    function renderNotes() {
      const all = notesStore.all();
      const names = Object.keys(all).sort((a, b) => a.localeCompare(b, 'ja'));
      const box = h('div', { class: 'stack' });
      box.append(h('section', {}, h('h2', {}, 'メモ一覧')));
      box.append(h('div', { class: 'hint' }, notesSync.enabled
        ? 'メモは Chrome の同期で保存されます(Chrome にログインして同期をオンにしていると、他の PC とも共有されます)。'
        : 'この環境では同期できないため、メモはこのブラウザ内にのみ保存されます。'));
      if (!names.length) {
        box.append(h('div', { class: 'empty' }, 'まだメモがありません。「今日」タブのカードの「メモ」ボタン、または「週間」タブの授業ブロックから追加できます。'));
        return box;
      }
      const list = h('div', { class: 'stack' });
      names.forEach((name, i) => {
        const n = notesStore.get(name);
        const sessions = Object.keys(n.sessions).sort().reverse();
        const open = () => openDialog({ name, hue: hueOf(name), teacher: '', kind: '', time: '', dateKey: '', lesson: null, canAttend: false });
        list.append(h('article', { class: 'lcard ncard', style: `--h:${hueOf(name)};--i:${Math.min(i, 8)}` },
          h('div', { class: 'lhead' },
            h('span', { class: 'name' }, name),
            h('button', { class: 'memo-btn', type: 'button', onclick: open }, icon('note', 14), '編集'),
          ),
          n.course.trim() && h('div', { class: 'ntext' }, n.course),
          sessions.map((k) => h('div', { class: 'nsess' }, h('span', { class: 'nd' }, dateLabelOf(k)), h('span', { class: 'nt' }, n.sessions[k]))),
        ));
      });
      box.append(list);
      return box;
    }

    // ---- 通知(授業開始前・出席受付・遅刻/締切の直前) ----
    const NOTIFY_EVENTS = [
      { at: -120, title: 'まもなく授業開始', body: (l) => `${l.name}(${l.startLabel}〜)。開始から3分以内に出席コードを入力すると「出席」になります。` },
      { at: 0, title: '出席受付が始まりました', body: (l) => `${l.name}: 3分以内=○出席 / 15分以内=△遅刻` },
      { at: 120, title: 'あと1分で遅刻扱いです', body: (l) => `${l.name}: 出席コードを入力してください` },
      { at: 780, title: 'あと2分で受付終了です', body: (l) => `${l.name}: 開始から15分を過ぎると入力できず欠席になります` },
    ];
    const fired = new Set(store.get('fired', []).filter((k) => k.startsWith(todayKey())));

    function checkNotifications() {
      if (!state.notify || !state.week || !('Notification' in window) || Notification.permission !== 'granted') return;
      const { day, now } = todayInfo(state.week);
      if (!day) return;
      const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      for (const l of day.lessons) {
        // 出欠が記録済み、またはこのページから送信済みなら通知しない
        if (isRecorded(l) || state.submitted.has(lessonKey(l))) continue;
        const elapsed = sec - l.start * 60;
        for (const ev of NOTIFY_EVENTS) {
          if (elapsed < ev.at || elapsed >= ev.at + 60) continue;
          const key = `${lessonKey(l)}|${ev.at}`;
          if (fired.has(key)) continue;
          fired.add(key);
          store.set('fired', [...fired]);
          try { new Notification(ev.title, { body: ev.body(l), tag: key }); } catch { /* 通知を出せない環境では無視 */ }
        }
      }
    }

    function toast(text) {
      const el = h('div', { class: 'toast' }, text);
      overlay.append(el);
      setTimeout(() => el.remove(), 3200);
    }

    // 1秒ごと: 受付カウントダウン・ヒーロー・通知(画面を閉じていても通知は動く)
    setInterval(() => {
      if (!state.week) return;
      for (const w of state.wins) { if (w.el.isConnected) w.paint(); else state.wins.delete(w); }
      state.hero?.tick?.();
      checkNotifications();
    }, 1000);

    let timer = null;
    function render() {
      clearInterval(timer);
      state.cards = [];
      state.extras = [];
      state.hero = null;
      const week = readWeek();
      state.week = week;

      const tabBtn = (id, label) => h('button', {
        class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(state.view === id),
        onclick: () => { state.view = id; store.set('view', id); render(); },
      }, label);

      state.refreshBtn = h('button', {
        class: 'pill', type: 'button',
        onclick: () => {
          if (attendModalPending()) return toast('出席パスワード画面が開いています。送信するか閉じてから更新してください');
          loadAttendance(true);
        },
      }, icon('refresh'), h('span', { class: 'lbl' }, '出欠更新'));
      state.sessChip = h('button', { class: 'pill sess', type: 'button', onclick: () => checkSession({ manual: true }) }, icon('clock'), h('span', { class: 'lbl' }, 'ログイン'));
      const notifyTitle = () => (state.notify ? '通知: オン(授業前・出席受付・締切直前)' : '通知: オフ(クリックでオン)');
      const notifyBtn = h('button', { class: 'pill icon-only', type: 'button', 'data-on': String(state.notify), title: notifyTitle() }, icon('alarm', 17));
      notifyBtn.addEventListener('click', async () => {
        if (state.notify) {
          state.notify = false;
          toast('通知をオフにしました');
        } else {
          if (!('Notification' in window)) return toast('このブラウザは通知に対応していません');
          let perm = Notification.permission;
          if (perm === 'default') perm = await Notification.requestPermission();
          if (perm !== 'granted') return toast('通知が許可されていません(ブラウザのサイト設定で許可してください)');
          state.notify = true;
          toast('通知をオンにしました。授業の2分前・受付開始・遅刻/締切の直前にお知らせします');
        }
        store.set('notify', state.notify);
        notifyBtn.dataset.on = String(state.notify);
        notifyBtn.title = notifyTitle();
      });
      const themeBtn = h('button', { class: 'pill icon-only', type: 'button', title: `テーマ: ${THEME_LABEL[state.theme]}` }, icon(THEME_ICON[state.theme], 17));
      themeBtn.addEventListener('click', () => {
        state.theme = THEME_ORDER[(THEME_ORDER.indexOf(state.theme) + 1) % THEME_ORDER.length];
        store.set('theme', state.theme);
        applyTheme();
        themeBtn.title = `テーマ: ${THEME_LABEL[state.theme]}`;
        themeBtn.replaceChildren(icon(THEME_ICON[state.theme], 17));
      });

      const head = h('header', {},
        h('div', { class: 'logo' },
          h('span', { class: 'mark' }, 'A2'),
          h('div', { class: 'brand' }, h('b', {}, 'AAUC2'), h('small', {}, [week?.term, week?.range].filter(Boolean).join(' · '))),
        ),
        h('nav', { class: 'tabs', role: 'tablist' }, tabBtn('today', '今日'), tabBtn('week', '週間'), tabBtn('att', '出欠'), tabBtn('notes', 'メモ')),
        h('span', { class: 'spacer' }),
        h('div', { class: 'tools' },
          state.refreshBtn,
          state.sessChip,
          notifyBtn,
          readCounts().map((c) => h('button', { class: 'pill', type: 'button', title: c.label, onclick: () => pageAction(c.id) },
            icon(PORTAL_ICON[c.id] || 'book'), h('span', { class: 'lbl' }, c.label), c.count ? h('span', { class: 'badge' }, String(c.count)) : null)),
          themeBtn,
          h('button', { class: 'pill icon-only', type: 'button', onclick: () => setOpen(false), title: '元のページを表示 (Esc)' }, icon('x', 17)),
        ),
      );

      const wrap = h('div', { class: 'wrap' });
      if (!week) {
        wrap.append(h('div', { class: 'empty' }, '時間割を読み取れませんでした。ポータルのトップページを開き直してください。'));
      } else if (state.view === 'notes') {
        wrap.append(renderNotes());
      } else if (state.view === 'att') {
        wrap.append(renderAttendance());
      } else {
        const hero = renderHero(week);
        state.hero = hero;
        if (state.view === 'week') wrap.append(renderWeek(week));
        else wrap.append(hero.el, renderToday(week));
        refreshStatuses(week);
        timer = setInterval(() => { hero.update(); refreshStatuses(week); }, 15000);
      }
      overlay.replaceChildren(head, state.sessBar, h('main', {}, wrap));
      refreshAttButton();
      state.sessBar.dataset.key = ''; // 再描画してバナーを作り直す
      paintSession();
    }

    // 出欠更新ボタンの見た目(回転・ツールチップ)を最新状態に合わせる
    function refreshAttButton() {
      if (!state.refreshBtn) return;
      state.refreshBtn.classList.toggle('spin', state.att.status === 'loading');
      const d = state.att.at ? new Date(state.att.at) : null;
      state.refreshBtn.title = state.att.status === 'error'
        ? '出欠表を取得できませんでした(クリックで再試行)'
        : `出欠表を更新${d ? ` (最終 ${pad(d.getHours())}:${pad(d.getMinutes())})` : ''}`;
    }

    render();
    setOpen(state.open);

    // メモの同期: 起動時に突き合わせ、他の PC での変更も反映する
    notesSync.onError = (e) => toast(`メモの同期に失敗しました(この PC には保存されています): ${String(e?.message || e).slice(0, 60)}`);
    notesSync.onRemoteChange = () => refreshNotes();
    notesSync.listen();
    notesSync.pull().then((changed) => { if (changed) refreshNotes(); });

    // 出席の受付時間帯(開始10分前〜締切)で未記録の授業があるか。
    // この間にバックグラウンドで画面遷移を動かすと、ポータルが「古い画面」と判断する恐れがあるため自動取得を止める
    const attendanceCritical = () => {
      if (!state.week) return false;
      const { day } = todayInfo(state.week);
      return !!day && day.lessons.some((l) => {
        if (isRecorded(l) || state.submitted.has(lessonKey(l))) return false;
        const w = attendWindow(l);
        return (w.phase === 'before' && w.remain <= 600) || w.phase === 'ok' || w.phase === 'late';
      });
    };

    // ---- ログイン(セッション)の期限 ----
    // 最後にポータルと通信してから20分で切れる。ページを開いた時点・出欠表の取得・出席送信で更新される。
    // 残り時間は推定なので、切れそうなときや授業の直前には、トップページを取得して実際に確認する
    // (ページの再読み込みと同じ操作で画面遷移は動かさない。有効なら確認と同時に20分に延長される)。
    function sessRemainMs() {
      return sess.last + SESSION_MIN * 60000 - Date.now();
    }

    function touchSession() {
      sess.last = Date.now();
      sess.expired = false;
      paintSession();
    }

    function notifyExpired() {
      if (!state.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
      try { new Notification('ログインが切れています', { body: '出席登録の前に、ポータルを再読み込みして再ログインしてください。', tag: 'aauc2-session' }); } catch { /* 通知不可 */ }
    }

    // 戻り値: true=有効 / false=切れている / null=確認しなかった
    async function checkSession({ manual = false, notifyIfExpired = false } = {}) {
      if (sess.checking) return null;
      if (attendModalPending()) {
        if (manual) toast('出席パスワード画面が開いています。送信するか閉じてから確認してください');
        return null;
      }
      sess.checking = true;
      paintSession();
      let alive = true;
      try {
        const demo = globalThis.__AAUC2_DEMO__;
        if (demo?.sessionAlive) alive = await demo.sessionAlive();
        else {
          // 切れていると、ログイン画面へのリダイレクトになる(opaqueredirect)
          const res = await fetch(location.pathname, { credentials: 'same-origin', redirect: 'manual' });
          alive = res.type !== 'opaqueredirect' && res.ok;
        }
      } catch {
        alive = false;
      }
      sess.checking = false;
      if (alive) {
        touchSession();
        if (manual) toast(`ログインは有効です。有効期間を延長しました(あと約${SESSION_MIN}分)`);
      } else {
        const wasExpired = sess.expired;
        sess.expired = true;
        paintSession();
        if (manual) toast('ログインが切れています。ページを再読み込みして再ログインしてください');
        if (notifyIfExpired && !wasExpired) notifyExpired();
      }
      return alive;
    }
    sessionHooks.touch = touchSession;
    sessionHooks.check = () => checkSession();

    function paintSession() {
      const remain = sessRemainMs();
      const min = Math.max(0, Math.ceil(remain / 60000));
      const level = sess.expired ? 'expired' : remain <= 5 * 60000 ? 'warn' : 'ok';
      if (state.sessChip) {
        state.sessChip.dataset.level = level;
        state.sessChip.classList.toggle('spin', sess.checking);
        state.sessChip.querySelector('.lbl').textContent = sess.expired ? 'ログイン切れ' : `ログイン ${min}分`;
        state.sessChip.title = sess.expired
          ? 'ログインが切れています(クリックで再確認)'
          : `ログインの残り時間(推定): 最後のポータル通信から${SESSION_MIN}分で切れます。クリックで確認して延長します`;
      }
      const bar = state.sessBar;
      if (!bar) return;
      const key = level === 'ok' ? '' : `${level}|${sess.expired ? 0 : min}`;
      if (bar.dataset.key === key) return;
      bar.dataset.key = key;
      bar.hidden = level === 'ok';
      bar.dataset.level = level;
      if (level === 'ok') { bar.replaceChildren(); return; }
      bar.replaceChildren(
        icon('clock', 18),
        h('span', { class: 'msg' }, level === 'expired'
          ? 'ログインが切れています。出席登録の前に、ページを再読み込みして再ログインしてください。'
          : `ログインの有効期限が近づいています(あと約${min}分)。出席登録の前に延長してください。`),
        level === 'expired'
          ? h('button', { class: 'go', type: 'button', onclick: () => location.reload() }, icon('refresh', 15), '再読み込みしてログインし直す')
          : h('button', { class: 'go', type: 'button', onclick: () => checkSession({ manual: true }) }, icon('refresh', 15), '確認して延長'),
      );
    }

    function tickSession() {
      if (!state.week) return;
      paintSession();
      const remain = sessRemainMs();
      // 推定の期限を過ぎたら、実際に確認する(1分に1回まで)
      if (!sess.expired && remain <= 0 && !sess.checking && Date.now() - sess.lastTry > 60000) {
        sess.lastTry = Date.now();
        checkSession({ notifyIfExpired: true });
      }
      // 授業の約4分前に確認する: 有効なら20分に延長され、受付が終わる開始15分後までカバーできる
      const { day, now } = todayInfo(state.week);
      if (!day || sess.checking) return;
      const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      for (const l of day.lessons) {
        if (isRecorded(l) || state.submitted.has(lessonKey(l)) || sess.checked.has(lessonKey(l))) continue;
        const untilStart = l.start * 60 - sec;
        if (untilStart <= 240 && untilStart > -WIN_LATE && remain < 18 * 60000) {
          sess.checked.add(lessonKey(l));
          checkSession({ notifyIfExpired: true });
          break;
        }
      }
    }
    setInterval(tickSession, 15000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      paintSession();
      if (sess.expired || sessRemainMs() <= 5 * 60000) checkSession({ notifyIfExpired: false });
    });

    // 出欠表の自動取得: 30秒ごとに判定し、未取得または5分以上経過していて、安全なときだけ実行する
    // (エラー後も5分は再試行しない。手動の「出欠更新」と出席送信後の確認は、この制限とは別に動く)
    const autoLoadAttendance = () => {
      if (document.hidden || !state.open) return;
      if (attendanceCritical() || attendModalPending()) return;
      if (Date.now() - state.att.at > 300000) loadAttendance();
    };
    // ページを開いた直後の最初の1回だけは、受付時間帯でも取得する(まだ何も操作していないので画面遷移の干渉は起きない)。
    // 授業の直前にページを開いても、出欠バッジや欠席の警告が出るようにするため
    if (!attendModalPending()) loadAttendance();
    setInterval(autoLoadAttendance, 30000);
  }

  // early.js が張った「元の画面を隠す覆い」を外す(AAUC2 の画面ができた/使わないページ)
  const removeCover = () => document.getElementById('aauc2-cover')?.remove();

  const start = () => {
    // 週間スケジュールがあるページ(トップ)でのみ動作
    if (!document.getElementById('tabCalender_tabPanelWeek_tblWeek')) { removeCover(); return; }
    try { buildUI(); } finally { removeCover(); }
  };
  // 時間割は HTML に最初から入っているので、画像などの読み込み完了は待たず、HTML の解析が終わったらすぐ始める
  // (週の移動でページが再読み込みされるたびに、元の画面が見える時間を短くするため)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
