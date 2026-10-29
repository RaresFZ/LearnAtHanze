// Live Quiz, host side: the setup screen (#/exam/<id>/live) and the big-screen host view (#/exam/<id>/live/host).
// The game itself runs on the server; this page only shows what the server sends over /api/live/events and sends the host's buttons.
// Nothing here touches the solo progress (store.js).
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { readyScreen, roundScreen, boardScreen, podiumScreen } from './live-rounds.js';
import { helpPanel } from './live-help.js';

const COUNTS = [5, 10, 20];
const SECONDS = [10, 20, 30];
const NICK_KEY = 'learnathanze:live:hostNick';

async function call(path, body) {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { code: data.code });
  return data;
}
let endedByMe = false;       // the host pressed End: then "the game is over" needs no explanation
let notice = null;           // shown once on the setup screen when a game ended without the host pressing End
const act = (action, extra = {}) => { if (action === 'end') endedByMe = true; return call('/api/live/action', { action, ...extra }); };
/** Same rule as the server: multiple choice and true/false, never flagged ones. */
const usable = (q) => (q.type === 'mc' || q.type === 'tf') && !q.flag;
const bareUrl = (u) => u.replace(/^https?:\/\//, '');
const hue = (id) => parseInt(String(id).slice(0, 4), 16) % 5;

let qrLoad = null;
const loadQr = () => (qrLoad ||= new Promise((resolve, reject) => {
  if (window.qrcode) return resolve();
  const s = document.createElement('script');
  s.src = 'vendor/qrcode.js'; s.onload = resolve; s.onerror = () => reject(new Error('QR code library failed to load'));
  document.head.append(s);
}));
/** The QR code as an inline SVG (black on white, whatever the theme), drawn from the module matrix. */
function qrSvg(text) {
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), pad = 2, size = n + pad * 2;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code to join the game');
  const bg = document.createElementNS(ns, 'rect'); bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#ffffff');
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#141414');
  svg.append(bg, path);
  return svg;
}

let hostES = null, offlinePill = null, keyHandler = null, watchTimer = 0, visHandler = null, lastMsg = 0;
let hostBus = new EventTarget();
// Which network address is shown (when this computer has more than one).
let selected = 0;
export function destroyLive() {
  if (hostES) { hostES.close(); hostES = null; }
  clearInterval(watchTimer);
  if (visHandler) { document.removeEventListener('visibilitychange', visHandler); visHandler = null; }
  if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null; }
  offlinePill?.remove(); offlinePill = null;
  hostBus = new EventTarget();     // drops the listeners of screens that are gone
}

// ================================================================ setup
export async function renderLiveSetup(root, ctx) {
  const { exam, topics, questions } = ctx;
  const status = await call('/api/live/status').catch(() => ({ active: false }));
  const pool = questions.filter(usable);
  const topicN = (id) => pool.filter((q) => q.topic === id).length;
  const state = { topics: new Set(), count: 10, seconds: 20, plays: false, late: false, nick: '' };
  try { state.nick = localStorage.getItem(NICK_KEY) || ''; } catch { /* ignore */ }

  const summary = h('p', { class: 'setup-summary', role: 'status' });
  const error = h('p', { class: 'live-error', role: 'alert' });
  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('radio', 22), 'Open the lobby');
  const poolNow = () => pool.filter((q) => state.topics.size === 0 || state.topics.has(q.topic));
  const refresh = () => {
    const n = poolNow().length, take = Math.min(state.count, n);
    summary.textContent = n ? (n < state.count ? `Only ${n} questions match: the game will use all of them` : `${take} of ${n} matching questions · ${state.seconds} s each`) : 'No questions match these topics';
    startBtn.disabled = !n || status.active;
  };

  const toggle = (label, on, count, onToggle) => {
    const b = h('button', { class: 'toggle', type: 'button', 'aria-pressed': String(on) },
      h('span', { class: 'box' }, icon('check', 14)), h('span', { class: 't' }, label), count != null ? h('span', { class: 'count' }, count) : null);
    b.addEventListener('click', () => { b.setAttribute('aria-pressed', String(onToggle())); refresh(); });
    return { btn: b, obj: FX.obj(b, { cls: 'o-tile', tilt: 0, z: 10 }) };
  };
  const segmented = (options, current, onPick) => {
    const items = options.map(([val, label]) => {
      const b = h('button', { class: 'pill-btn', type: 'button', 'aria-pressed': String(val === current) }, label);
      b.addEventListener('click', () => { onPick(val); items.forEach(([v, x]) => x.querySelector('.pill-btn').setAttribute('aria-pressed', String(v === val))); refresh(); });
      return [val, FX.obj(b, { cls: 'o-pill' })];
    });
    return h('div', { class: 'pills' }, items.map(([, o]) => o));
  };

  const topicToggles = topics.filter((t) => topicN(t.id)).map((t) => toggle(t.title, false, topicN(t.id), () => {
    state.topics.has(t.id) ? state.topics.delete(t.id) : state.topics.add(t.id);
    return state.topics.has(t.id);
  }));
  const clear = h('button', { class: 'btn', type: 'button' }, 'Clear selection');
  clear.addEventListener('click', () => { state.topics.clear(); topicToggles.forEach((t) => t.btn.setAttribute('aria-pressed', 'false')); refresh(); });

  // "I'm playing too"
  const nickIn = h('input', { class: 'face', type: 'text', maxlength: '16', placeholder: 'Your nickname', 'aria-label': 'Your nickname', autocomplete: 'off', value: state.nick });
  const nickField = h('div', { class: 'nick-field', hidden: true }, h('span', { class: 'lab' }, 'Your nickname'), FX.obj(nickIn, { cls: 'o-input', hover: false }));
  nickIn.addEventListener('input', () => { state.nick = nickIn.value; });
  const playsToggle = toggle('I am playing too', false, null, () => { state.plays = !state.plays; nickField.hidden = !state.plays; if (state.plays) nickIn.focus(); return state.plays; });

  const lateToggle = toggle('Allow late joiners (start at 0 points)', false, null, () => { state.late = !state.late; return state.late; });

  startBtn.addEventListener('click', async (e) => {
    error.textContent = '';
    if (state.plays && !state.nick.trim()) { error.textContent = 'Pick a nickname for yourself, or turn off "I am playing too".'; nickIn.focus(); return; }
    startBtn.disabled = true;
    try {
      await call('/api/live/create', { examId: exam.id, topicIds: [...state.topics], count: state.count, seconds: state.seconds, hostPlays: state.plays, hostNick: state.nick, allowLate: state.late });
      if (state.plays) try { localStorage.setItem(NICK_KEY, state.nick.trim()); } catch { /* ignore */ }
      FX.navigate(`#/exam/${exam.id}/live/host`, { x: e.clientX, y: e.clientY });
    } catch (ex) { error.textContent = ex.message; refresh(); }
  });

  let busyNote = null;
  const endNote = notice ? h('div', { class: 'live-note hard' }, icon('radio', 22), h('div', null, notice)) : null;
  notice = null;
  if (status.active) {
    const resume = h('a', { class: 'btn', href: `#/exam/${status.examId}/live/host` }, 'Go to the running game');
    const endBtn = h('button', { class: 'btn alt', type: 'button' }, 'End it');
    endBtn.addEventListener('click', async () => { await act('end').catch(() => {}); FX.navigate(`#/exam/${exam.id}/live`); });
    busyNote = h('div', { class: 'live-note busy hard' }, icon('radio', 22),
      h('div', null, h('strong', null, `A live game is already running (${status.title}).`), ' Only one game can run at a time.',
        h('div', { class: 'row' }, FX.obj(resume, { cls: 'o-btn' }), FX.obj(endBtn, { cls: 'o-btn' }))));
  }

  const sections = [
    endNote,
    busyNote,
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Topics', FX.obj(clear, { cls: 'o-btn' })), h('div', { class: 'togglegrid' }, topicToggles.map((t) => t.obj))),
    h('div', { class: 'two-col' },
      h('section', { class: 'field' }, h('h2', { class: 'small' }, 'How many questions'), segmented(COUNTS.map((c) => [c, c]), state.count, (v) => { state.count = v; })),
      h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Seconds per question'), segmented(SECONDS.map((c) => [c, c]), state.seconds, (v) => { state.seconds = v; }))),
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Players'), h('div', { class: 'togglegrid' }, playsToggle.obj, lateToggle.obj), nickField),
    h('div', { class: 'start-row' }, FX.obj(startBtn, { cls: 'o-btn' }), summary),
    error,
  ].filter(Boolean);
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Live Quiz'),
    h('p', { class: 'lead' }, 'Host a game for your friends. They join on their phones with a code, you run it from this screen. Multiple choice and true/false questions from this exam only; nothing changes your solo progress.'),
    sections);
  refresh();
  FX.enter(sections, { y: 30, delay: FX.base(), stagger: 0.07, spring: FX.spring.soft });
}

// ================================================================ host view
export function renderLiveHost(root, { setAccent, leave }) {
  destroyLive();
  endedByMe = false;
  mount(root, h('p', { class: 'fine' }, 'Connecting to the game…'));
  let shell = null;

  const open = () => {
    hostES?.close();
    lastMsg = Date.now();
    const es = hostES = new EventSource('/api/live/events');
    es.onopen = () => { offlinePill?.remove(); offlinePill = null; };
    es.onerror = () => {
      if (!shell || offlinePill) return;
      offlinePill = h('div', { class: 'conn-pill', role: 'status' }, 'Lost contact with the server…');
      document.body.append(offlinePill);
    };
    es.addEventListener('ping', () => { lastMsg = Date.now(); });
    es.onmessage = (e) => {
      if (es !== hostES) return;
      lastMsg = Date.now();
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.ended) {
        if (!endedByMe) notice = 'There is no live game running (it ended, or the app was restarted). Start a new one when you are ready.';
        destroyLive(); leave(); return;
      }
      setAccent(m.exam);
      if (!shell) { shell = buildShell(root, m); }
      shell.update(m);
    };
  };
  open();
  // A dead connection (the laptop slept, Wi-Fi changed) can look open for a long time: no message or ping for 30 s, or coming back to the tab, starts over.
  watchTimer = setInterval(() => { if (document.visibilityState === 'visible' && (hostES?.readyState === 2 || Date.now() - lastMsg > 30000)) open(); }, 5000);
  visHandler = () => { if (document.visibilityState === 'visible') open(); };
  document.addEventListener('visibilitychange', visHandler);
  keyHandler = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,textarea,select,button,a,[contenteditable]')) return;
    if (shell?.key(e)) e.preventDefault();
  };
  window.addEventListener('keydown', keyHandler);
}

const doAct = (action, extra) => act(action, extra).catch(() => {});

/** Which screen a message belongs to. The question and its reveal are one screen, so the answer lights up in place. */
function screenName(m) {
  if (m.phase === 'question' || m.phase === 'reveal') return `round:${m.q.index}`;
  if (m.phase === 'ready') return `ready:${m.q.index}`;
  if (m.phase === 'board') return `board:${m.progress.index}`;
  return m.phase;
}
const FACTORY = { round: (m) => roundScreen(m, doAct), ready: (m) => readyScreen(m), board: (m) => boardScreen(m, doAct), podium: (m) => podiumScreen(m, doAct), lobby: () => lobbyScreen() };

function buildShell(root, first) {
  const examId = first.exam.id;
  const title = h('h1', { class: 'pagetitle' }, 'Live Quiz');
  const meta = h('div', { class: 'chips', style: { marginTop: '14px' } });
  const net = netBar();
  const stage = h('div', { class: 'stage' });
  const back = h('a', { class: 'back', href: `#/exam/${examId}` }, icon('arrow-left', 14), first.exam.title);
  mount(root, back, title, meta, h('div', { class: 'netwrap' }, net.obj), stage);
  let screen = null, name = '';
  return {
    key: (e) => !!screen?.key?.(e),
    update(m) {
      const inGame = m.phase !== 'lobby';
      title.hidden = meta.hidden = back.hidden = inGame;      // more room for the question on the big screen
      meta.replaceChildren(
        h('span', { class: 'chip accent' }, m.exam.shortTitle),
        h('span', { class: 'chip' }, `${m.settings.count} questions`), h('span', { class: 'chip' }, `${m.settings.seconds} s each`));
      net.update(m);
      const next = screenName(m);
      if (next !== name) {
        screen?.destroy?.();
        name = next;
        screen = FACTORY[name.split(':')[0]](m);
        mount(stage, screen.el);
        screen.enter?.();
      }
      screen.update(m);
    },
  };
}

// ---------------------------------------------------------------- network bar: who can reach this game, and the stop switch
function netBar() {
  const text = h('span', null);
  const dot = h('i', { class: 'dot' });
  const addr = h('div', { class: 'addr' });
  const sw = h('button', { class: 'toggle', type: 'button', 'aria-pressed': 'true' }, h('span', { class: 'box' }, icon('check', 14)), h('span', { class: 't' }, 'Phones can join'));
  const face = h('div', { class: 'netbar hard' }, h('div', { class: 'state', role: 'status' }, dot, text), addr, sw);
  let lanOn = true, lastM = null;
  const bus = hostBus;
  bus.addEventListener('addr', () => lastM && update(lastM));
  sw.addEventListener('click', async () => { try { await act('lan', { on: !lanOn }); } catch (ex) { text.textContent = ex.message; } });
  const obj = FX.obj(face, { cls: 'o-card', hover: false });
  function update(m) {
      lastM = m;
      const n = m.net;
      lanOn = n.lan;
      sw.setAttribute('aria-pressed', String(n.lan));
      sw.disabled = n.lanForcedOff;
      face.classList.toggle('off', (!n.lan && !n.publicUrl) || !!n.error);
      if (n.error) text.textContent = n.error;
      else if (n.publicUrl) text.textContent = `Phones join at ${bareUrl(n.publicUrl)} (your tunnel)` + (n.lan ? '' : ' · local network blocked, the tunnel still works until you stop it');
      else if (n.lanForcedOff) text.textContent = 'Phones are blocked (LIVE_LAN=off). This computer only.';
      else if (!n.lan) text.textContent = 'Phones are blocked. Only this computer can reach the game.';
      else if (!n.addresses.length) text.textContent = 'No network address found. Connect this computer to Wi-Fi, then turn this off and on.';
      else text.textContent = `Phones can join at ${bareUrl(n.addresses[Math.min(selected, n.addresses.length - 1)].url)}` + (m.settings.allowLate && m.phase !== 'lobby' ? ` · code ${m.code} (late joiners welcome)` : '');
      if (n.addresses.length > 1) {
        addr.replaceChildren(...n.addresses.map((a, i) => {
          const b = h('button', { class: 'pill-btn', type: 'button', 'aria-pressed': String(i === selected), title: a.name }, a.address);
          b.addEventListener('click', () => { selected = i; bus.dispatchEvent(new Event('addr')); });
          return b;
        }));
      } else addr.replaceChildren();
  }
  return { obj, update };
}

// ---------------------------------------------------------------- lobby: code, QR, players, Start
function lobbyScreen() {
  const urlEl = h('div', { class: 'join-url' });
  const codeEl = h('div', { class: 'join-code' });
  const qrBox = h('div', { class: 'qr-tile' });
  const card = h('div', { class: 'join-card hard' },
    h('div', { class: 'code-col' }, h('span', { class: 'lab' }, 'Open this on your phone'), urlEl),
    qrBox,
    h('div', { class: 'code-col' }, h('span', { class: 'lab' }, 'Then enter the code'), codeEl));
  const count = h('span', { class: 'lab' });
  const chips = h('div', { class: 'pchips' });
  const empty = h('div', { class: 'empty-players' }, FX.mascot(), h('span', null, 'Waiting for the first player…'));
  const players = h('div', { class: 'players-card hard' }, h('h2', null, 'Players', count), empty, chips);
  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('play', 22), 'Start game');
  const endBtn = h('button', { class: 'btn alt', type: 'button' }, 'End game');
  const note = h('p', { class: 'setup-summary', role: 'status' });
  const seatLink = h('a', { class: 'btn', href: '#', target: '_blank', rel: 'noopener' }, icon('external-link', 16), 'Open my player screen');
  const seatObj = FX.obj(seatLink, { cls: 'o-btn' });
  seatObj.hidden = true;
  const actions = h('div', { class: 'lobby-actions' }, FX.obj(startBtn, { cls: 'o-btn' }), seatObj, FX.obj(endBtn, { cls: 'o-btn' }), note);
  startBtn.addEventListener('click', async () => { note.textContent = ''; try { await act('start'); } catch (ex) { note.textContent = ex.message; } });
  let armed = false;
  endBtn.addEventListener('click', async () => {
    if (!armed) { armed = true; endBtn.textContent = 'Click again to end'; setTimeout(() => { armed = false; endBtn.textContent = 'End game'; }, 3500); return; }
    await act('end').catch(() => {});
  });

  // "Phones can't connect?" help (live-help.js)
  const help = helpPanel({ act });

  const el = h('div', null,
    h('div', { class: 'lobby' }, FX.obj(card, { cls: 'o-card', hover: false }), FX.obj(players, { cls: 'o-card', hover: false })),
    actions, h('div', { style: { marginTop: '20px' } }, FX.obj(help.btn, { cls: 'o-pill' })), help.panel);

  let lastM = null, lastQr = '';
  const bus = hostBus;
  bus.addEventListener('addr', () => lastM && screenUpdate(lastM));

  function screenUpdate(m) {
    lastM = m;
    const n = m.net;
    const a = n.publicUrl ? { url: n.publicUrl, joinUrl: n.publicJoinUrl }
      : n.lan && n.addresses.length ? n.addresses[Math.min(selected, n.addresses.length - 1)] : null;
    urlEl.textContent = a ? bareUrl(a.url) : bareUrl(n.localUrl);
    urlEl.classList.toggle('long', !!a && bareUrl(a.url).length > 24);
    help.update(m);
    codeEl.textContent = m.code;
    // QR: only redrawn when the address it points to changes
    const target = a ? a.joinUrl : '';
    if (target !== lastQr) {
      lastQr = target;
      if (!target) { qrBox.className = 'qr-tile empty'; qrBox.replaceChildren(document.createTextNode(n.lan ? 'No network address' : 'Phones blocked')); } else {
        loadQr().then(() => { if (lastQr === target) { qrBox.className = 'qr-tile'; qrBox.replaceChildren(qrSvg(target)); } })
          .catch(() => { qrBox.className = 'qr-tile empty'; qrBox.textContent = 'QR failed to load'; });
      }
    }
    // players
    const list = m.players;
    const live = list.filter((p) => !p.away && !p.left).length;
    count.textContent = `${live} here`;
    empty.hidden = list.length > 0;
    const have = new Map([...chips.children].map((c) => [c.dataset.id, c]));
    const ids = new Set(list.map((p) => p.id));
    for (const [id, c] of have) if (!ids.has(id)) c.remove();
    list.forEach((p, i) => {
      let c = have.get(p.id);
      if (!c) {
        const kick = h('button', { class: 'kick', type: 'button', 'aria-label': `Remove ${p.nick}` }, icon('x', 14));
        kick.addEventListener('click', () => act('kick', { id: p.id }).catch(() => {}));
        c = h('span', { class: `pchip c${hue(p.id)}`, 'data-id': p.id }, h('span', { class: 'nm' }, p.nick), p.isHost ? h('span', { class: 'tag' }, 'host') : null, kick);
        FX.anim(c, { scale: [0.5, 1], rotate: [(i % 2 ? 6 : -6), 0], opacity: [0, 1] }, FX.spring.bouncy);
        FX.sound('pop');
      }
      c.classList.toggle('away', p.away);
      if (chips.children[i] !== c) chips.insertBefore(c, chips.children[i] || null);
    });
    // actions
    startBtn.disabled = live === 0;
    note.textContent = live === 0 ? 'Waiting for players…' : `${live} ${live === 1 ? 'player' : 'players'} ready · ${m.settings.count} questions · ${m.settings.seconds} s each`;
    seatObj.hidden = !m.seat;
    if (m.seat) seatLink.href = m.seat.url;
  }

  return {
    el,
    enter() { FX.enter([...el.querySelectorAll('.lobby > .obj')], { y: 34, delay: FX.base(), stagger: 0.08, spring: FX.spring.soft }); },
    update: screenUpdate,
  };
}
