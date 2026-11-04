// Live Quiz, host side: the big-screen round screens. Each one is built from a message of the server and updated by the next ones.
// The server decides everything (clock, answers, scores); these screens only show it and send the host's buttons.
// Screens return { el, update(m), enter?(), key?(event) }.
import { h } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { timeBar, optionBlock, boardList, podium, stamp, fmt } from './live-shared.js';


function button(label, ic, onClick, { primary = false, alt = false } = {}) {
  const b = h('button', { class: `btn${primary ? ' yellow xl' : ''}${alt ? ' alt' : ''}`, type: 'button' }, ic ? icon(ic, primary ? 22 : 16) : null, label);
  b.addEventListener('click', onClick);
  return FX.obj(b, { cls: 'o-btn' });
}
/** "End game" needs two clicks. */
function endButton(act) {
  let armed = false;
  const b = h('button', { class: 'btn alt', type: 'button' }, 'End game');
  b.addEventListener('click', () => {
    if (!armed) { armed = true; b.textContent = 'Click again to end'; setTimeout(() => { armed = false; b.textContent = 'End game'; }, 3500); return; }
    act('end');
  });
  return FX.obj(b, { cls: 'o-btn' });
}
const MODES = [['manual', 'Manual'], ['auto', 'Auto'], ['vote', 'Vote']];
/**
 * "Moves on: manual / auto / vote" and the status next to it: a countdown (auto, and the leaderboard in vote mode) or "3 of 7 ready" (vote).
 * Switching the mode takes effect right away. The host's own Next button still works in every mode.
 */
function advanceBar(act, { final = false, onBoard = false, label: nextLabel } = {}) {
  const chip = h('span', { class: 'chip yellow', role: 'status', hidden: true });
  const btns = MODES.map(([val, label]) => {
    const b = h('button', { class: 'pill-btn', type: 'button', 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => act('advance', { mode: val }));
    return [val, b, FX.obj(b, { cls: 'o-pill' })];
  });
  const sw = h('div', { class: 'pills pace-switch', role: 'group', 'aria-label': 'What moves the game on' }, h('span', { class: 'lab' }, 'Moves on'), btns.map((x) => x[2]));
  let info = null, endsAt = 0, tick = null;
  const paint = () => {
    if (!info) return;
    btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(v === info.mode)));
    if (info.mode === 'vote' && !onBoard) { chip.hidden = false; chip.textContent = `${info.ready} of ${info.of} ready`; }
    else if (info.mode !== 'manual' && endsAt) {
      const s = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
      chip.hidden = false; chip.textContent = `${nextLabel || (onBoard ? 'Next question' : final ? 'Final results' : 'Leaderboard')} in ${s} s`;
    } else chip.hidden = true;
  };
  return {
    el: h('div', { class: 'pace-bar' }, chip, sw),
    set(a) { info = a || null; endsAt = a?.remainingMs ? performance.now() + a.remainingMs : 0; clearInterval(tick); tick = endsAt ? setInterval(paint, 250) : null; paint(); },
    stop() { clearInterval(tick); },
  };
}
const hint = (...pairs) => h('div', { class: 'hints' }, pairs.map(([k, t]) => h('span', null, h('kbd', null, k), t)));

// ---------------------------------------------------------------- get ready
export function readyScreen(m) {
  const mascot = FX.mascot();
  const card = h('div', { class: 'ready-card hard' },
    h('span', { class: 'chip' }, m.q.topic),
    h('div', { class: 'ready-num' }, `Question ${m.q.index + 1}`),
    h('p', { class: 'ready-sub' }, `of ${m.q.total} · get ready`),
    h('div', { class: 'ready-mascot' }, mascot));
  return {
    el: FX.obj(card, { cls: 'o-card', hover: false }),
    enter() { FX.enter([this.el], { y: -60, rotate: -2, delay: FX.base(), spring: FX.spring.deal }); },
    update() {},
  };
}

// ---------------------------------------------------------------- question, then the reveal on the same screen
export function roundScreen(m, act) {
  const q = m.q;
  const segs = h('div', { class: 'quiz-segs', 'aria-label': `Question ${q.index + 1} of ${q.total}` },
    Array.from({ length: q.total }, (_, i) => h('i', { class: i < q.index ? 'done' : i === q.index ? 'current' : '' })));
  const answered = h('span', { class: 'chip yellow', role: 'status' });
  const head = h('div', { class: 'hq-head' }, h('span', { class: 'chip accent' }, q.topic), h('span', { class: 'chip' }, `Question ${q.index + 1} of ${q.total}`), h('span', { class: 'spacer' }), answered);
  const tb = timeBar({ big: true, onSecond: () => FX.sound('tick') });
  const pausedTag = h('span', { class: 'sticker', hidden: true }, icon('pause', 14), 'Paused');
  const blocks = q.options.map((t, i) => optionBlock(i, t, { type: q.type }));
  const opts = h('div', { class: `lopts n${q.options.length}` }, blocks.map((b) => b.obj));
  const timeRow = h('div', { class: 'hq-time' }, tb.el, pausedTag);
  const card = h('div', { class: 'qcard hq-card' }, timeRow, h('h2', { class: 'hq-text' }, q.text), opts);
  const noteSlot = h('div', { class: 'hq-note' });
  const controls = h('div', { class: 'lobby-actions' });
  const el = h('div', { class: 'round' }, segs, head, FX.obj(card, { cls: 'o-card', hover: false }), noteSlot, controls);

  let revealed = false, ctlKey = '', lastCount = -1, last = m, adv = null;
  const setControls = (key, nodes) => { if (key === ctlKey) return; ctlKey = key; controls.replaceChildren(...nodes); };

  function reveal(msg) {
    revealed = true;
    tb.stop(); timeRow.hidden = true; pausedTag.hidden = true; card.classList.remove('is-paused');
    const r = msg.reveal;
    blocks.forEach((b, i) => { if (i === r.correct) b.right(); else b.dim(); b.setCount(r.counts[i]); });
    segs.children[q.index]?.classList.add('done');
    answered.textContent = `${r.answered} answered`;
    const note = h('div', { class: 'note-card fb' },
      h('span', { class: 'label good' }, icon('check', 14), 'Correct answer'),
      r.explanation ? h('p', { class: 'explain' }, r.explanation) : null,
      r.source ? h('p', { class: 'source' }, icon('book-open', 14), r.source) : null);
    noteSlot.replaceChildren(FX.obj(note, { cls: 'o-card', hover: false }));
    FX.enter([noteSlot.firstChild], { y: 26, delay: 0.25, spring: FX.spring.soft });
    FX.sound('pop');
    const nextWord = msg.last ? 'Final results' : msg.settings.board === false ? 'Next part' : 'Leaderboard';       // a study game has no leaderboard between rounds
    adv = advanceBar(act, { final: msg.last, label: nextWord });
    setControls('reveal', [button(nextWord, 'arrow-right', () => act('next'), { primary: true }), endButton(act), hint(['Enter', 'next']), adv.el]);
    adv.set(msg.advance);
  }

  return {
    el,
    enter() { FX.enter([card.closest('.obj')], { y: -40, rotate: -1.5, delay: FX.base(), spring: FX.spring.deal }); FX.enter(blocks.map((b) => b.obj), { y: 24, delay: FX.base() + 0.2, stagger: 0.07, spring: FX.spring.soft }); },
    update(msg) {
      last = msg;
      if (msg.phase === 'question') {
        tb.set({ remainingMs: msg.remainingMs, limitMs: q.limitMs, paused: msg.paused });
        pausedTag.hidden = !msg.paused; card.classList.toggle('is-paused', msg.paused);
        answered.textContent = `${msg.answered} of ${msg.of} answered`;
        if (msg.answered > lastCount && lastCount >= 0) FX.anim(answered, { scale: [1.18, 1] }, FX.spring.bouncy);
        lastCount = msg.answered;
        setControls(`q${msg.paused}`, [
          button(msg.paused ? 'Resume' : 'Pause', msg.paused ? 'play' : 'pause', () => act(msg.paused ? 'resume' : 'pause')),
          button('Skip', 'skip-forward', () => act('skip')), endButton(act),
          hint(['P', 'pause'], ['S', 'skip'])]);
      } else if (msg.phase === 'reveal') { if (!revealed) reveal(msg); else adv?.set(msg.advance); }
    },
    destroy() { tb.stop(); adv?.stop(); },
    key(e) {
      if (last.phase === 'question') {
        const k = e.key.toLowerCase();
        if (k === 'p') { act(last.paused ? 'resume' : 'pause'); return true; }
        if (k === 's') { act('skip'); return true; }
      } else if (last.phase === 'reveal' && (e.key === 'Enter' || e.key === ' ')) { act('next'); return true; }
      return false;
    },
  };
}

// ---------------------------------------------------------------- study game: the lesson part everybody reads before the question
export function lessonScreen(m, act) {
  const L = m.lesson;
  const head = h('div', { class: 'hq-head' }, h('span', { class: 'chip accent' }, L.topic), h('span', { class: 'chip' }, `Part ${L.part} of ${L.parts}`), h('span', { class: 'spacer' }),
    h('span', { class: 'chip yellow' }, `Round ${m.q.index + 1} of ${m.q.total}`));
  const face = h('div', { class: 'qcard study-card' },
    h('span', { class: 'lab' }, 'Read this first'),
    h('h2', { class: 'study-title' }, L.title),
    h('ul', { class: 'study-points' }, L.points.map((p) => h('li', null, p))),
    L.remember ? h('div', { class: 'study-remember' }, h('span', { class: 'lab' }, 'Remember'), h('p', null, L.remember)) : null);
  const bar = advanceBar(act, { label: 'Quick check' });
  const card = FX.obj(face, { cls: 'o-card', hover: false });
  const el = h('div', { class: 'round' }, head, card,
    h('div', { class: 'lobby-actions' }, button('Quick check', 'arrow-right', () => act('next'), { primary: true }), endButton(act), hint(['Enter', 'next']), bar.el));
  return {
    el,
    enter() { FX.enter([card], { y: -40, rotate: -1, delay: FX.base(), spring: FX.spring.deal }); },
    update(msg) { bar.set(msg.advance); },
    destroy() { bar.stop(); },
    key(e) { if (e.key === 'Enter' || e.key === ' ') { act('next'); return true; } return false; },
  };
}

// ---------------------------------------------------------------- leaderboard (top 5, rows slide to their new places)
export function boardScreen(m, act) {
  const list = boardList(m.board, { step: 80 });
  const adv = advanceBar(act, { onBoard: true });
  const el = h('div', { class: 'boardscreen' },
    h('div', { class: 'hq-head' }, h('h2', { class: 'bh' }, 'Leaderboard'), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, `After question ${m.progress.index + 1} of ${m.progress.total}`)),
    m.board.length ? list.el : h('p', { class: 'fine' }, 'Nobody has scored yet.'),
    h('div', { class: 'lobby-actions' }, button('Next question', 'arrow-right', () => act('next'), { primary: true }), endButton(act), hint(['Enter', 'next']), adv.el));
  return {
    el, enter() { list.play(); }, update(msg) { adv.set(msg.advance); }, destroy() { adv.stop(); },
    key(e) { if (e.key === 'Enter' || e.key === ' ') { act('next'); return true; } return false; },
  };
}

// ---------------------------------------------------------------- study game: the parts somebody missed (host screen)
function revisitBlock(list) {
  if (!list) return null;
  if (!list.length) return h('div', { class: 'revisit hard' }, h('h3', null, 'Parts to revisit'), h('p', { class: 'fine' }, 'Nobody missed a question. Every part sat.'));
  return h('div', { class: 'revisit hard' },
    h('h3', null, 'Parts to revisit'), h('p', { class: 'fine' }, 'The parts somebody missed, the worst first. Read them again in Learn mode.'),
    h('ul', null, list.map((r) => h('li', null,
      h('div', { class: 'rv-head' }, h('strong', null, r.title), h('span', { class: 'chip' }, `${r.right} of ${r.of} right`)),
      h('p', { class: 'rv-where' }, `${r.topic}, part ${r.part} of ${r.parts}`),
      h('p', { class: 'rv-q' }, r.question, ' ', h('span', { class: 'rv-a' }, r.answer))))));
}

// ---------------------------------------------------------------- final podium
export function podiumScreen(m, act) {
  const rows = m.podium;
  const pod = podium(rows, {});
  const st = stamp('Game over');
  const rest = rows.slice(3);
  const mascot = FX.mascot(); mascot.dataset.mood = rows.length ? 'happy' : 'idle';
  const el = h('div', { class: 'podiumscreen' },
    h('div', { class: 'hq-head' }, h('h2', { class: 'bh' }, 'Final results'), h('span', { class: 'spacer' }), h('span', { class: 'chip' }, `${m.progress.total} questions`)),
    rows.length ? h('div', { class: 'pod-stage hard' }, pod.el, h('div', { class: 'pod-stamp' }, st.el), h('div', { class: 'pod-mascot' }, mascot)) : h('p', { class: 'fine' }, 'Nobody scored.'),
    rest.length ? h('div', { class: 'pchips pod-rest' }, rest.map((r) => h('span', { class: `pchip c4${r.away || r.left ? ' away' : ''}` }, `${r.rank}. ${r.nick}`, h('span', { class: 'tag' }, fmt(r.score))))) : null,
    revisitBlock(m.revisit),
    h('div', { class: 'lobby-actions' }, button('Play again', 'rotate-ccw', () => act('again'), { primary: true }), endButton(act)));
  return {
    el,
    enter() {
      if (!rows.length) return;
      pod.play((c) => {
        const r = c.block.getBoundingClientRect();
        FX.confetti(r.left + r.width / 2, r.top + 20, { count: 16, big: true });
        FX.sound('big');
      });
      st.play(FX.base() + 2.1);
    },
    update() {},
  };
}
