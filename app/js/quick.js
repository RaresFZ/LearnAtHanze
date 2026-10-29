// Speed round and Combo run: one short multiple-choice or true/false question at a time, from the exam's own questions.
//   speed: 60 seconds on the clock, a wrong answer takes 3 seconds off, the score is the number you got right
//   combo: 3 lives, no clock, each answer is worth 10 x a multiplier that grows with your streak
// Answers count toward your accuracy and weak spots like any other answer (but not toward the carried-over streak).
import { h, mount, shuffle } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { recordGame } from './store.js';
import { quickPool, SPEED, COMBO, comboStart, comboAnswer, comboOver, multiplier, speedPenalty } from './games-data.js';
import { gameTop, statChip, startSession, renderGameResult, posOf, centreOf } from './game-ui.js';

const M = window.Motion;
const MILESTONE = 3;                                        // multiplier steps that get a bigger celebration

export function runQuick(root, ctx, mode) {
  const { exam } = ctx;
  const isSpeed = mode === 'speed';
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  let pool = shuffle(quickPool(ctx.questions)), idx = 0;
  let over = false, locked = false, cur = null;
  let combo = comboStart(), right = 0, wrong = 0;
  const log = [];                                           // { id, score } for every answer
  const t0 = Date.now();
  let endAt = t0 + SPEED.seconds * 1000;

  const top = gameTop((e) => finish(true, posOf(e, top.el)));
  const scoreChip = statChip(isSpeed ? 'Right' : 'Score', 0);
  const timerEl = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' }, icon('timer', 20), h('span', { class: 't' }, `${SPEED.seconds}`));
  const lives = h('span', { class: 'lives', role: 'img', 'aria-label': `${COMBO.lives} lives` }, Array.from({ length: COMBO.lives }, () => h('i', { class: 'on' })));
  const mult = h('b', null, '1');
  const sticker = h('span', { class: 'sticker' }, icon('flame', 16), ' x', mult);
  const mascot = FX.mascot();
  if (isSpeed) top.right.append(scoreChip.el, timerEl); else top.right.append(scoreChip.el, sticker, lives);
  top.right.prepend(mascot);

  const slot = h('div', { class: 'quick-slot' });
  const deck = h('div', { class: 'deck' }, slot);
  mount(root, h('div', { class: 'quiz-wrap game-wrap' }, top.el, deck,
    h('p', { class: 'fine game-hint' }, 'Answer with the number keys, or T and F for true/false.')));

  const next = () => { const q = pool[idx % pool.length]; idx += 1; if (idx % pool.length === 0) pool = shuffle(pool); return q; };

  function show() {
    if (over) return;
    const q = next();
    const order = q.type === 'mc' ? (q.fixedOrder ? q.options.map((_, i) => i) : shuffle(q.options.map((_, i) => i))) : null;
    const labels = q.type === 'mc' ? order.map((o) => q.options[o]) : ['True', 'False'];
    const keys = q.type === 'mc' ? labels.map((_, n) => String(n + 1)) : ['T', 'F'];
    const rightPos = q.type === 'mc' ? order.indexOf(q.answer) : (q.answer ? 0 : 1);
    const rows = labels.map((label, p) => {
      const state = h('span', { class: 'state' });
      const btn = h('button', { class: 'opt', type: 'button' }, h('span', { class: 'key' }, keys[p]), h('span', { class: 'txt' }, h('span', { class: 'ink' }, label)), state);
      btn.addEventListener('click', () => answer(p));
      return { btn, state, obj: FX.obj(btn, { cls: 'o-opt', tilt: 3, z: 16 }) };
    });
    cur = { q, rightPos, rows, n: rows.length };
    const el = FX.obj(h('article', { class: 'qcard quick-card' }, h('h1', { class: 'qtext' }, q.question), h('div', { class: 'options' }, rows.map((r) => r.obj))), { cls: 'o-card', hover: false });
    slot.replaceChildren(el);
    M.animate(el, { opacity: 0, y: 18 }, { duration: 0 });
    FX.anim(el, { opacity: 1, y: 0 }, FX.spring.deal);
    locked = false;
  }

  function answer(p) {
    if (!cur || locked || over) return;
    locked = true;
    const { q, rightPos, rows } = cur;
    const ok = p === rightPos;
    rows.forEach((r, n) => {
      r.obj.dataset.locked = '1';
      if (n === rightPos) { r.btn.classList.add('right'); r.state.replaceChildren(icon('check', 24)); }
      else if (n === p) { r.btn.classList.add('wrong'); r.state.replaceChildren(icon('x', 24)); }
      else r.obj.classList.add('dimmed');
    });
    const c = centreOf(rows[p].btn);
    log.push({ id: q.id, score: ok ? 1 : 0 });
    if (ok) { right += 1; FX.confetti(c.x, c.y, { count: 6 }); FX.sound('pop'); mascot.mood('happy', 1100); }
    else { wrong += 1; FX.anim(rows[p].obj, { x: [0, -10, 10, -7, 7, -3, 0] }, { duration: 0.4 }); FX.sound('thud'); mascot.mood('sad', 1300); }

    if (isSpeed) {
      scoreChip.set(right);
      if (!ok) { endAt = speedPenalty(endAt); timerEl.classList.add('hit'); setTimeout(() => timerEl.classList.remove('hit'), 500); }
      setTimeout(show, ok ? 320 : 800);
    } else {
      const before = multiplier(combo.streak);
      combo = comboAnswer(combo, ok);
      scoreChip.set(combo.score);
      const m = multiplier(combo.streak);
      mult.textContent = String(m);
      [...lives.children].forEach((l, n) => l.classList.toggle('on', n < combo.lives));
      lives.setAttribute('aria-label', `${combo.lives} ${combo.lives === 1 ? 'life' : 'lives'} left`);
      if (m > before) { FX.anim(sticker, { scale: [1, 1.4, 1], rotate: [0, -8, 0] }, { type: 'spring', stiffness: 300, damping: 9 }); FX.sound('big'); if (m >= MILESTONE) FX.confetti(centreOf(sticker).x, centreOf(sticker).y, { count: 12, big: true }); }
      else if (!ok && before > 1) FX.anim(sticker, { scale: [1, 0.7, 1] }, FX.spring.bouncy);
      if (comboOver(combo)) { setTimeout(() => finish(false, centreOf(deck)), 1000); return; }
      setTimeout(show, ok ? 380 : 1000);
    }
  }

  function finish(early, at) {
    if (over) return;
    over = true; session();
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (!log.length) { location.hash = `#/exam/${exam.id}/games`; return; }
    const score = isSpeed ? right : combo.score;
    const rec = recordGame(exam.id, mode, { score, answered: log.length, seconds }, log);
    const acc = Math.round((right / log.length) * 100);
    const missed = [...new Set(log.filter((x) => !x.score).map((x) => x.id))].map((id) => byId.get(id)).filter(Boolean);
    FX.transition(() => renderGameResult(root, ctx, {
      game: mode, score, rec, mood: acc >= 50 ? 'happy' : 'sad',
      stats: [`${right} right`, `${wrong} wrong`, `${acc}% accuracy`, isSpeed ? null : `Best streak ${combo.best}`, early ? 'Ended early' : null].filter(Boolean),
      mistakes: missed,
      again: (e) => FX.transition(() => runQuick(root, ctx, mode), posOf(e, document.body)),
    }), at || centreOf(deck));
  }

  const onKey = (e) => {
    if (over || e.ctrlKey || e.metaKey || e.altKey || !cur) return;
    const k = e.key.toLowerCase();
    if (/^[1-9]$/.test(k) && Number(k) <= cur.n) { answer(Number(k) - 1); e.preventDefault(); }
    else if (cur.q.type === 'tf' && (k === 't' || k === 'f')) { answer(k === 't' ? 0 : 1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  const tick = () => {
    if (!isSpeed || over) return;
    const left = endAt - Date.now();
    const t = timerEl.querySelector('.t');
    const txt = left <= 0 ? '0' : left < 10000 ? (left / 1000).toFixed(1) : String(Math.ceil(left / 1000));
    if (t.textContent !== txt) t.textContent = txt;
    timerEl.classList.toggle('low', left <= 15000 && left > 5000);
    timerEl.classList.toggle('crit', left <= 5000);
    if (left <= 0) finish(false, centreOf(deck));
  };
  const timer = setInterval(tick, 100);
  const session = () => { over = true; clearInterval(timer); document.removeEventListener('keydown', onKey); };
  startSession(session);
  top.lab.textContent = isSpeed ? 'Speed round' : 'Combo run';
  show();
}
