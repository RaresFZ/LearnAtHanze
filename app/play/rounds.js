// Phone round screens for Live Quiz: get ready, question (big answer blocks), result, leaderboard, final podium.
// A screen only ever shows what this phone's stream sent: no correct answer or explanation exists here before the reveal.
// Screens return { el, update(view), enter?(), destroy?() }.
import { h } from '/js/util.js';
import { icon } from '/js/icons.js';
import { FX } from '/js/fx.js';
import { timeBar, optionBlock, boardList, podium, stamp, fmt, ordinal } from '/js/live-shared.js';

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
export function revealScreen(v) {
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

  return {
    el: h('div', { class: 'pr' }, FX.obj(card, { cls: 'o-card', hover: false }), h('div', { class: 'pq-opts recap' }, blocks.map((b) => b.obj)), why,
      h('p', { class: 'fine pr-wait' }, v.last ? 'Waiting for the host to show the final results…' : 'Waiting for the host…')),
    enter() {
      FX.enter([card.closest('.obj')], { y: -50, rotate: kind === 'right' ? -1.5 : 1.5, delay: FX.base(), spring: FX.spring.deal });
      if (kind !== 'none') FX.count(points, earned, { duration: 0.9, delay: FX.base() + 0.3, fmt: (n) => `+${fmt(Math.round(n))}` });
      mascot.mood(kind === 'right' ? 'happy' : kind === 'none' ? 'idle' : 'sad', 3000);
      if (kind === 'right') { const b = card.getBoundingClientRect(); FX.confetti(b.left + b.width / 2, b.top + 40, { count: you.streak >= 3 ? 14 : 8, big: you.streak >= 3 }); }
      if (kind === 'wrong') navigator.vibrate?.([40, 40, 40]);
    },
    update() {},
  };
}

// ---------------------------------------------------------------- leaderboard
export function boardScreen(v) {
  const list = boardList(v.board, { meId: v.you.id, step: 60 });
  const inTop = v.board.some((r) => r.id === v.you.id);
  const me = !inTop ? h('p', { class: 'pres-rank you-line hard' }, v.you.rank ? [h('strong', null, ordinal(v.you.rank)), ` of ${v.you.of} · ${fmt(v.you.score)} pts`] : 'You are in from the next question.') : null;
  return {
    el: h('div', { class: 'pb' }, h('p', { class: 'lab' }, `After question ${v.progress.index + 1} of ${v.progress.total}`), h('h1', null, 'Leaderboard'),
      v.board.length ? list.el : h('p', { class: 'fine' }, 'Nobody has scored yet.'), me,
      h('p', { class: 'fine pr-wait' }, 'Next question coming up…')),
    enter() { list.play(); if (me) FX.enter([me], { y: 20, delay: FX.base() + 0.9, spring: FX.spring.soft }); },
    update() {},
  };
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
      h('p', { class: 'fine pr-wait' }, 'Waiting for the host. If they play again, you stay in.')),
    enter() {
      pod.play(() => { if (rank === 1) { FX.confetti(innerWidth / 2, innerHeight * 0.3, { count: 18, big: true }); FX.sound('big'); } });
      st.play(FX.base() + 2);
      if (rank && rank <= 3) navigator.vibrate?.([60, 40, 60]);
    },
    update() {},
  };
}
