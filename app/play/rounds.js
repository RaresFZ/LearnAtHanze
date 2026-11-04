// Phone round screens for Live Quiz: get ready, question (big answer blocks), result, leaderboard, final podium.
// A screen only ever shows what this phone's stream sent: no correct answer or explanation exists here before the reveal.
// Screens return { el, update(view), enter?(), destroy?() }.
import { h } from '/js/util.js';
import { icon } from '/js/icons.js';
import { FX } from '/js/fx.js';
import { timeBar, optionBlock, boardList, podium, stamp, fmt, ordinal } from '/js/live-shared.js';

// ---------------------------------------------------------------- study game: the lesson part to read before the question
export function lessonScreen(v, ctx) {
  const L = v.lesson;
  const wait = h('p', { class: 'fine pr-wait', role: 'status' });
  const readyBtn = h('button', { class: 'btn yellow xl pr-ready', type: 'button' }, icon('check', 22), "I've read it");
  const readyObj = FX.obj(readyBtn, { cls: 'o-btn' });
  readyObj.hidden = true;
  let tick = null, endsAt = 0, last = v;
  const paintWait = () => {
    const a = last.advance || { mode: 'manual' };
    if (a.mode === 'vote') {
      readyObj.hidden = !!a.you;
      wait.textContent = a.you ? `Waiting for the others… ${a.ready} of ${a.of} ready` : `${a.ready} of ${a.of} ready. Tap when you have read it.`;
    } else if (a.mode === 'auto' && endsAt) {
      readyObj.hidden = true;
      wait.textContent = `Quick check in ${Math.max(0, Math.ceil((endsAt - performance.now()) / 1000))} s`;
    } else { readyObj.hidden = true; wait.textContent = 'Read it. The host starts the quick check.'; }
  };
  readyBtn.addEventListener('click', async () => {
    readyObj.hidden = true; wait.textContent = 'Waiting for the others…';
    navigator.vibrate?.(20);
    try { await ctx.post('/live/ready', { t: ctx.token() }); } catch (ex) { if (!ex.code) { readyObj.hidden = false; wait.textContent = 'Could not send that. Tap again.'; } }
  });
  const face = h('div', { class: 'study-card hard' },
    h('p', { class: 'lab' }, `${L.topic} / part ${L.part} of ${L.parts}`),
    h('h2', { class: 'study-title' }, L.title),
    h('ul', { class: 'study-points' }, L.points.map((p) => h('li', null, p))),
    L.remember ? h('div', { class: 'study-remember' }, h('span', { class: 'lab' }, 'Remember'), h('p', null, L.remember)) : null);
  return {
    el: h('div', { class: 'plesson' }, h('span', { class: 'chip' }, `Round ${v.q.index + 1} / ${v.q.total}`), face, readyObj, wait),
    enter() { FX.enter([face], { y: 24, delay: FX.base(), spring: FX.spring.soft }); paintWait(); },
    update(view) {
      last = view;
      const a = view.advance;
      endsAt = a?.mode === 'auto' && a.remainingMs ? performance.now() + a.remainingMs : 0;
      clearInterval(tick); tick = endsAt ? setInterval(paintWait, 250) : null;
      paintWait();
    },
    destroy() { clearInterval(tick); },
  };
}

// ---------------------------------------------------------------- get ready
export function readyScreen(v) {
  const mascot = FX.mascot();
  return {
    el: h('div', { class: 'pready' }, h('span', { class: 'lab' }, `Question ${v.q.index + 1} of ${v.q.total}`), h('h1', null, 'Get ready'), mascot),
    enter() { FX.enter([this.el.querySelector('h1')], { y: -50, delay: FX.base(), spring: FX.spring.deal }); mascot.mood('happy'); },
    update() {},
  };
}

// ---------------------------------------------------------------- question: tap one block
export function questionScreen(v, ctx) {
  const q = v.q;
  const tb = timeBar({});
  const paused = h('p', { class: 'pq-paused', hidden: true }, icon('pause', 16), 'Paused by the host');
  const blocks = q.options.map((t, i) => optionBlock(i, t, { type: q.type, interactive: true }));
  const status = h('p', { class: 'pq-status', role: 'status' });
  const el = h('div', { class: 'pq' },
    h('div', { class: 'pq-top' }, h('span', { class: 'chip' }, `${q.index + 1} / ${q.total}`), tb.el),
    paused,
    h('h2', { class: 'pq-text' }, q.text),
    h('div', { class: `pq-opts n${q.options.length}` }, blocks.map((b) => b.obj)),
    status);

  let chosen = null, isPaused = false;
  const lock = (i) => {
    chosen = i;
    blocks.forEach((b) => {
      b.lock();
      if (b.pos === i) { b.picked(); FX.anim(b.obj._p.lift, { x: 4, y: 4, z: 0 }, FX.spring.snappy); } else b.dim();
    });
    status.textContent = 'Answer locked in. Waiting for the others…';
  };
  blocks.forEach((b) => b.el.addEventListener('click', async () => {
    if (chosen != null || isPaused) return;
    lock(b.pos);
    navigator.vibrate?.(25);
    try { await ctx.post('/live/answer', { t: ctx.token(), q: q.index, choice: b.pos }); } catch (ex) {
      if (ex.code === 'dup') return;
      if (ex.code) { status.textContent = 'Too late: that answer was not counted.'; return; }    // the round is already over; the result is on its way
      chosen = null; blocks.forEach((x) => x.reset()); status.textContent = 'Could not send that. Tap your answer again.';   // no connection: try again
    }
  }));

  return {
    el,
    enter() { FX.enter(blocks.map((b) => b.obj), { y: 26, delay: FX.base(), stagger: 0.06, spring: FX.spring.soft }); },
    update(view) {
      isPaused = !!view.paused;
      tb.set({ remainingMs: view.remainingMs, limitMs: q.limitMs, paused: view.paused });
      paused.hidden = !view.paused;
      if (view.choice != null && view.choice !== chosen) { if (chosen != null) blocks.forEach((b) => b.reset()); lock(view.choice); }   // refreshed after answering, or the server holds another choice than the one this screen sent
    },
    destroy() { tb.stop(); },
  };
}

// ---------------------------------------------------------------- result of the question
export function revealScreen(v, ctx) {
  const q = v.q, r = v.reveal, you = r.you;
  const kind = !you ? 'none' : you.correct ? 'right' : you.answered ? 'wrong' : 'missed';
  const label = { right: 'Correct!', wrong: 'Wrong', missed: "Time's up", none: 'Welcome in' }[kind];
  const earned = you ? you.points + you.bonus : 0;
  const points = h('div', { class: 'pres-points' }, '+0');
  const mascot = FX.mascot(); mascot.dataset.mood = kind === 'right' ? 'happy' : kind === 'none' ? 'idle' : 'sad';
  const lines = [];
  if (you?.bonus) lines.push(h('p', { class: 'pres-line' }, icon('flame', 16), `Includes +${you.bonus} streak bonus · ${you.streak} in a row`));
  else if (you?.correct && you.streak > 1) lines.push(h('p', { class: 'pres-line' }, icon('flame', 16), `${you.streak} in a row`));
  if (you?.rank) {
    const d = you.delta;
    lines.push(h('p', { class: 'pres-rank' }, h('strong', null, ordinal(you.rank)), ` of ${you.of} · ${fmt(you.score)} pts`,
      d ? h('span', { class: `lb-move ${d > 0 ? 'up' : 'down'}` }, icon(d > 0 ? 'arrow-up' : 'arrow-down', 14), String(Math.abs(d))) : null));
  } else lines.push(h('p', { class: 'pres-line' }, 'You are in from the next question.'));
  const card = h('div', { class: `pres hard ${kind}` },
    h('div', { class: 'pres-top' }, h('div', { class: 'pres-label' }, kind === 'right' ? icon('check', 26) : kind === 'none' ? null : icon('x', 26), label), h('div', { class: 'pres-mascot' }, mascot)),
    kind === 'none' ? null : points, lines);

  const blocks = q.options.map((t, i) => {
    const b = optionBlock(i, t, { type: q.type });
    if (i === r.correct) b.right(); else if (you && you.choice === i) b.wrong(); else b.dim();
    b.setCount(r.counts[i]);
    return b;
  });
  const why = (r.explanation || r.source) ? h('details', { class: 'review pres-why' },
    h('summary', null, 'Why?', icon('chevron-down', 20)),
    h('div', { class: 'body' }, r.explanation ? h('p', { class: 'why' }, r.explanation) : null, r.source ? h('p', { class: 'src' }, icon('book-open', 14), r.source) : null)) : null;

  // what moves the game on: the host (manual), a countdown (auto) or everybody tapping "I've read it" (vote)
  const wait = h('p', { class: 'fine pr-wait', role: 'status' });
  const readyBtn = h('button', { class: 'btn yellow xl pr-ready', type: 'button' }, icon('check', 22), "I've read it");
  const readyObj = FX.obj(readyBtn, { cls: 'o-btn' });
  readyObj.hidden = true;
  let tick = null, endsAt = 0, last = v;
  const paintWait = () => {
    const a = last.advance || { mode: 'manual' };
    if (a.mode === 'vote') {
      readyObj.hidden = !!a.you;
      wait.textContent = a.you ? `Waiting for the others… ${a.ready} of ${a.of} ready` : `${a.ready} of ${a.of} ready. Tap when you have read the answer and the explanation.`;
    } else if (a.mode === 'auto' && endsAt) {
      readyObj.hidden = true;
      wait.textContent = `${last.last ? 'Final results' : last.settings?.board === false ? 'Next part' : 'Leaderboard'} in ${Math.max(0, Math.ceil((endsAt - performance.now()) / 1000))} s`;
    } else {
      readyObj.hidden = true;
      wait.textContent = last.last ? 'Waiting for the host to show the final results…' : 'Waiting for the host…';
    }
  };
  readyBtn.addEventListener('click', async () => {
    readyObj.hidden = true; wait.textContent = 'Waiting for the others…';
    navigator.vibrate?.(20);
    try { await ctx.post('/live/ready', { t: ctx.token() }); } catch (ex) { if (!ex.code) { readyObj.hidden = false; wait.textContent = 'Could not send that. Tap again.'; } }
  });

  return {
    el: h('div', { class: 'pr' }, FX.obj(card, { cls: 'o-card', hover: false }), h('div', { class: 'pq-opts recap' }, blocks.map((b) => b.obj)), why, readyObj, wait),
    enter() {
      FX.enter([card.closest('.obj')], { y: -50, rotate: kind === 'right' ? -1.5 : 1.5, delay: FX.base(), spring: FX.spring.deal });
      if (kind !== 'none') FX.count(points, earned, { duration: 0.9, delay: FX.base() + 0.3, fmt: (n) => `+${fmt(Math.round(n))}` });
      mascot.mood(kind === 'right' ? 'happy' : kind === 'none' ? 'idle' : 'sad', 3000);
      if (kind === 'right') { const b = card.getBoundingClientRect(); FX.confetti(b.left + b.width / 2, b.top + 40, { count: you.streak >= 3 ? 14 : 8, big: you.streak >= 3 }); }
      if (kind === 'wrong') navigator.vibrate?.([40, 40, 40]);
      paintWait();
    },
    update(view) {
      last = view;
      const a = view.advance;
      endsAt = a?.mode === 'auto' && a.remainingMs ? performance.now() + a.remainingMs : 0;
      clearInterval(tick); tick = endsAt ? setInterval(paintWait, 250) : null;
      paintWait();
    },
    destroy() { clearInterval(tick); },
  };
}

// ---------------------------------------------------------------- leaderboard
export function boardScreen(v) {
  const list = boardList(v.board, { meId: v.you.id, step: 60 });
  const inTop = v.board.some((r) => r.id === v.you.id);
  const wait = h('p', { class: 'fine pr-wait', role: 'status' }, 'Next question coming up…');
  let tick = null;
  const me = !inTop ? h('p', { class: 'pres-rank you-line hard' }, v.you.rank ? [h('strong', null, ordinal(v.you.rank)), ` of ${v.you.of} · ${fmt(v.you.score)} pts`] : 'You are in from the next question.') : null;
  return {
    el: h('div', { class: 'pb' }, h('p', { class: 'lab' }, `After question ${v.progress.index + 1} of ${v.progress.total}`), h('h1', null, 'Leaderboard'),
      v.board.length ? list.el : h('p', { class: 'fine' }, 'Nobody has scored yet.'), me,
      wait),
    enter() { list.play(); if (me) FX.enter([me], { y: 20, delay: FX.base() + 0.9, spring: FX.spring.soft }); },
    update(view) {
      const a = view.advance;
      clearInterval(tick);
      if (a && a.mode !== 'manual' && a.remainingMs) {
        const endsAt = performance.now() + a.remainingMs;
        const paint = () => { wait.textContent = `Next question in ${Math.max(0, Math.ceil((endsAt - performance.now()) / 1000))} s`; };
        paint(); tick = setInterval(paint, 250);
      } else wait.textContent = 'Next question coming up…';
    },
    destroy() { clearInterval(tick); },
  };
}

// ---------------------------------------------------------------- study game: the parts to read again (the ones you missed first)
function revisitBlock(list) {
  if (!list) return null;
  if (!list.length) return h('div', { class: 'revisit hard' }, h('h3', null, 'Parts to revisit'), h('p', { class: 'fine' }, 'Nobody missed a question.'));
  const mine = (r) => (r.you === 'right' || !r.you ? 0 : 1);
  const sorted = [...list].sort((a, b) => mine(b) - mine(a));
  return h('div', { class: 'revisit hard' },
    h('h3', null, 'Parts to revisit'),
    h('ul', null, sorted.map((r) => h('li', null,
      h('div', { class: 'rv-head' }, h('strong', null, r.title), h('span', { class: `chip${mine(r) ? ' yellow' : ''}` }, mine(r) ? 'You missed it' : `${r.right} of ${r.of} right`)),
      h('p', { class: 'rv-where' }, `${r.topic}, part ${r.part} of ${r.parts}`),
      h('p', { class: 'rv-q' }, r.question, ' ', h('span', { class: 'rv-a' }, r.answer))))));
}

// ---------------------------------------------------------------- final podium
export function podiumScreen(v) {
  const rank = v.you.rank;
  const rows = v.podium;
  const pod = podium(rows, { meId: v.you.id, compact: true });
  const st = stamp(rank === 1 ? 'Winner!' : rank === 2 ? 'So close' : rank === 3 ? 'Podium!' : rank ? 'Good game' : 'Thanks');
  const mascot = FX.mascot(); mascot.dataset.mood = rank && rank <= 3 ? 'happy' : 'idle';
  return {
    el: h('div', { class: 'pp' }, h('p', { class: 'lab' }, 'Final results'), h('h1', null, rank === 1 ? 'You won!' : 'Game over'),
      rows.length ? pod.el : null,
      h('div', { class: 'pp-stamp' }, st.el),
      h('p', { class: 'pres-rank you-line hard' }, rank ? [h('strong', null, ordinal(rank)), ` of ${v.you.of} · ${fmt(v.you.score)} pts`] : 'Thanks for playing.'),
      h('div', { class: 'pp-mascot' }, mascot),
      revisitBlock(v.revisit),
      h('p', { class: 'fine pr-wait' }, 'Waiting for the host. If they play again, you stay in.')),
    enter() {
      pod.play(() => { if (rank === 1) { FX.confetti(innerWidth / 2, innerHeight * 0.3, { count: 18, big: true }); FX.sound('big'); } });
      st.play(FX.base() + 2);
      if (rank && rank <= 3) navigator.vibrate?.([60, 40, 60]);
    },
    update() {},
  };
}
