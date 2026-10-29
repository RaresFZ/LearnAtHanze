// Flashcards with spaced repetition: overview -> session -> summary. One exam's data at a time.
// The cards are the exam's own questions (see cards.js); the schedule is in srs.js; progress.cards holds it.
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { buildCards } from './cards.js';
import { TYPE_LABEL, sourceText } from './question.js';
import { loadProgress, recordCard, recordSession } from './store.js';
import { rate, nextLabel, dueWhen, deckStatus, buildQueue, RATINGS, NEW_PER_DAY } from './srs.js';

const M = window.Motion;
const NAME = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const REINSERT = { again: 3, hard: 6 };         // a missed card comes back after this many other cards
const centreOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const pos = (e, el) => (e && e.clientX ? { x: e.clientX, y: e.clientY } : centreOf(el));

let active = null;
/** Removes the key handler of the session on screen (called when the route changes). */
export function destroyCardSession() { active?.destroy(); }

/** Deck numbers for one exam: { total, due, review, learning, newToday, learned, next }. */
export function cardStatus(ctx) {
  return deckStatus(buildCards(ctx.questions, ctx.flashcards), loadProgress(ctx.exam.id).cards);
}

export const tile = (cls, label, ic, to, small, rot) => FX.obj(h('div', { class: `tile ${cls}` },
  h('div', { class: 'top' }, h('span', { class: 'lab' }, label), icon(ic, 22)),
  h('div', { class: 'big' }, h('span', { class: 'cnt', 'data-to': to }, String(to)), h('small', null, small))),
{ cls: 'o-tile', tilt: 8, shine: true, fill: true, z: 16, rot });

// ---------------------------------------------------------------- overview
export function renderCardsHome(root, ctx) {
  const { exam } = ctx;
  const cards = buildCards(ctx.questions, ctx.flashcards);
  const st = deckStatus(cards, loadProgress(exam.id).cards);

  const tiles = [
    tile('yellow', 'Due today', 'layers', st.due, st.due === 1 ? 'card' : 'cards', 1),
    tile('coral', 'To review', 'rotate-ccw', st.review + st.learning, 'back again'),
    tile('lilac', 'New today', 'play', st.newToday, 'to learn', -1),
    tile('cream', 'Learned', 'circle-check', st.learned, `/ ${st.total}`),
  ];
  const stats = h('section', { class: 'stats', 'aria-label': 'Flashcard progress' }, tiles);

  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('play', 22), st.due ? `Start (${st.due} cards)` : 'Nothing due');
  startBtn.disabled = !st.due;
  const startObj = FX.obj(startBtn, { cls: 'o-btn' });
  startBtn.addEventListener('click', (e) => {
    const queue = buildQueue(cards, loadProgress(exam.id).cards);
    const at = pos(e, startBtn);
    FX.transition(() => runCards(root, ctx, cards, queue), at);
  });
  const summary = h('p', { class: 'setup-summary', role: 'status' },
    st.due ? `${st.review + st.learning} to review, ${st.newToday} new` : st.next ? `All caught up. Next card due ${dueWhen(st.next)}.` : 'No cards in this deck.');

  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Flashcards'),
    h('p', { class: 'lead' }, 'Read the front, say the answer to yourself, flip the card, then rate how it went. Cards you miss come back sooner; cards you know come back later.'),
    stats,
    h('div', { class: 'start-row' }, startObj, summary),
    h('p', { class: 'fine', style: { marginTop: '18px' } }, `${cards.length} cards from this exam's own questions, each with its source. Up to ${NEW_PER_DAY} new cards a day.`));

  const base = FX.base();
  FX.enter(tiles, { delay: base, stagger: 0.06 });
  stats.querySelectorAll('.cnt').forEach((c, k) => FX.count(c, +c.dataset.to, { duration: 0.8, delay: base + 0.2 + k * 0.06 }));
  FX.enter([startObj], { y: 30, delay: base + 0.4, spring: FX.spring.soft });
}

// ---------------------------------------------------------------- one card
/** The card as an object: a front and a back that flip. Built ahead of time, so dealing it costs almost nothing. */
function cardView(card, docs, topicTitle) {
  const long = card.back.length > 140;
  const front = h('div', { class: 'fside f-front' },
    h('div', { class: 'qmeta' }, h('span', { class: 'chip accent' }, topicTitle), h('span', { class: 'chip' }, TYPE_LABEL[card.type])),
    h('h1', { class: 'qtext' }, card.front),
    h('p', { class: 'flip-hint' }, h('kbd', null, 'Space'), ' or tap the card to see the answer'));
  const back = h('div', { class: 'fside f-back', inert: true },
    h('div', { class: 'qmeta' }, h('span', { class: 'chip yellow' }, 'Answer')),
    h('p', { class: 'q-small' }, card.front),
    h('p', { class: `answer-big${long ? ' long' : ''}` }, h('span', { class: 'hl' }, card.back)),
    card.explanation ? h('p', { class: 'explain' }, card.explanation) : null,
    card.flag ? h('p', { class: 'check-source' }, h('span', { class: 'warn-badge' }, icon('triangle-alert', 13)), h('span', null, h('strong', null, 'Check the source: '), card.flag)) : null,
    h('p', { class: 'source' }, icon('book-open', 14), sourceText(card, docs)));
  const flipper = h('div', { class: 'flipper' }, front, back);
  const face = h('article', { class: 'fcard', role: 'button', tabindex: 0, 'aria-label': 'Show answer' }, flipper);
  const el = FX.obj(face, { cls: 'o-fcard', z: 0 });
  const view = {
    card, el, face, revealed: false,
    reveal() {
      view.revealed = true;
      front.inert = true; back.inert = false;
      face.classList.add('shown'); face.removeAttribute('role'); face.removeAttribute('tabindex'); face.removeAttribute('aria-label');
      FX.anim(flipper, { rotateY: 180 }, FX.spring.flip);
    },
  };
  return view;
}

// ---------------------------------------------------------------- session
export function runCards(root, ctx, cards, queue, { label = 'Flashcards' } = {}) {
  const { exam, topics } = ctx;
  if (!queue.length) { renderCardsHome(root, ctx); return; }
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  const total = queue.length;
  const states = loadProgress(exam.id).cards;
  const counts = { again: 0, hard: 0, good: 0, easy: 0 };
  const cache = new Map();                      // card id -> view built ahead of time
  let done = 0, current = null, busy = false, over = false;

  // top: end button, cards left, progress blocks
  const exitBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'End session' }, icon('x', 18));
  const leftEl = h('span', { class: 'lab' });
  const nBlocks = total <= 24 ? total : 20;
  const segs = h('div', { class: 'quiz-segs', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-label': 'Cards finished' }, Array.from({ length: nBlocks }, () => h('i')));
  const paintSegs = (pop) => {
    const filled = total <= 24 ? done : Math.floor((done * nBlocks) / total);
    [...segs.children].forEach((b, k) => {
      const was = b.classList.contains('done');
      b.classList.toggle('done', k < filled);
      if (pop && k < filled && !was) FX.anim(b, { scale: [1.25, 1] }, FX.spring.bouncy);
    });
    segs.setAttribute('aria-valuenow', done);
    leftEl.textContent = `${queue.length} left`;
  };

  // the stack: two offset cards behind the front one
  const back1 = h('div', { class: 'fback b1', 'aria-hidden': 'true' }), back2 = h('div', { class: 'fback b2', 'aria-hidden': 'true' });
  const backs = [[back1, { x: 9, y: 11, rotate: 1.6 }], [back2, { x: -7, y: 21, rotate: -1.8 }]];
  const slot = h('div', { class: 'fslot' });
  const stack = h('div', { class: 'fstack' }, back2, back1, slot);
  const mascot = FX.mascot();
  const deck = h('div', { class: 'deck' }, mascot, stack);
  const paintStack = () => backs.forEach(([b, to], k) => FX.anim(b, { ...to, opacity: queue.length > k + 1 ? 1 : 0 }, FX.spring.soft));

  // controls: "Show answer", then the four ratings
  const revealBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('rotate-ccw', 20), 'Show answer', h('kbd', null, 'Space'));
  const revealRow = h('div', { class: 'reveal-row' }, FX.obj(revealBtn, { cls: 'o-btn' }));
  const rateBtns = RATINGS.map((r, k) => {
    const nextEl = h('span', { class: 'r-next' });
    const b = h('button', { class: `btn rate ${r}`, type: 'button' }, h('kbd', { 'data-key': String(k + 1), 'aria-hidden': 'true' }), h('span', { class: 'r-name' }, NAME[r]), ' ', nextEl);   // the digit is drawn by CSS, so the spoken name matches the visible words
    b.addEventListener('click', (e) => rateCurrent(r, e));
    return { r, b, nextEl, obj: FX.obj(b, { cls: 'o-btn o-rate', fill: true }) };
  });
  const rates = h('div', { class: 'rates', role: 'group', 'aria-label': 'How well did you know it?', hidden: true }, rateBtns.map((x) => x.obj));
  const controls = h('div', { class: 'fcontrols' }, revealRow, rates);
  const hints = h('p', { class: 'fine fhints' }, 'Rate with ', h('kbd', null, '1'), h('kbd', null, '2'), h('kbd', null, '3'), h('kbd', null, '4'), ' after flipping');

  mount(root, h('div', { class: 'quiz-wrap fstage' },
    h('div', { class: 'quiz-top' }, h('div', { class: 'left' }, FX.obj(exitBtn, { cls: 'o-icon' }), leftEl)),
    segs, deck, controls, hints));
  revealBtn.addEventListener('click', () => reveal());

  // ---- cards
  const build = (card) => cardView(card, exam.documents, topicTitle(card.topic));
  const take = (card) => { const v = cache.get(card.id) || build(card); cache.delete(card.id); return v; };
  /** While you read this card, the next one is built and laid out (hidden), so dealing it later is cheap. */
  const prebuild = () => {
    const next = queue[1];
    for (const [id, v] of cache) if (id !== next?.id) { v.el.remove(); cache.delete(id); }
    if (!next || cache.has(next.id)) return;
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 50)))(() => {
      if (over || queue[1] !== next || cache.has(next.id)) return;
      const v = build(next);
      v.el.classList.add('pre');
      slot.append(v.el);
      cache.set(next.id, v);
    }, { timeout: 500 });
  };
  const deal = (delay = 0) => {
    current = take(queue[0]);
    current.el.classList.remove('pre');
    if (!current.el.isConnected) slot.append(current.el);
    current.face.addEventListener('click', () => reveal());
    revealRow.hidden = false; rates.hidden = true;
    M.animate(current.el, { opacity: 0, y: 18, scale: 0.97, rotate: 1.2 }, { duration: 0 });
    FX.anim(current.el, { opacity: 1, y: 0, scale: 1, rotate: 0 }, { ...FX.spring.deal, delay });
    prebuild();
  };

  const reveal = () => {
    if (!current || current.revealed || busy || over) return;
    current.reveal();
    const prev = states[current.card.id];
    rateBtns.forEach((x) => { x.nextEl.textContent = nextLabel(prev, x.r); });   // the button's name is its visible text, e.g. "Good 1 day"
    revealRow.hidden = true; rates.hidden = false;
    FX.sound('click');
    FX.enter(rateBtns.map((x) => x.obj), { y: 18, delay: 0.1, stagger: 0.045, spring: FX.spring.soft });
  };

  function rateCurrent(rating, evt) {
    if (!current || !current.revealed || busy || over) return;
    busy = true;
    const view = current, card = view.card;
    const state = rate(states[card.id], rating);
    states[card.id] = state;
    recordCard(exam.id, card.id, state);
    counts[rating] += 1;
    queue.shift();
    if (state.interval === 0) queue.splice(Math.min(REINSERT[rating], queue.length), 0, card);   // still learning: it returns this session
    else done += 1;

    const at = pos(evt, view.el);
    if (rating === 'again') { FX.sound('thud'); mascot.mood('sad', 1800); }
    else {
      FX.sound(rating === 'hard' ? 'click' : 'pop');
      if (rating !== 'hard') FX.confetti(at.x, at.y, { count: rating === 'easy' ? 10 : 6 });
      mascot.mood(rating === 'hard' ? 'idle' : 'happy', 1500);
    }
    paintSegs(true);
    if (!queue.length) { finish(true, at); return; }
    paintStack();
    revealRow.hidden = true; rates.hidden = true;

    const fly = rating === 'again' ? { x: -560, y: -50, rotate: -14, opacity: 0 } : { x: 560, y: -110, rotate: 14, opacity: 0 };
    const after = () => { view.el.remove(); deal(0); busy = false; };
    FX.anim(view.el, fly, { duration: 0.26, ease: [0.5, 0, 0.9, 0.5] }).then(after, after);
  }

  function finish(completed, at) {
    if (over) return;
    over = true;
    document.removeEventListener('keydown', onKey);
    if (active === session) active = null;
    const reviewed = RATINGS.reduce((s, r) => s + counts[r], 0);
    if (reviewed) recordSession(exam.id, { mode: 'cards', label, answered: reviewed, score: counts.good + counts.easy, bestStreak: 0 });
    FX.transition(() => renderSummary(root, ctx, cards, { counts, reviewed, completed }), at || centreOf(deck));
  }
  exitBtn.addEventListener('click', (e) => finish(false, pos(e, exitBtn)));

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.target === document.body || e.target.closest?.('.fstage')) { if (current && !current.revealed) { e.preventDefault(); reveal(); } }
      return;
    }
    const k = '1234'.indexOf(e.key);
    if (k >= 0 && e.key.length === 1) { e.preventDefault(); rateCurrent(RATINGS[k]); }
  };
  document.addEventListener('keydown', onKey);
  active?.destroy();
  const session = { destroy() { over = true; document.removeEventListener('keydown', onKey); if (active === session) active = null; } };
  active = session;

  // first deal: the stack fans out, then the front card drops in
  const base = FX.base();
  paintSegs();
  backs.forEach(([b, to], k) => {
    M.animate(b, { x: 0, y: 0, rotate: 0, opacity: 0 }, { duration: 0 });
    if (queue.length > k + 1) FX.anim(b, { ...to, opacity: 1 }, { ...FX.spring.deal, delay: base + 0.08 + k * 0.05 });
  });
  deal(base);
}

// ---------------------------------------------------------------- summary
function renderSummary(root, ctx, cards, { counts, reviewed, completed }) {
  const { exam } = ctx;
  const st = deckStatus(cards, loadProgress(exam.id).cards);
  const mood = counts.again > reviewed / 2 ? 'sad' : 'happy';
  const numEl = h('span', null, reviewed);
  const mascot = FX.mascot(); mascot.dataset.mood = mood;
  const scoreFace = h('div', { class: 'score-card' },
    h('div', { class: 'score-row' }, h('div', { class: 'score-num' }, numEl, h('small', null, reviewed === 1 ? 'card' : 'cards'))),
    h('div', { class: 'meta' }, RATINGS.map((r) => h('span', { class: `chip rc ${r}` }, `${NAME[r]} ${counts[r]}`))),
    h('div', { class: 'mascot-spot' }, mascot));
  const scoreObj = FX.obj(scoreFace, { cls: 'o-tile', tilt: 4, shine: true, fill: true, z: 12 });

  const pctLearned = st.total ? Math.round((st.learned / st.total) * 100) : 0;
  const deckFace = h('div', { class: 'card' }, h('h3', null, 'Your deck'),
    h('div', { class: 'brow' }, h('div', { class: 'nm' }, 'Learned', h('span', null, `${st.learned} of ${st.total} cards`)),
      h('span', { class: 'segs', 'data-filled': Math.round(pctLearned / 10) }, Array.from({ length: 10 }, () => h('i'))), h('span', { class: 'pct' }, `${pctLearned}%`)),
    h('p', { class: 'deck-line' }, st.due ? `${st.due} still due today.` : 'Nothing else is due today.'),
    h('p', { class: 'deck-line' }, st.next ? `Next card due ${dueWhen(st.next)}.` : 'No cards are scheduled yet.'));
  const deckObj = FX.obj(deckFace, { cls: 'o-tile', fill: true, hover: false });

  const more = st.due ? h('a', { class: 'btn yellow xl', href: `#/exam/${exam.id}/cards` }, icon('play', 20), `Keep going (${st.due})`) : null;
  const actions = h('div', { class: 'actions' },
    more ? FX.obj(more, { cls: 'o-btn' }) : null,
    FX.obj(h('a', { class: `btn xl${more ? '' : ' yellow'}`, href: `#/exam/${exam.id}/cards` }, 'Flashcards overview'), { cls: 'o-btn' }),
    h('a', { class: 'btn textlink', href: `#/exam/${exam.id}` }, 'Back to exam'));
  mount(root,
    h('h1', { class: 'pagetitle' }, completed ? 'Session done' : 'Session saved'),
    h('p', { class: 'pagesub lab' }, `${exam.shortTitle || exam.title} / flashcards`),
    h('section', { class: 'results-top' }, scoreObj, deckObj),
    actions);
  window.scrollTo(0, 0);

  const base = FX.base();
  FX.enter([scoreObj, deckObj], { delay: base, stagger: 0.08, y: -50 });
  FX.count(numEl, reviewed, { duration: 0.9, delay: base + 0.15 });
  deckFace.querySelectorAll('.segs').forEach((s) => FX.fillSegs(s, { delay: base + 0.4 }));
  FX.enter([...actions.querySelectorAll(':scope > .obj, :scope > a')], { y: 22, delay: base + 0.6, stagger: 0.05, spring: FX.spring.soft });
  mascot.mood(mood, 2500);
  if (completed && reviewed) setTimeout(() => { const r = numEl.getBoundingClientRect(); FX.confetti(r.left + 40, r.top + 20, { count: 8 }); }, (base + 0.5) * 1000);
}
