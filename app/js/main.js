// Hash router, top bar, home screen and the per-exam overview. Each exam is loaded and shown on its own.
import { h, mount, download, dateStamp, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress, questionStat, exportProgress, importProgress, resetProgress, weakTopicIds } from './store.js';
import { renderQuizSetup } from './quiz.js';
import { destroyActiveCard } from './question.js';
import { renderCardsHome, cardStatus, destroyCardSession } from './flashcards.js';
import { renderWeak, weakCounts } from './weak.js';
import { renderProgress } from './progress-view.js';
import { renderSimSetup, destroySim } from './simulation.js';
import { renderGamesHub, renderGameIntro, destroyGame } from './games.js';
import { renderLiveSetup, renderLiveHost, destroyLive } from './live.js';

const M = window.Motion;
const root = document.getElementById('view');
const switcher = document.getElementById('switcher');
const tools = document.getElementById('tools');
let exams = [];
let wiggled = false;

async function api(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const html = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const ico = (name, size) => icon(name, size).outerHTML;

/** The whole page takes the exam's colour (it blends smoothly), or the default yellow on the home screen. */
function setAccent(exam) {
  if (exam) document.body.style.setProperty('--accent', exam.accent); else document.body.style.removeProperty('--accent');
  switcher.querySelectorAll('a').forEach((a) => a.setAttribute('aria-current', String(!!exam && a.dataset.exam === exam.id)));
}

// ---------------------------------------------------------------- top bar
function buildTopbar() {
  mount(switcher, exams.map((e) => {
    const short = e.shortTitle || e.title;
    const a = h('a', { href: `#/exam/${e.id}`, 'data-exam': e.id, 'data-accent': e.accent, style: { '--pill': e.accent }, 'aria-current': 'false' },
      h('span', { class: 'swatch' }), h('span', { class: 'full' }, short), h('span', { class: 'tiny' }, short.split(/[ &]/)[0]));
    return FX.obj(a, { cls: 'o-pill' });
  }));

  const mkTool = (id) => h('button', { class: 'icon-btn', id, type: 'button' });
  const sound = mkTool('fx-sound'), motion = mkTool('fx-motion'), cursor = mkTool('fx-cursor'), theme = mkTool('theme');
  mount(tools, [sound, motion, cursor, theme].map((b) => FX.obj(b, { cls: 'o-icon' })));
  const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const paint = () => {
    const set = (b, ic, label, on) => { b.replaceChildren(icon(ic, 18)); b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); b.title = label; };
    set(sound, FX.prefs.sound === 'on' ? 'volume-2' : 'volume-x', FX.prefs.sound === 'on' ? 'Sound on (click to mute)' : 'Sound off (click to turn on)', FX.prefs.sound === 'on');
    set(motion, FX.reduced() ? 'zap-off' : 'zap', FX.reduced() ? 'Motion reduced (click for full motion)' : 'Full motion (click to reduce)', !FX.reduced());
    set(cursor, 'mouse-pointer-2', FX.prefs.cursor === 'on' ? 'Marker cursor on' : 'Marker cursor off', FX.prefs.cursor === 'on');
    theme.replaceChildren(icon(isDark() ? 'sun' : 'moon', 18)); theme.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  };
  sound.addEventListener('click', () => { FX.set('sound', FX.prefs.sound === 'on' ? 'off' : 'on'); FX.sound('pop'); paint(); });
  motion.addEventListener('click', () => { FX.set('reduce', FX.reduced() ? 'off' : 'on'); paint(); });
  cursor.addEventListener('click', () => { FX.set('cursor', FX.prefs.cursor === 'on' ? 'off' : 'on'); paint(); });
  theme.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('learnathanze:theme', next); } catch { /* ignore */ }
    paint();
  });
  paint();

  // Easter egg: poking the logo square makes it spin.
  const sq = document.querySelector('.mark-sq');
  sq.append(icon('graduation-cap', 15));
  sq.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    FX.sound('pop');
    FX.anim(sq, { rotate: [-4, 716] }, { type: 'spring', stiffness: 60, damping: 9 });
    const r = sq.getBoundingClientRect();
    FX.confetti(r.left + r.width / 2, r.top + r.height / 2, { count: 10 });
  });
}

function errorView(err) {
  setAccent(null);
  mount(root, h('h1', { class: 'pagetitle' }, 'Something went wrong'),
    h('div', { class: 'error-box' }, h('p', null, err.message),
      h('p', null, 'If you edited a content file, check it for a typo (run "npm run validate" to find it), then reload.')));
}

// ---------------------------------------------------------------- home
async function renderHome() {
  setAccent(null);
  const list = exams.length ? exams : await api('/api/exams');
  const full = await Promise.all(list.map((e) => api(`/api/exams/${e.id}`)));
  const tiles = list.map((e, k) => {
    const due = cardStatus(full[k]).due;
    const practised = Object.keys(loadProgress(e.id).questions).length;
    const face = h('a', { class: 'home-tile', href: `#/exam/${e.id}`, 'data-accent': e.accent, style: { '--tile': e.accent } },
      h('div', null, h('h2', null, e.title), h('p', null, e.description)),
      h('div', { class: 'chips' }, h('span', { class: 'chip' }, `${e.questionCount} questions`), h('span', { class: 'chip' }, `${practised} practised`), h('span', { class: 'chip' }, `${due} ${due === 1 ? 'card' : 'cards'} due today`)));
    return FX.obj(face, { cls: 'o-tile', tilt: 6, shine: true, fill: true, z: 14 });
  });
  mount(root,
    h('h1', { class: 'pagetitle' }, 'Choose an exam'),
    h('p', { class: 'lead' }, 'Each exam keeps its own questions, progress and statistics. Nothing is shared between them.'),
    h('div', { class: 'home-grid' }, tiles));
  FX.enter(tiles, { delay: FX.base(), stagger: 0.09 });
}

// ---------------------------------------------------------------- exam overview
const DECO = `
  <div class="layer l-cube" data-depth="26"><div class="drift"><div class="cube"><i class="f1"></i><i class="f2"></i><i class="f3"></i><i class="f4"></i><i class="f5"></i><i class="f6"></i></div></div></div>
  <div class="layer l-star" data-depth="40"><div class="drift"><svg width="58" height="58" viewBox="0 0 20 20"><polygon points="10,1 12.6,7.2 19,7.8 14.2,12.2 15.6,18.6 10,15.2 4.4,18.6 5.8,12.2 1,7.8 7.4,7.2" fill="#ffd83d" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg></div></div>
  <div class="layer l-pencil" data-depth="56"><div class="drift"><svg width="30" height="84" viewBox="0 0 30 84"><g transform="rotate(24 15 42)"><rect x="3" y="4" width="24" height="9" rx="3" fill="#ff9f7a" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="24" height="7" fill="#8fdbff" stroke="currentColor" stroke-width="2"/><rect x="3" y="20" width="24" height="42" fill="#ffd83d" stroke="currentColor" stroke-width="2"/><path d="M3 62 L15 82 L27 62 Z" fill="#fffdf8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 74 L15 82 L19 74 Z" fill="#141414"/></g></svg></div></div>
  <div class="layer l-dot" data-depth="18"><div class="drift"><i></i></div></div>`;

async function renderExam(id) {
  const data = await api(`/api/exams/${id}`);
  const { exam, topics, questions } = data;
  setAccent(exam);
  const progress = loadProgress(id);
  const seen = questions.map((q) => questionStat(progress, q.id)).filter((s) => s.seen);
  const accuracy = pct(seen.reduce((s, x) => s + x.accuracy, 0), seen.length);
  const weak = weakTopicIds(progress, questions, topics).length;
  const status = h('p', { class: 'fine', role: 'status', style: { marginTop: '14px' } });

  // hero
  const goBtn = h('a', { class: 'btn yellow xl', href: `#/exam/${id}/quiz` }, icon('play', 22), seen.length ? 'Continue quiz' : 'Start quiz');
  const goObj = FX.obj(goBtn, { cls: 'o-btn' });
  const notesBtn = h('button', { class: 'chip', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'notes' }, icon('info', 14), ` Material notes (${(exam.gaps || []).length}) `, h('span', { class: 'chev' }, icon('chevron-down', 14)));
  const heroFace = h('div', { class: 'hero' },
    h('div', { class: 'deco', 'aria-hidden': 'true' }),
    h('div', { class: 'hero-main' },
      h('h1', null, exam.title), h('p', { class: 'sub' }, exam.description),
      h('div', { class: 'chips' }, h('span', { class: 'chip', title: exam.examFormat || '' }, icon('book-open', 14), ` ${exam.examFormatShort || 'Exam format'}`), FX.obj(notesBtn, { cls: 'o-pill' }))),
    goObj);
  heroFace.querySelector('.deco').innerHTML = DECO;
  const heroObj = FX.obj(heroFace, { cls: 'o-hero', tilt: 4, shine: true, z: 0 });

  // material notes panel (collapsed)
  const notes = html(`<div class="notes" id="notes" data-open="false"><div><div class="note-card">
    <h2>${ico('triangle-alert', 20)} Where your course material is thin or missing</h2><ul></ul></div></div></div>`);
  (exam.gaps || []).forEach((g) => notes.querySelector('ul').append(h('li', null, h('span', { class: 'warn-badge' }, icon('triangle-alert', 13)), h('span', null, g))));
  notesBtn.addEventListener('click', () => {
    const open = notesBtn.getAttribute('aria-expanded') !== 'true';
    notesBtn.setAttribute('aria-expanded', String(open)); notes.dataset.open = String(open); FX.sound('click');
  });

  // stat tiles
  const tile = (cls, label, ic, to, small, rot) => FX.obj(h('div', { class: `tile ${cls}` },
    h('div', { class: 'top' }, h('span', { class: 'lab' }, label), icon(ic, 22)),
    h('div', { class: 'big' }, h('span', { class: 'cnt', 'data-to': to }, String(to)), h('small', null, small))),
  { cls: 'o-tile', tilt: 8, shine: true, fill: true, z: 16, rot });
  const tiles = [
    tile('cream', 'Practised', 'book-open-check', seen.length, `/ ${questions.length}`),
    tile('yellow', 'Accuracy', 'target', accuracy, '%', 1),
    tile('coral', 'Current streak', 'flame', progress.streak, 'in a row'),
    tile('lilac', 'Weak topics', 'triangle-alert', weak, 'to review', -1),
  ];
  const stats4 = h('section', { class: 'stats', 'aria-label': 'Your progress' }, tiles);

  // study modes: only the ones that exist
  const due = cardStatus(data).due;
  const live = await api('/api/live/status').catch(() => ({ active: false }));
  const weakNow = weakCounts(data);
  const weakN = weakNow.questions + weakNow.cards;
  const modes = [
    FX.obj(h('a', { class: 'mode coral', href: `#/exam/${id}/quiz` },
      icon('list-checks', 40), h('div', null, h('h3', null, 'Quiz'), h('p', null, 'Questions by topic or a random mix.'))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }),
    FX.obj(h('a', { class: 'mode lilac', href: `#/exam/${id}/cards` },
      h('div', { class: 'mode-top' }, icon('layers', 40), h('span', { class: 'chip' }, `${due} due today`)),
      h('div', null, h('h3', null, 'Flashcards'), h('p', null, 'Spaced repetition. Cards you miss come back sooner.'))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }),
    FX.obj(h('a', { class: 'mode sky', href: `#/exam/${id}/weak` },
      h('div', { class: 'mode-top' }, icon('crosshair', 40), h('span', { class: 'chip' }, `${weakN} to fix`)),
      h('div', null, h('h3', null, 'Weak spots'), h('p', null, 'Practise what you keep missing.'))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }),
    FX.obj(h('a', { class: 'mode cream', href: `#/exam/${id}/simulation` },
      icon('timer', 40), h('div', null, h('h3', null, 'Exam simulation'), h('p', null, 'A timed run through mixed questions, with one score at the end.'))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }),
    FX.obj(h('a', { class: 'mode accent', href: `#/exam/${id}/games` },
      icon('gamepad-2', 40), h('div', null, h('h3', null, 'Mini games'), h('p', null, 'Match up, sort, speed round and combo run.'))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }),
    FX.obj(h('a', { class: 'mode yellow', href: `#/exam/${id}/progress` },
      icon('chart-column', 40), h('div', null, h('h3', null, 'Progress'), h('p', null, 'Accuracy over time, mastery per topic, streaks.'))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }),
    FX.obj(h('a', { class: 'mode coral', href: `#/exam/${id}/live` },
      h('div', { class: 'wide-main' }, icon('radio', 40), h('div', null, h('h3', null, 'Live Quiz'), h('p', null, 'Host a game on this screen. Friends join on their phones with a code.'))),
      h('span', { class: 'chip' }, live.active ? 'Hosting now' : 'Multiplayer')),
    { cls: 'o-mode o-wide', tilt: 4, shine: true, z: 18 }),
  ];

  // topics
  const rows = topics.map((t) => {
    const qs = questions.filter((q) => q.topic === t.id);
    const mastered = qs.filter((q) => questionStat(progress, q.id).mastered).length;
    const p = qs.length ? Math.round((mastered / qs.length) * 100) : 0;
    const warnText = t.note || (t.coverage === 'thin' || t.coverage === 'missing' ? 'Thin material for this topic.' : '');
    const face = h(qs.length ? 'a' : 'div', { class: 'trow', href: qs.length ? `#/exam/${id}/quiz?topic=${t.id}` : null },
      h('span', { class: 'name' }, t.title, warnText ? h('span', { class: 'warn-badge', title: warnText }, icon('triangle-alert', 13)) : null),
      h('span', { class: 'count' }, qs.length ? `${qs.length} questions` : 'no questions'),
      h('span', { class: 'segs', 'data-filled': Math.round(p / 10), 'aria-label': `${p}% mastered` }, Array.from({ length: 10 }, () => h('i'))),
      h('span', { class: 'pct' }, mastered ? `${p}%` : '–'));
    face.addEventListener('pointerenter', () => FX.wave(face.querySelector('.segs')));
    return h('li', null, FX.obj(face, { cls: 'o-row', z: 10 }));
  });

  // progress tools
  const importInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    try { importProgress(id, await file.text()); renderExam(id); } catch (e) { status.textContent = e.message; }
  });
  let armed = false;
  const resetBtn = h('button', { class: 'btn alt', type: 'button' }, 'Reset progress');
  resetBtn.addEventListener('click', () => {
    if (!armed) { armed = true; resetBtn.textContent = 'Click again to confirm'; setTimeout(() => { armed = false; resetBtn.textContent = 'Reset progress'; }, 4000); return; }
    resetProgress(id); renderExam(id);
  });
  const exportBtn = h('button', { class: 'btn', type: 'button' }, 'Export progress');
  exportBtn.addEventListener('click', () => download(`learnathanze-${id}-progress-${dateStamp()}.json`, exportProgress(id)));
  const importBtn = h('button', { class: 'btn', type: 'button' }, 'Import progress');
  importBtn.addEventListener('click', () => importInput.click());

  const freshNote = seen.length === 0
    ? h('div', { class: 'fresh-note' }, FX.mascot(), h('div', { class: 'bubble' }, 'Nothing practised yet. Start with any topic, or a random mix.'))
    : null;

  const topicList = h('ul', { class: 'topics' }, rows);
  mount(root,
    h('section', { class: 'bento' }, heroObj), notes, stats4, freshNote,
    h('h2', { class: 'section' }, 'Ways to study'), h('div', { class: 'modes' }, modes),
    h('h2', { class: 'section' }, 'Topics', h('span', { class: 'lab' }, 'Pick one to practise')), topicList,
    h('h2', { class: 'section' }, 'Your progress'),
    h('p', { class: 'fine' }, 'Saved in this browser only. Export a backup now and then.'),
    h('div', { class: 'tools-row' }, FX.obj(exportBtn, { cls: 'o-btn' }), FX.obj(importBtn, { cls: 'o-btn' }), FX.obj(resetBtn, { cls: 'o-btn' }), importInput), status);

  // entrance: hero drops, tiles drop in 60ms apart with counting numbers, then modes and rows
  const base = FX.base();
  FX.enter([heroObj], { y: -80, rotate: -2, delay: base, spring: FX.spring.deal });
  FX.enter(tiles, { delay: base + 0.16, stagger: 0.06 });
  stats4.querySelectorAll('.cnt').forEach((c, k) => FX.count(c, +c.dataset.to, { duration: 0.95, delay: base + 0.3 + k * 0.06 }));
  FX.enter(modes, { y: 40, delay: base + 0.5, stagger: 0.06 });
  FX.enter(rows, { y: 28, delay: base + 0.62, stagger: 0.03, spring: FX.spring.soft });
  topicList.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.95 + k * 0.03 }));

  // floating bits in the hero: slow drift and parallax (not created at all when motion is reduced)
  if (!FX.reduced()) {
    const layers = [...heroFace.querySelectorAll('.deco .layer')];
    layers.forEach((l, k) => M.animate(l.querySelector('.drift'), { y: [0, -9, 0], rotate: k === 1 ? [-6, 8, -6] : [0, 3, 0] }, { duration: 3.2 + k * 0.7, repeat: Infinity, ease: 'easeInOut' }));
    M.animate(heroFace.querySelector('.cube'), { rotateX: -24, rotateY: [30, 390] }, { duration: 16, repeat: Infinity, ease: 'linear' });
    FX.parallax(heroFace, layers);
  }
  // "Continue quiz" wiggles once, the first time the exam page loads
  if (!wiggled && !FX.reduced()) {
    wiggled = true;
    setTimeout(() => { if (goObj.isConnected) M.animate(goObj, { rotate: [0, -3, 3, -2, 1.5, 0], y: [0, -6, 0] }, { duration: 0.6, ease: 'easeOut' }); }, (base + 1.5) * 1000);
  }
}

async function renderQuiz(id, query) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  const topic = query.get('topic');
  renderQuizSetup(root, data, { topics: topic ? topic.split(',') : [] });
}

async function renderCards(id) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  renderCardsHome(root, data);
}

async function renderWeakSpots(id) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  renderWeak(root, data);
}

async function renderProgressView(id) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  renderProgress(root, data);
}

async function renderSimulation(id) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  renderSimSetup(root, data);
}

async function renderGames(id, game) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  if (game) renderGameIntro(root, data, game); else renderGamesHub(root, data);
}

async function renderLive(id) {
  const data = await api(`/api/exams/${id}`);
  setAccent(data.exam);
  await renderLiveSetup(root, data);
}

function renderLiveHostView(id) {
  renderLiveHost(root, { setAccent, leave: () => FX.navigate(`#/exam/${id}/live`) });
}

async function route() {
  destroyLive();
  destroyActiveCard();
  destroyCardSession();
  destroySim();
  destroyGame();
  const [path, q] = (location.hash.slice(1) || '/').split('?');
  const query = new URLSearchParams(q || '');
  try {
    let m;
    if (path === '/' || path === '') await renderHome();
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)$/))) await renderExam(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/quiz$/))) await renderQuiz(m[1], query);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/cards$/))) await renderCards(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/weak$/))) await renderWeakSpots(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/progress$/))) await renderProgressView(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/simulation$/))) await renderSimulation(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/games$/))) await renderGames(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/games\/(match|sort|speed|combo)$/))) await renderGames(m[1], m[2]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/live$/))) await renderLive(m[1]);
    else if ((m = path.match(/^\/exam\/([a-z0-9-]+)\/live\/host$/))) renderLiveHostView(m[1]);
    else { setAccent(null); mount(root, h('p', { class: 'lead' }, 'This page does not exist. ', h('a', { href: '#/', class: 'back' }, 'Go to the exam list'))); }
    window.scrollTo(0, 0);
  } catch (e) {
    errorView(e);
  }
  window.dispatchEvent(new Event('fx:routed'));
}

FX.reroute = route;

(async function boot() {
  FX.boot();
  try { exams = await api('/api/exams'); } catch (e) { errorView(e); return; }
  buildTopbar();
  window.addEventListener('hashchange', route);
  route();
})();
