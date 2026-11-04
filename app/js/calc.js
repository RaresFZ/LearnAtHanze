// Calculation trainer screens: setup -> one calculation at a time (fresh numbers, formula and steps after each answer) -> results.
// The rules and the generators are in calc-data.js.
import { h, mount, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress, recordCalc, recordSession } from './store.js';
import { pillBtn } from './quiz.js';
import { sourceText } from './question.js';
import { GROUPS, GENERATORS, generatorsFor, makeSet, gradeNumber } from './calc-data.js';

const COUNTS = [5, 10, 20];
const pos = (e, el) => { if (e && e.clientX) return { x: e.clientX, y: e.clientY }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const card = (face) => FX.obj(face, { cls: 'o-tile', fill: true, hover: false });
const segsFor = (share) => h('span', { class: 'segs', 'data-filled': Math.round(share * 10) }, Array.from({ length: 10 }, () => h('i')));

/** True when this exam has calculations to practise (Exam A). */
export const hasCalc = (examId) => generatorsFor(examId).length > 0;

// ---------------------------------------------------------------- setup
export function renderCalcHome(root, ctx) {
  const { exam, lessons } = ctx;
  const progress = loadProgress(exam.id);
  const gens = generatorsFor(exam.id);
  if (!gens.length) { mount(root, h('p', { class: 'lead' }, 'This exam has no calculations to practise. ', h('a', { href: `#/exam/${exam.id}`, class: 'back' }, 'Back to the exam'))); return; }
  const state = { groups: new Set(), count: 10 };
  const summary = h('p', { class: 'setup-summary', role: 'status' });
  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('play', 22), 'Start');
  const refresh = () => {
    const n = gens.filter((g) => !state.groups.size || state.groups.has(g.group)).length;
    summary.textContent = `${state.count} calculations from ${n} types, new numbers every time`;
  };
  const toggles = GROUPS.map((g) => {
    const n = gens.filter((x) => x.group === g.id).length;
    const b = h('button', { class: 'toggle', type: 'button', 'aria-pressed': 'false' }, h('span', { class: 'box' }, icon('check', 14)), h('span', { class: 't' }, g.label), h('span', { class: 'count' }, n));
    b.addEventListener('click', () => { state.groups.has(g.id) ? state.groups.delete(g.id) : state.groups.add(g.id); b.setAttribute('aria-pressed', String(state.groups.has(g.id))); refresh(); });
    return FX.obj(b, { cls: 'o-tile', tilt: 0, z: 10 });
  });
  const counts = COUNTS.map((c) => pillBtn(String(c), c === state.count, () => { state.count = c; counts.forEach((o, k) => o.querySelector('.pill-btn').setAttribute('aria-pressed', String(COUNTS[k] === c))); refresh(); }));

  startBtn.addEventListener('click', (e) => {
    const set = makeSet(exam.id, { groups: [...state.groups], n: state.count });
    FX.transition(() => runCalc(root, ctx, set, { groups: [...state.groups], count: state.count }), pos(e, startBtn));
  });

  // how each type has gone so far
  const rows = gens.map((g) => {
    const c = progress.calc[g.id];
    return h('div', { class: 'brow' },
      h('div', { class: 'nm' }, g.label, h('span', null, c ? `${c.right} of ${c.n} right` : 'not tried yet')),
      segsFor(c && c.n ? c.right / c.n : 0), h('span', { class: 'pct' }, c && c.n ? `${pct(c.right, c.n)}%` : '–'));
  });
  const statsFace = h('div', { class: 'card' }, h('h3', null, 'How each type has gone'), rows);
  const statsObj = card(statsFace);

  const sections = [
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'What to practise', h('span', { class: 'lab' }, 'none selected = all')), h('div', { class: 'togglegrid' }, toggles)),
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'How many calculations'), h('div', { class: 'pills' }, counts)),
    h('div', { class: 'start-row' }, FX.obj(startBtn, { cls: 'o-btn' }), summary),
    statsObj,
  ];
  mount(root,
    h('a', { class: 'back', href: lessons ? `#/exam/${exam.id}/learn` : `#/exam/${exam.id}` }, icon('arrow-left', 14), lessons ? 'Study path' : exam.title),
    h('h1', { class: 'pagetitle' }, 'Calculation trainer'),
    h('p', { class: 'lead' }, 'Fresh numbers every time. Type your answer, then see the formula and the steps. Calculations are learned by doing them, again and again.'),
    sections);
  refresh();
  const base = FX.base();
  FX.enter(sections, { y: 30, delay: base, stagger: 0.07, spring: FX.spring.soft });
  statsFace.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.5 + k * 0.03 }));
}

// ---------------------------------------------------------------- one calculation at a time
export function runCalc(root, ctx, set, opts = {}) {
  const { exam } = ctx;
  const total = set.length;
  const results = [];
  let i = 0, answered = false, over = false, keyOff = null;

  const exitBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'End' }, icon('x', 18));
  const count = h('span', { class: 'lab' });
  const segs = h('div', { class: 'quiz-segs', role: 'progressbar', 'aria-label': 'Calculations answered', 'aria-valuemin': 0, 'aria-valuemax': total }, Array.from({ length: Math.min(total, 20) }, () => h('i')));
  const nBlocks = segs.children.length;
  const stage = h('div', { class: 'deck' });
  mount(root, h('div', { class: 'quiz-wrap' }, h('div', { class: 'quiz-top' }, h('div', { class: 'left' }, FX.obj(exitBtn, { cls: 'o-icon' }), count)), segs, stage));

  const paintSegs = () => {
    const done = total <= 20 ? results.length : Math.floor((results.length * nBlocks) / total);
    [...segs.children].forEach((b, k) => { b.classList.toggle('done', k < done); b.classList.toggle('current', k === Math.min(done, nBlocks - 1) && k >= done); });
    segs.setAttribute('aria-valuenow', results.length);
    count.textContent = `Calculation ${Math.min(i + 1, total)} / ${total}`;
  };

  const finish = (e) => {
    if (over) return; over = true; keyOff?.();
    if (results.length) recordSession(exam.id, { mode: 'calc', label: 'Calculations', answered: results.length, score: results.filter((r) => r.right).length, bestStreak: 0 });
    FX.transition(() => renderCalcResults(root, ctx, results, total, opts), pos(e, exitBtn));
  };
  exitBtn.addEventListener('click', finish);

  const deal = () => {
    const q = set[i];
    answered = false;
    const input = h('input', { class: 'face', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: 'Your answer', 'aria-label': 'Your answer' });
    const inputObj = FX.obj(input, { cls: 'o-input', hover: false });
    const check = h('button', { class: 'btn yellow', type: 'button' }, 'Check answer');
    const next = h('button', { class: 'btn yellow', type: 'button', hidden: true }, i + 1 >= total ? 'See results' : 'Next calculation');
    const fb = h('div', { class: 'fb-slot', role: 'status' });
    const face = h('div', { class: 'qcard' },
      h('div', { class: 'qmeta' }, h('span', { class: 'chip accent' }, q.label)),
      h('h2', { class: 'qtext' }, q.prompt),
      h('div', { class: 'calc-row' }, inputObj, q.unit ? h('span', { class: 'chip' }, q.unit) : null, FX.obj(check, { cls: 'o-btn' }), FX.obj(next, { cls: 'o-btn' })),
      fb);

    const submit = (e) => {
      if (answered) return;
      if (!input.value.trim()) { input.focus(); return; }
      answered = true;
      const right = gradeNumber(input.value, q.answer, q.decimals);
      results.push({ q, right, typed: input.value.trim() });
      recordCalc(exam.id, q.gid, right);
      input.disabled = true; check.hidden = true; check.closest('.obj').hidden = true; next.hidden = false; next.closest('.obj').hidden = false;
      const shown = `${q.answer.toLocaleString('en-US', { minimumFractionDigits: q.decimals, maximumFractionDigits: q.decimals })}${q.unit === '%' ? '%' : q.unit ? ` ${q.unit}` : ''}`;
      const note = h('div', { class: 'note-card fb' },
        h('span', { class: `label ${right ? 'good' : 'bad'}` }, icon(right ? 'check' : 'x', 14), right ? 'Correct' : 'Not quite'),
        right ? null : h('p', { class: 'answer-line' }, h('span', { class: 'lab' }, 'Answer'), h('span', { class: 'hl' }, shown)),
        h('p', { class: 'explain' }, h('strong', null, 'Formula: '), q.formula),
        h('div', { class: 'calc-steps' }, q.steps.map((s) => h('p', null, s))),
        h('p', { class: 'source' }, icon('book-open', 14), sourceText({ src: q.src }, exam.documents)));
      const wrap = h('div', { class: 'note-wrap' }, note);
      fb.replaceChildren(wrap);
      window.Motion.animate(wrap, { opacity: 0, y: 26 }, { duration: 0 }); FX.anim(wrap, { opacity: 1, y: 0 }, { ...FX.spring.deal, delay: 0.1 });
      const r = (e && e.clientX) ? { x: e.clientX, y: e.clientY } : pos(null, check);
      if (right) { FX.confetti(r.x, r.y, { count: 8 }); FX.sound('pop'); } else FX.sound('thud');
      paintSegs();
      next.focus({ preventScroll: true });
    };
    const advance = () => {
      if (!answered) return;
      if (i + 1 >= total) { finish(); return; }
      i += 1; paintSegs();
      const old = stage.firstChild;
      FX.anim(old, { x: 520, y: -90, rotate: 12, opacity: 0 }, { duration: 0.26, ease: [0.5, 0, 0.9, 0.5] }).then(() => { old.remove(); deal(); }, () => { old.remove(); deal(); });
    };
    check.addEventListener('click', submit);
    next.addEventListener('click', advance);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(e); } });
    keyOff?.();
    const onKey = (e) => { if (e.key === 'Enter' && answered && document.activeElement !== input) { e.preventDefault(); advance(); } };
    document.addEventListener('keydown', onKey);
    keyOff = () => document.removeEventListener('keydown', onKey);

    next.closest('.obj').hidden = true;
    const wrapper = h('div', { class: 'calc-card-wrap' }, FX.obj(face, { cls: 'o-card', hover: false }));
    stage.replaceChildren(wrapper);
    FX.anim(wrapper, { opacity: [0, 1], y: [-40, 0], rotate: [-2, 0] }, { ...FX.spring.deal, delay: FX.base() });
    input.focus({ preventScroll: true });
  };
  paintSegs();
  deal();
  window.addEventListener('hashchange', () => keyOff?.(), { once: true });
}

// ---------------------------------------------------------------- results
function renderCalcResults(root, ctx, results, total, opts) {
  const { exam } = ctx;
  const right = results.filter((r) => r.right).length;
  const percent = pct(right, results.length);
  const missed = results.filter((r) => !r.right);
  const byType = new Map();
  for (const r of results) { const t = byType.get(r.q.gid) || { label: r.q.label, n: 0, ok: 0 }; t.n += 1; if (r.right) t.ok += 1; byType.set(r.q.gid, t); }
  const stamp = percent >= 100 ? 'Boss mode' : percent >= 85 ? 'Nailed it' : percent >= 65 ? 'Solid' : percent >= 45 ? 'Almost' : 'Keep going';

  const scoreFace = h('div', { class: 'score-card' },
    h('div', { class: 'score-row' }, h('div', { class: 'score-num' }, h('span', null, results.length ? percent : 0), h('small', null, '%')), h('div', { class: 'stamp-spot' }, h('div', { class: 'stamp' }, results.length ? stamp : 'No answers'))),
    h('div', { class: 'meta' }, h('p', null, `${right} of ${results.length} calculations right`), h('span', { class: 'chip' }, `${missed.length} to redo`), results.length < total ? h('span', { class: 'chip' }, `${total - results.length} unanswered`) : null));
  const scoreObj = FX.obj(scoreFace, { cls: 'o-tile', tilt: 4, shine: true, fill: true, z: 12 });
  const typeFace = h('div', { class: 'card' }, h('h3', null, 'By type'),
    byType.size ? [...byType.values()].map((t) => h('div', { class: 'brow' }, h('div', { class: 'nm' }, t.label, h('span', null, `${t.ok} of ${t.n} right`)), segsFor(t.ok / t.n), h('span', { class: 'pct' }, `${pct(t.ok, t.n)}%`))) : h('p', null, 'Nothing answered yet.'));
  const typeObj = FX.obj(typeFace, { cls: 'o-tile', fill: true, hover: false });

  const redo = missed.map(({ q, typed }, k) => h('details', { class: 'review', open: k === 0 },
    h('summary', null, h('span', null, q.prompt), icon('chevron-down', 22)),
    h('div', { class: 'body' },
      h('p', { class: 'fine' }, `You typed: ${typed}`),
      h('span', { class: 'lab' }, 'Answer'), h('p', { class: 'answer' }, h('span', { class: 'hl' }, `${q.answer.toLocaleString('en-US', { minimumFractionDigits: q.decimals, maximumFractionDigits: q.decimals })}${q.unit ? (q.unit === '%' ? '%' : ` ${q.unit}`) : ''}`)),
      h('p', { class: 'why' }, h('strong', null, 'Formula: '), q.formula),
      h('div', { class: 'calc-steps' }, q.steps.map((s) => h('p', null, s))))));

  const retry = h('button', { class: 'btn yellow xl', type: 'button' }, icon('rotate-ccw', 20), `Same types, new numbers`);
  retry.addEventListener('click', (e) => {
    const gids = [...new Set((missed.length ? missed : results).map((r) => r.q.gid))];
    const set = [];
    for (let n = 0; n < Math.max(5, missed.length); n++) {
      const g = GENERATORS.find((x) => x.id === gids[n % gids.length]);
      set.push({ gid: g.id, group: g.group, label: g.label, src: g.src, ...g.make(Math.random) });
    }
    FX.transition(() => runCalc(root, ctx, set, opts), pos(e, retry));
  });
  const actions = h('div', { class: 'actions' }, FX.obj(retry, { cls: 'o-btn' }),
    FX.obj(h('a', { class: 'btn xl', href: `#/exam/${exam.id}/calc` }, 'New set'), { cls: 'o-btn' }),
    h('a', { class: 'btn textlink', href: ctx.lessons ? `#/exam/${exam.id}/learn` : `#/exam/${exam.id}` }, 'Back'));
  mount(root, h('div', null,
    h('h1', { class: 'pagetitle' }, 'Calculations finished'),
    h('p', { class: 'pagesub lab' }, `${exam.shortTitle || exam.title} / ${results.length} answered`),
    h('section', { class: 'results-top' }, scoreObj, typeObj),
    h('h2', { class: 'section' }, missed.length ? `To redo (${missed.length})` : 'Nothing to redo'),
    missed.length ? h('div', { class: 'review-list' }, redo) : h('p', { class: 'lead' }, 'You got every calculation right.'),
    actions));
  window.scrollTo(0, 0);
  const base = FX.base();
  FX.enter([scoreObj, typeObj], { delay: base, stagger: 0.08, y: -50 });
  typeFace.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.35 + k * 0.1 }));
}
