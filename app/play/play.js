// Phone page for Live Quiz. It only talks to this play server: /live/join, /live/events (a live stream of what
// this phone may see), /live/answer and /live/leave. It never sees a correct answer before the reveal.
import { h, mount } from '/js/util.js';
import { icon } from '/js/icons.js';
import { FX } from '/js/fx.js';
import { readyScreen, questionScreen, revealScreen, boardScreen, podiumScreen } from '/rounds.js';

const root = document.getElementById('view');
const KEY = 'learnathanze:live:session';
const NICK_KEY = 'learnathanze:live:lastNick';      // so a phone that was dropped does not have to retype its name
const POLL_KEY = 'learnathanze:live:poll';          // sessionStorage: this tab's network does not deliver event streams, use long polling
const lastNick = () => { try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; } };

const store = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  write(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ } },
};
async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong.'), { code: data.error });
  return data;
}

let session = store.read();     // { code, token, nick }
let es = null, pollCtl = null;
let gen = 0;                    // bumped on every (re)connect, so a late message of an old connection is ignored
let lastMsg = 0, firstTimer = 0, watchTimer = 0;
let current = null;             // { name, update(view) }
let connTimer = 0, longTimer = 0, downSince = 0, pill = null, hostPill = null;
const wantPoll = () => { try { return sessionStorage.getItem(POLL_KEY) === '1'; } catch { return false; } };

// ------------------------------------------------------------ top bar: theme and motion
(function tools() {
  const tools = document.getElementById('tools');
  const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const motion = h('button', { class: 'icon-btn', type: 'button' }), theme = h('button', { class: 'icon-btn', type: 'button' });
  const paint = () => {
    motion.replaceChildren(icon(FX.reduced() ? 'zap-off' : 'zap', 18));
    motion.setAttribute('aria-label', FX.reduced() ? 'Motion reduced (tap for full motion)' : 'Full motion (tap to reduce)');
    motion.setAttribute('aria-pressed', String(!FX.reduced())); motion.classList.toggle('on', !FX.reduced());
    theme.replaceChildren(icon(isDark() ? 'sun' : 'moon', 18));
    theme.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  };
  motion.addEventListener('click', () => { FX.set('reduce', FX.reduced() ? 'off' : 'on'); paint(); });
  theme.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('learnathanze:theme', next); } catch { /* ignore */ }
    paint();
  });
  mount(tools, [motion, theme].map((b) => FX.obj(b, { cls: 'o-icon' })));
  paint();
  document.querySelector('.mark-sq').append(icon('graduation-cap', 15));
})();

// ------------------------------------------------------------ small helpers
const hue = (id) => parseInt(String(id).slice(0, 4), 16) % 5;
function chipFor(p, meId) {
  const c = h('span', { class: `pchip c${hue(p.id)}${p.away ? ' away' : ''}`, 'data-id': p.id }, p.nick, p.id === meId ? h('span', { class: 'tag' }, 'you') : null);
  return c;
}
/** Keep a list of nickname chips in sync with the roster without rebuilding the ones that are already there. */
function syncChips(box, players, meId) {
  const have = new Map([...box.children].map((c) => [c.dataset.id, c]));
  const ids = new Set(players.map((p) => p.id));
  for (const [id, el] of have) if (!ids.has(id)) { el.remove(); }
  players.forEach((p, i) => {
    let el = have.get(p.id);
    if (!el) {
      el = chipFor(p, meId);
      FX.anim(el, { scale: [0.5, 1], rotate: [(i % 2 ? 5 : -5), 0], opacity: [0, 1] }, FX.spring.bouncy);
    } else el.classList.toggle('away', !!p.away);
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
}

/** The "Reconnecting…" notice. It only appears after 1.5 s (a page refresh should not flash it), turns into a longer message after 20 s, and
 *  stays until a connection really works: repeated failed retries must not reset it. */
function setConn(ok) {
  if (ok) { downSince = 0; clearTimeout(connTimer); clearTimeout(longTimer); pill?.remove(); pill = null; return; }
  if (downSince) return;
  downSince = Date.now();
  connTimer = setTimeout(() => {
    pill = h('div', { class: 'conn-pill', role: 'status' }, 'Reconnecting…');
    document.body.append(pill);
    longTimer = setTimeout(() => { if (pill) pill.textContent = 'Cannot reach the game. Check your Wi-Fi, or ask the host if it is still running.'; }, 20000);
  }, 1500);
}

function show(name, build, view) {
  if (!current || current.name !== name) {
    current?.destroy?.();
    const s = build();
    current = { name, update: s.update, destroy: s.destroy };
    mount(root, s.el);
    if (s.enter) s.enter();
  }
  current.update(view);
}

// ------------------------------------------------------------ screens
function joinScreen({ code = '', message = '' } = {}) {
  closeStream();
  setConn(true);
  current?.destroy?.();
  current = { name: 'join', update() {} };
  const err = h('p', { class: 'play-error', role: 'alert' }, message);
  const codeIn = h('input', { class: 'face', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '5', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '00000', 'aria-label': 'Game code', value: code, enterkeyhint: 'next' });
  const nickIn = h('input', { class: 'face', type: 'text', maxlength: '16', autocomplete: 'nickname', autocapitalize: 'words', spellcheck: 'false', placeholder: 'Your nickname', 'aria-label': 'Nickname', enterkeyhint: 'go', value: lastNick() });
  const go = h('button', { class: 'btn yellow xl', type: 'submit' }, icon('play', 22), 'Join game');
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.replace(/\D/g, '').slice(0, 5); if (codeIn.value.length === 5) nickIn.focus(); });
  const form = h('form', { class: 'play-form', novalidate: true },
    h('label', null, h('span', { class: 'lab' }, 'Game code'), h('span', { class: 'code-input' }, FX.obj(codeIn, { cls: 'o-input', hover: false }))),
    h('label', null, h('span', { class: 'lab' }, 'Nickname'), FX.obj(nickIn, { cls: 'o-input', hover: false })),
    err,
    FX.obj(go, { cls: 'o-btn' }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (!/^\d{5}$/.test(codeIn.value)) { err.textContent = 'Type the 5 digit code from the big screen.'; codeIn.focus(); return; }
    if (!nickIn.value.trim()) { err.textContent = 'Pick a nickname.'; nickIn.focus(); return; }
    go.disabled = true;
    try {
      const r = await post('/live/join', { code: codeIn.value, nick: nickIn.value });
      session = { code: codeIn.value, token: r.token, nick: r.nick };
      store.write(session);
      try { localStorage.setItem(NICK_KEY, r.nick); } catch { /* private mode */ }
      connect();
    } catch (ex) {
      err.textContent = ex.message;
      (ex.code === 'code' ? codeIn : nickIn).focus();
    } finally { go.disabled = false; }
  });
  mount(root,
    h('h1', null, 'Join a live quiz'),
    h('p', { class: 'lead' }, 'Type the code from the big screen and pick a nickname. No account needed.'),
    form);
  FX.enter([...form.children], { y: 24, delay: FX.base(), stagger: 0.06, spring: FX.spring.soft });
  if (!code) codeIn.focus({ preventScroll: true }); else nickIn.focus({ preventScroll: true });
}

function lobbyScreen() {
  const me = h('div', { class: 'nick' });
  const exam = h('p', { class: 'exam' });
  const card = h('div', { class: 'you-card hard' }, h('span', { class: 'lab' }, 'You joined as'), me, exam);
  const mascot = FX.mascot();
  const status = h('p', null, 'Waiting for the host to start');
  const count = h('span', { class: 'lab' });
  const chips = h('div', { class: 'pchips' });
  let armed = false;
  const leave = h('button', { class: 'btn alt', type: 'button' }, icon('log-out', 16), 'Leave game');
  leave.addEventListener('click', async () => {
    if (!armed) { armed = true; leave.lastChild.textContent = 'Tap again to leave'; setTimeout(() => { armed = false; leave.lastChild.textContent = 'Leave game'; }, 3500); return; }
    try { await post('/live/leave', { t: session?.token }); } catch { /* leaving anyway */ }
    store.write(null); session = null;
    joinScreen();
  });
  const el = h('div', null, FX.obj(card, { cls: 'o-card', hover: false }), h('div', { class: 'wait' }, mascot, status),
    h('h2', { class: 'section' }, 'In the lobby ', count), chips, h('div', { class: 'leave-row' }, FX.obj(leave, { cls: 'o-btn' })));
  return {
    el,
    enter() { FX.enter([card.closest('.obj')], { y: -40, rotate: -2, delay: FX.base(), spring: FX.spring.deal }); mascot.mood('happy'); },
    update(v) {
      me.textContent = v.you.nick;
      exam.textContent = v.exam.title;
      count.textContent = `${v.players.length} ${v.players.length === 1 ? 'player' : 'players'}`;
      syncChips(chips, v.players, v.you.id);
    },
  };
}

const ctx = { post, token: () => session?.token };

/** Which screen a message belongs to: a new one for every question, so each gets its own entrance. */
function screenName(v) {
  const i = v.q?.index;
  if (v.phase === 'question') return `question:${i}`;
  if (v.phase === 'reveal') return `reveal:${i}`;
  if (v.phase === 'ready') return `ready:${i}`;
  if (v.phase === 'board') return `board:${v.progress.index}`;
  return v.phase;
}
const FACTORY = { lobby: lobbyScreen, ready: readyScreen, question: (v) => questionScreen(v, ctx), reveal: revealScreen, board: boardScreen, podium: podiumScreen };

function showHostPill(away) {
  if (!away) { hostPill?.remove(); hostPill = null; return; }
  if (hostPill) return;
  hostPill = h('div', { class: 'conn-pill host', role: 'status' }, 'The host is away. The game goes on when they are back.');
  document.body.append(hostPill);
}

function render(v) {
  showHostPill(v.hostAway);
  if (v.exam?.accent) document.body.style.setProperty('--accent', v.exam.accent);
  const name = screenName(v);
  show(name, () => FACTORY[v.phase](v), v);
}

// ------------------------------------------------------------ the live connection
// Normally an event stream (the server pushes a full snapshot on every change, plus a ping every 10 s). If nothing arrives within 5 s
// (some tunnels and proxies swallow event streams) the page switches to long polling, which needs nothing special from the network.
function closeStream() {
  gen++;
  if (es) { es.close(); es = null; }
  pollCtl?.abort(); pollCtl = null;
  clearTimeout(firstTimer); clearInterval(watchTimer);
  showHostPill(false);
}

function handle(m) {
  lastMsg = Date.now();
  if (m.ping) return;
  if (m.gone || m.ended) {
    const code = session?.code;
    store.write(null); session = null;
    joinScreen({ code: m.ended || m.noGame ? '' : code || '', message: m.ended ? 'The host ended the game.' : (m.message || 'You are no longer in this game.') });
    return;
  }
  render(m);
}

function startStream(my) {
  es = new EventSource(`/live/events?t=${encodeURIComponent(session.token)}&c=${encodeURIComponent(session.code)}`);
  let got = false;
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.addEventListener('ping', () => { lastMsg = Date.now(); });
  es.onmessage = (e) => {
    if (my !== gen) return;
    got = true; setConn(true);
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
  firstTimer = setTimeout(() => {
    if (my !== gen || got || navigator.onLine === false) return;
    try { sessionStorage.setItem(POLL_KEY, '1'); } catch { /* ignore */ }
    connect();
  }, 5000);
}

async function startPoll(my) {
  pollCtl = new AbortController();
  let tag = '';
  while (my === gen) {
    try {
      const res = await fetch(`/live/state?t=${encodeURIComponent(session.token)}&c=${encodeURIComponent(session.code)}&tag=${encodeURIComponent(tag)}`, { cache: 'no-store', signal: pollCtl.signal });
      const m = await res.json();
      if (my !== gen) return;
      setConn(true);
      if (m.tag) tag = m.tag;
      handle(m);
    } catch {
      if (my !== gen) return;
      setConn(false);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

function connect() {
  closeStream();
  if (!session) return joinScreen();
  const my = gen;
  lastMsg = Date.now();
  if (wantPoll()) startPoll(my); else startStream(my);
  // Watchdog: a dead connection (Wi-Fi switched, laptop slept, proxy dropped it) can stay "open" for a long time. No message or ping for 30 s: start over.
  watchTimer = setInterval(() => {
    if (my !== gen || document.visibilityState === 'hidden') return;
    if ((es && es.readyState === 2) || Date.now() - lastMsg > 30000) connect();
  }, 5000);
}

// Waking the phone, coming back from another app, or the network returning: ask for a fresh snapshot right away.
const refresh = () => { if (session) connect(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
window.addEventListener('online', refresh);

// ------------------------------------------------------------ start
(function start() {
  FX.boot();
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  if (hash.get('c') && hash.get('t')) {          // the host's own "player screen" link: sign in straight away
    session = { code: hash.get('c'), token: hash.get('t'), nick: '' };
    store.write(session);
    history.replaceState(null, '', location.pathname);
  }
  const wanted = query.get('c');
  if (session && wanted && session.code !== wanted) { store.write(null); session = null; }   // a QR for a different game
  if (session) connect(); else joinScreen({ code: /^\d{5}$/.test(wanted || '') ? wanted : '' });
})();
