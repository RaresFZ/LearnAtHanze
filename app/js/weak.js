// Weak spots: aims the existing quiz and flashcard sessions at the questions and cards you keep missing.
// What counts as weak is decided in progress.js; this screen only picks, explains and starts a session.
import { h, mount, shuffle, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { buildCards } from './cards.js';
import { loadProgress } from './store.js';
import { WEAK_MISSES, RECOVERED_STREAK, RECOVERED_DAYS, weakQuestions, weakCards } from './progress.js';
import { runQuiz, pillBtn } from './quiz.js';
import { runCards, tile } from './flashcards.js';

const PER_SESSION = 20;                       // a session takes the weakest few, so it stays short
const LEVELS = [[WEAK_MISSES, `Missed ${WEAK_MISSES}+ times`], [1, 'Missed at least once']];
const pos = (e, el) => { if (e && e.clientX) return { x: e.clientX, y: e.clientY }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Counts for the exam page tile (default level). */
export function weakCounts(ctx) {
  const p = loadProgress(ctx.exam.id);
  return { questions: weakQuestions(p, ctx.questions).length, cards: weakCards(p, buildCards(ctx.questions, ctx.flashcards)).length };
}

export function renderWeak(root, ctx) {
  const { exam, topics, questions } = ctx;
  const allCards = buildCards(questions, ctx.flashcards);
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  let level = WEAK_MISSES;
  let wq = [], wc = [];

  // one column per kind: a tile with the count, one line of explanation, and the start button
  const col = (cls, label, ic, rot, small, btnIcon, btnText) => {
    const t = tile(cls, label, ic, 0, small, rot);
    const num = t.querySelector('.cnt');
    const note = h('p', { class: 'setup-summary', role: 'status' });
    const btn = h('button', { class: 'btn yellow xl', type: 'button' }, icon(btnIcon, 22), btnText);
    const btnObj = FX.obj(btn, { cls: 'o-btn' });
    return { el: h('div', { class: 'weak-col' }, t, h('div', { class: 'start-row' }, btnObj, note)), tile: t, num, note, btn, btnObj };
  };
  const qCol = col('coral', 'Questions', 'list-checks', 1, 'to practise', 'play', 'Quiz me');
  const cCol = col('lilac', 'Cards', 'layers', -1, 'to review', 'rotate-ccw', 'Review cards');

  qCol.btn.addEventListener('click', (e) => {
    const picks = shuffle(wq.slice(0, PER_SESSION).map((w) => w.q));
    FX.transition(() => runQuiz(root, ctx, picks, { label: 'Weak spots' }), pos(e, qCol.btn));
  });
  cCol.btn.addEventListener('click', (e) => {
    const picks = shuffle(wc.slice(0, PER_SESSION).map((w) => w.card));
    FX.transition(() => runCards(root, ctx, allCards, picks, { label: 'Weak spots' }), pos(e, cCol.btn));
  });

  const levelBtns = LEVELS.map(([val, label]) => pillBtn(label, val === level, () => { level = val; paint(); }));
  const levelRow = h('div', { class: 'pills' }, levelBtns);

  const byTopic = h('div', { class: 'card weak-topics' });
  const topicsObj = FX.obj(byTopic, { cls: 'o-tile', fill: true, hover: false });
  const empty = h('div', { class: 'fresh-note' }, FX.mascot(), h('div', { class: 'bubble' }));
  const segsFor = (n) => h('span', { class: 'segs', 'data-filled': n }, Array.from({ length: 10 }, () => h('i')));

  const paint = (delay = 0) => {
    const p = loadProgress(exam.id);
    wq = weakQuestions(p, questions, level);
    wc = weakCards(p, allCards, level);
    levelBtns.forEach((o, k) => o.querySelector('.pill-btn').setAttribute('aria-pressed', String(LEVELS[k][0] === level)));
    for (const [c, list, noun] of [[qCol, wq, 'question'], [cCol, wc, 'card']]) {
      c.num.textContent = list.length;
      c.btn.disabled = !list.length;
      c.note.textContent = !list.length ? `No ${noun}s to practise` : list.length > PER_SESSION ? `The weakest ${PER_SESSION} of ${list.length}` : `All ${plural(list.length, noun, noun + 's')}`;
    }

    // where they are: topics with weak items, and what share of the topic's questions that is
    const rows = topics.map((t) => {
      const q = wq.filter((w) => w.q.topic === t.id).length;
      const c = wc.filter((w) => w.card.topic === t.id).length;
      const total = questions.filter((x) => x.topic === t.id).length;
      return { t, q, c, total };
    }).filter((r) => r.q || r.c).sort((a, b) => (b.q + b.c) - (a.q + a.c));
    byTopic.replaceChildren(h('h3', null, 'Where they are'),
      ...rows.map((r) => h('div', { class: 'brow' },
        h('div', { class: 'nm' }, r.t.title, h('span', null, [r.q ? `${r.q} of ${plural(r.total, 'question', 'questions')}` : '', r.c ? plural(r.c, 'card', 'cards') : ''].filter(Boolean).join(', '))),
        segsFor(r.q ? Math.max(1, Math.round(pct(r.q, r.total) / 10)) : 0), h('span', { class: 'pct' }, r.q ? `${pct(r.q, r.total)}%` : '–'))));
    byTopic.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: delay + k * 0.04 }));
    topicsObj.hidden = !rows.length;

    empty.hidden = !!(wq.length || wc.length);
    empty.querySelector('.bubble').textContent = level === 1
      ? 'Nothing missed yet. Questions and cards show up here after you get them wrong.'
      : `Nothing is weak yet. A question or card shows up here once you have missed it ${WEAK_MISSES} times.`;
  };

  const stats = h('div', { class: 'weak-grid' }, qCol.el, cCol.el);
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Weak spots'),
    h('p', { class: 'lead' }, 'The questions and cards you keep missing, in the same quiz and flashcard sessions as always. Your answers are saved like any other.'),
    h('section', { class: 'field', style: { marginTop: '24px' } }, h('h2', { class: 'small' }, 'What counts as weak'), levelRow),
    stats, empty, topicsObj,
    h('p', { class: 'fine', style: { marginTop: '24px' } },
      `A question stays here until you answer it right ${RECOVERED_STREAK} times in a row. A card stays until it is scheduled ${RECOVERED_DAYS} or more days out again. The two lists are separate: quiz answers and flashcard ratings are tracked apart.`),
    h('div', { class: 'actions' }, FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/progress` }, icon('chart-column', 18), 'See all progress'), { cls: 'o-btn' })));
  const base = FX.base();
  paint(base + 0.7);
  FX.enter([qCol.tile, cCol.tile], { delay: base, stagger: 0.07 });
  FX.enter([qCol, cCol].map((c) => c.el.querySelector('.start-row')), { y: 30, delay: base + 0.3, stagger: 0.06, spring: FX.spring.soft });
  FX.enter([topicsObj], { y: 28, delay: base + 0.45, spring: FX.spring.soft });
  [qCol, cCol].forEach((c, k) => FX.count(c.num, +c.num.textContent, { duration: 0.8, delay: base + 0.2 + k * 0.06 }));
}
