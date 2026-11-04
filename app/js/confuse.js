// "Easily confused" screens: side-by-side comparison of look-alike terms, then a drill (a statement, pick the term it describes).
// Rules and the content checks are in confuse-data.js; the groups are in content/<exam>/confusions.json.
import { h, mount, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress, recordConfuse, recordSession } from './store.js';
import { pillBtn } from './quiz.js';
import { sourceText } from './question.js';
import { drillItems, groupStat } from './confuse-data.js';

const COUNTS = [10, 20];
const pos = (e, el) => { if (e && e.clientX) return { x: e.clientX, y: e.clientY }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const card = (face) => FX.obj(face, { cls: 'o-tile', fill: true, hover: false });
const segsFor = (share) => h('span', { class: 'segs', 'data-filled': Math.round(share * 10) }, Array.from({ length: 10 }, () => h('i')));
const SCRIBBLE = '<svg class="scribble" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M2 11 C 22 3, 42 16, 64 8 S 104 14, 126 7 S 170 13, 198 6"/></svg>';

export const hasConfusions = (ctx) => !!ctx.confusions?.groups?.length;

// ---------------------------------------------------------------- compare and choose
export function renderConfuseHome(root, ctx) {
  const { exam, confusions, lessons } = ctx;
  if (!hasConfusions(ctx)) { mount(root, h('p', { class: 'lead' }, 'There are no look-alike terms for this exam yet. ', h('a', { href: `#/exam/${exam.id}`, class: 'back' }, 'Back to the exam'))); return; }
  const progress = loadProgress(exam.id);
  const groups = confusions.groups;
  let count = 10;

  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('play', 22), 'Drill all groups');
  startBtn.addEventListener('click', (e) => FX.transition(() => runConfuse(root, ctx, drillItems(groups, { n: count }), {}), pos(e, startBtn)));
  const counts = COUNTS.map((c) => pillBtn(`${c} questions`, c === count, () => { count = c; counts.forEach((o, k) => o.querySelector('.pill-btn').setAttribute('aria-pressed', String(COUNTS[k] === c))); }));

  const rows = groups.map((g) => {
    const st = groupStat(progress, g.id);
    const drill = h('button', { class: 'btn', type: 'button' }, icon('play', 16), 'Drill this group');
    drill.addEventListener('click', (e) => FX.transition(() => runConfuse(root, ctx, drillItems(groups, { n: Math.min(10, g.terms.reduce((s, t) => s + t.clues.length, 0)), only: [g.id] }), { only: [g.id] }), pos(e, drill)));
    const termCards = g.terms.map((t) => h('div', { class: 'conf-term' }, h('h4', null, t.name), h('p', { class: 'means' }, t.means), h('p', { class: 'tip' }, h('span', { class: 'lab' }, 'Tip'), ' ', t.tip)));
    return h('details', { class: 'review conf-group' },
      h('summary', null, h('span', { class: 'conf-title' }, g.title, h('span', { class: 'conf-stat' }, st.n ? `${st.right} of ${st.n} right` : 'not drilled yet')), icon('chevron-down', 22)),
      h('div', { class: 'body' }, h('div', { class: 'conf-terms', style: { '--n': Math.min(g.terms.length, 3) } }, termCards),
        h('p', { class: 'fine conf-src' }, icon('book-open', 14), ' ', sourceText({ src: g.src }, exam.documents)),
        h('div', { class: 'actions', style: { marginTop: '12px' } }, FX.obj(drill, { cls: 'o-btn' }))));
  });
  const list = h('div', { class: 'review-list' }, rows);
  const sections = [
    h('div', { class: 'start-row' }, FX.obj(startBtn, { cls: 'o-btn' }), h('div', { class: 'pills' }, counts)),
    h('h2', { class: 'section' }, 'Compare them', h('span', { class: 'lab' }, `${groups.length} groups, open one`)), list,
  ];
  mount(root,
    h('a', { class: 'back', href: lessons ? `#/exam/${exam.id}/learn` : `#/exam/${exam.id}` }, icon('arrow-left', 14), lessons ? 'Study path' : exam.title),
    h('h1', { class: 'pagetitle' }, 'Easily confused'),
    h('p', { class: 'lead' }, confusions.intro),
    sections);
  const base = FX.base();
  FX.enter([sections[0], ...rows], { y: 26, delay: base, stagger: 0.03, spring: FX.spring.soft });
}

// ---------------------------------------------------------------- the drill
export function runConfuse(root, ctx, items, opts = {}) {
  const { exam } = ctx;
  const total = items.length;
  const results = [];
  let i = 0, answered = false, over = false, keyOff = null;
  if (!total) { mount(root, h('p', { class: 'lead' }, 'Nothing to drill.')); return; }

  const exitBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'End' }, icon('x', 18));
  const count = h('span', { class: 'lab' });
  const nBlocks = Math.min(total, 20);
  const segs = h('div', { class: 'quiz-segs', role: 'progressbar', 'aria-label': 'Questions answered', 'aria-valuemin': 0, 'aria-valuemax': total }, Array.from({ length: nBlocks }, () => h('i')));
  const stage = h('div', { class: 'deck' });
  mount(root, h('div', { class: 'quiz-wrap' }, h('div', { class: 'quiz-top' }, h('div', { class: 'left' }, FX.obj(exitBtn, { cls: 'o-icon' }), count)), segs, stage));
  const paintSegs = () => {
    const done = total <= 20 ? results.length : Math.floor((results.length * nBlocks) / total);
    [...segs.children].forEach((b, k) => { b.classList.toggle('done', k < done); b.classList.toggle('current', k === Math.min(done, nBlocks - 1) && k >= done); });
    segs.setAttribute('aria-valuenow', results.length);
    count.textContent = `Question ${Math.min(i + 1, total)} / ${total}`;
  };
  const finish = (e) => {
    if (over) return; over = true; keyOff?.();
    if (results.length) recordSession(exam.id, { mode: 'confuse', label: 'Easily confused', answered: results.length, score: results.filter((r) => r.right).length, bestStreak: 0 });
    FX.transition(() => renderConfuseResults(root, ctx, results, total, opts), pos(e, exitBtn));
  };
  exitBtn.addEventListener('click', finish);

  const deal = () => {
    const it = items[i];
    answered = false;
    const rows = it.options.map((label, p) => {
      const ink = h('span', { class: 'ink' }, label);
      const state = h('span', { class: 'state' });
      const btn = h('button', { class: 'opt', type: 'button' }, h('span', { class: 'key' }, String(p + 1)), h('span', { class: 'txt' }, ink), state);
      return { p, ink, state, btn, obj: FX.obj(btn, { cls: 'o-opt', tilt: 3, z: 20 }) };
    });
    const fb = h('div', { class: 'fb-slot', role: 'status' });
    const next = h('button', { class: 'btn yellow', type: 'button', disabled: true }, i + 1 >= total ? 'See results' : 'Next question');
    const face = h('div', { class: 'qcard' },
      h('div', { class: 'qmeta' }, h('span', { class: 'chip accent' }, it.title)),
      h('h2', { class: 'qtext' }, it.clue),
      h('div', { class: 'options' }, rows.map((r) => r.obj)), fb,
      h('div', { class: 'qfoot' }, FX.obj(next, { cls: 'o-btn' })));

    const pick = (p, e) => {
      if (answered) return;
      answered = true;
      const right = p === it.answer;
      results.push({ it, right, picked: it.options[p] });
      recordConfuse(exam.id, it.gid, right);
      rows.forEach((r) => {
        r.obj.dataset.locked = '1';
        if (r.p === it.answer) { r.btn.classList.add('right'); r.state.replaceChildren(icon('check', 24)); }
        else if (r.p === p) { r.btn.classList.add('wrong'); r.state.replaceChildren(icon('x', 24)); r.ink.insertAdjacentHTML('beforeend', SCRIBBLE); }
        else r.obj.classList.add('dimmed');
        FX.anim(r.obj._p.lift, r.p === p ? { x: 4, y: 4, z: 0 } : { x: 0, y: 0, z: 0 }, FX.spring.snappy);
      });
      const picked = it.byName[it.options[p]];
      const note = h('div', { class: 'note-card fb' },
        h('span', { class: `label ${right ? 'good' : 'bad'}` }, icon(right ? 'check' : 'x', 14), right ? 'Correct' : 'Not quite'),
        h('p', { class: 'explain' }, h('strong', null, `${it.term.name}: `), it.term.means),
        h('p', { class: 'explain' }, h('span', { class: 'lab' }, 'Tip'), ' ', it.term.tip),
        right ? null : h('p', { class: 'explain' }, h('strong', null, `${picked.name}: `), picked.means),
        h('p', { class: 'source' }, icon('book-open', 14), sourceText({ src: it.src }, exam.documents)));
      const wrap = h('div', { class: 'note-wrap' }, note);
      fb.replaceChildren(wrap);
      window.Motion.animate(wrap, { opacity: 0, y: 26 }, { duration: 0 }); FX.anim(wrap, { opacity: 1, y: 0 }, { ...FX.spring.deal, delay: 0.1 });
      const c = (e && e.clientX) ? { x: e.clientX, y: e.clientY } : pos(null, rows[p].btn);
      if (right) { FX.confetti(c.x, c.y, { count: 8 }); FX.sound('pop'); } else { FX.anim(rows[p].obj, { x: [0, -11, 11, -9, 9, -5, 3, 0] }, { duration: 0.42 }); FX.sound('thud'); }
      next.disabled = false; next.focus({ preventScroll: true });
      paintSegs();
    };
    const advance = () => {
      if (!answered) return;
      if (i + 1 >= total) { finish(); return; }
      i += 1; paintSegs();
      const old = stage.firstChild;
      FX.anim(old, { x: 520, y: -90, rotate: 12, opacity: 0 }, { duration: 0.26, ease: [0.5, 0, 0.9, 0.5] }).then(() => { old.remove(); deal(); }, () => { old.remove(); deal(); });
    };
    rows.forEach((r) => r.btn.addEventListener('click', (e) => pick(r.p, e)));
    next.addEventListener('click', advance);
    keyOff?.();
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && answered) { e.preventDefault(); advance(); return; }
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
      if (n >= 0 && n < rows.length && !answered) { e.preventDefault(); pick(n); }
    };
    document.addEventListener('keydown', onKey);
    keyOff = () => document.removeEventListener('keydown', onKey);

    const wrapper = h('div', { class: 'calc-card-wrap' }, FX.obj(face, { cls: 'o-card', hover: false }));
    stage.replaceChildren(wrapper);
    FX.anim(wrapper, { opacity: [0, 1], y: [-40, 0], rotate: [-2, 0] }, { ...FX.spring.deal, delay: FX.base() });
  };
  paintSegs();
  deal();
  window.addEventListener('hashchange', () => keyOff?.(), { once: true });
}

// ---------------------------------------------------------------- results
function renderConfuseResults(root, ctx, results, total, opts) {
  const { exam, confusions } = ctx;
  const right = results.filter((r) => r.right).length;
  const percent = pct(right, results.length);
  const missed = results.filter((r) => !r.right);
  const byGroup = new Map();
  for (const r of results) { const t = byGroup.get(r.it.gid) || { title: r.it.title, n: 0, ok: 0 }; t.n += 1; if (r.right) t.ok += 1; byGroup.set(r.it.gid, t); }
  const stamp = percent >= 100 ? 'Boss mode' : percent >= 85 ? 'Nailed it' : percent >= 65 ? 'Solid' : percent >= 45 ? 'Almost' : 'Keep going';
  const scoreFace = h('div', { class: 'score-card' },
    h('div', { class: 'score-row' }, h('div', { class: 'score-num' }, h('span', null, results.length ? percent : 0), h('small', null, '%')), h('div', { class: 'stamp-spot' }, h('div', { class: 'stamp' }, results.length ? stamp : 'No answers'))),
    h('div', { class: 'meta' }, h('p', null, `${right} of ${results.length} right`), h('span', { class: 'chip' }, `${missed.length} to review`), results.length < total ? h('span', { class: 'chip' }, `${total - results.length} unanswered`) : null));
  const scoreObj = FX.obj(scoreFace, { cls: 'o-tile', tilt: 4, shine: true, fill: true, z: 12 });
  const groupFace = h('div', { class: 'card' }, h('h3', null, 'By group'),
    byGroup.size ? [...byGroup.values()].map((t) => h('div', { class: 'brow' }, h('div', { class: 'nm' }, t.title, h('span', null, `${t.ok} of ${t.n} right`)), segsFor(t.ok / t.n), h('span', { class: 'pct' }, `${pct(t.ok, t.n)}%`))) : h('p', null, 'Nothing answered yet.'));
  const groupObj = FX.obj(groupFace, { cls: 'o-tile', fill: true, hover: false });
  const review = missed.map(({ it, picked }, k) => h('details', { class: 'review', open: k === 0 },
    h('summary', null, h('span', null, it.clue), icon('chevron-down', 22)),
    h('div', { class: 'body' }, h('p', { class: 'fine' }, `You picked: ${picked}`), h('span', { class: 'lab' }, 'Answer'),
      h('p', { class: 'answer' }, h('span', { class: 'hl' }, it.term.name)), h('p', { class: 'why' }, it.term.means), h('p', { class: 'why' }, h('span', { class: 'lab' }, 'Tip'), ' ', it.term.tip))));
  const again = h('button', { class: 'btn yellow xl', type: 'button' }, icon('rotate-ccw', 20), 'Drill again');
  again.addEventListener('click', (e) => FX.transition(() => runConfuse(root, ctx, drillItems(confusions.groups, { n: Math.max(10, total), only: opts.only || [] }), opts), pos(e, again)));
  const actions = h('div', { class: 'actions' }, FX.obj(again, { cls: 'o-btn' }), FX.obj(h('a', { class: 'btn xl', href: `#/exam/${exam.id}/confused` }, 'Compare the terms'), { cls: 'o-btn' }),
    h('a', { class: 'btn textlink', href: ctx.lessons ? `#/exam/${exam.id}/learn` : `#/exam/${exam.id}` }, 'Back'));
  mount(root, h('div', null,
    h('h1', { class: 'pagetitle' }, 'Drill finished'),
    h('p', { class: 'pagesub lab' }, `${exam.shortTitle || exam.title} / ${results.length} answered`),
    h('section', { class: 'results-top' }, scoreObj, groupObj),
    h('h2', { class: 'section' }, missed.length ? `To review (${missed.length})` : 'Nothing to review'),
    missed.length ? h('div', { class: 'review-list' }, review) : h('p', { class: 'lead' }, 'You told every pair apart.'),
    actions));
  window.scrollTo(0, 0);
  const base = FX.base();
  FX.enter([scoreObj, groupObj], { delay: base, stagger: 0.08, y: -50 });
  groupFace.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.35 + k * 0.1 }));
}
