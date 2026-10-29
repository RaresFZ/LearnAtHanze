// One reusable question card for every question type, in the paper-cutout design.
// The card tells the runner what happened through callbacks; it never records anything itself.
import { h, mount, shuffle } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { answerText } from './cards.js';
import { gradeFill } from './grade.js';

export const TYPE_LABEL = { mc: 'Multiple choice', tf: 'True or false', fill: 'Fill in the blank', open: 'Open question' };

export { gradeFill };

/** "Lecture 4: Outsourcing I, Slide 19" */
export function sourceText(q, docs = {}) {
  const [doc, loc] = q.src || [];
  const label = docs[doc]?.label || doc || 'unknown source';
  return loc ? `${label}, ${loc}` : label;
}

const warnBadge = () => h('span', { class: 'warn-badge' }, icon('triangle-alert', 13));

/** Blocks inside the feedback note on the quiz card. */
function noteBlocks(q, docs) {
  return [
    q.type === 'fill' ? h('p', { class: 'answer-line' }, h('span', { class: 'lab' }, 'Answer'), h('span', { class: 'hl' }, answerText(q))) : null,
    q.type === 'open' ? h('p', { class: 'answer-line' }, h('span', { class: 'lab' }, 'Model answer'), q.modelAnswer) : null,
    q.explanation ? h('p', { class: 'explain' }, q.explanation) : null,
    q.flag ? h('p', { class: 'check-source' }, warnBadge(), h('span', null, h('strong', null, 'Check the source: '), q.flag)) : null,
    h('p', { class: 'source' }, icon('book-open', 14), sourceText(q, docs)),
  ];
}

/** Blocks inside a collapsed review row on the results screen. */
export function reviewBlocks(q, docs) {
  return [
    h('span', { class: 'lab' }, q.type === 'open' ? 'Model answer' : 'Answer'),
    h('p', { class: 'answer' }, h('span', { class: 'hl' }, answerText(q))),
    q.explanation ? h('p', { class: 'why' }, q.explanation) : null,
    q.flag ? h('p', { class: 'check-source' }, warnBadge(), h('span', null, h('strong', null, 'Check the source: '), q.flag)) : null,
    h('p', { class: 'src' }, icon('book-open', 14), sourceText(q, docs)),
  ];
}

const SCRIBBLE = '<svg class="scribble" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M2 11 C 22 3, 42 16, 64 8 S 104 14, 126 7 S 170 13, 198 6"/></svg>';
const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

let active = null;
/** Removes the key handlers of whichever card is on screen (called when the route changes). */
export function destroyActiveCard() { active?.destroy(); }

/**
 * Builds a question card.
 * opts: { index, total, last, docs, topicTitle,
 *         onAnswer({ score, right, x, y }),   // effects: confetti, streak, progress (fires once, at answer time)
 *         onOverride({ x, y }),               // fill-in only: "my answer was right"
 *         onNext(score) }                     // advance (the runner records the answer here)
 * Returns { el, destroy }.
 */
export function questionCard(q, opts) {
  active?.destroy();
  const { docs = {} } = opts;
  const st = { answered: false, advanced: false, score: 0 };
  const keyHandlers = [];
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    for (const fn of keyHandlers) if (fn(e)) { e.preventDefault(); return; }
  };
  document.addEventListener('keydown', onKey);

  const body = h('div', { class: 'qbody' });
  const fb = h('div', { class: 'fb-slot' });
  const hints = { mc: ['1', String('N'), 'answer'], tf: ['T', 'F', 'answer'] };
  const next = h('button', { class: 'btn yellow', type: 'button', disabled: true }, opts.last ? 'See results' : 'Next question');
  const nextObj = FX.obj(next, { cls: 'o-btn' });
  const advance = () => { if (st.advanced || !st.answered) return; st.advanced = true; opts.onNext(st.score); };
  next.addEventListener('click', advance);
  keyHandlers.push((e) => (e.key === 'Enter' && st.answered && q.type !== 'open' ? (advance(), true) : false));

  const answered = (score, x, y) => {
    st.answered = true; st.score = score;
    opts.onAnswer?.({ score, right: score >= 1, x, y });
  };

  function showNote(good) {
    const label = h('span', { class: `label ${good ? 'good' : 'bad'}` }, icon(good ? 'check' : 'x', 14), good ? 'Correct' : 'Not quite');
    const wrap = h('div', { class: 'note-wrap' }, h('div', { class: 'note-card fb' }, label, noteBlocks(q, docs)));
    mount(fb, wrap);
    M_enter(wrap);
    if (q.type !== 'open') { next.disabled = false; next.focus({ preventScroll: true }); }
  }
  const M_enter = (el) => { window.Motion.animate(el, { opacity: 0, y: 26 }, { duration: 0 }); FX.anim(el, { opacity: 1, y: 0 }, { ...FX.spring.deal, delay: 0.12 }); };

  // ---- multiple choice and true/false: blocks that lift, tilt and sink ----
  function optionList(items, rightIndex, labels) {
    const rows = items.map((label, pos) => {
      const ink = h('span', { class: 'ink' }, label);
      const state = h('span', { class: 'state' });
      const btn = h('button', { class: 'opt', type: 'button' }, h('span', { class: 'key' }, labels[pos]), h('span', { class: 'txt' }, ink), state);
      return { btn, ink, state, pos, obj: FX.obj(btn, { cls: 'o-opt', tilt: 3, z: 20 }) };
    });
    const pick = (pos, evt) => {
      if (st.answered) return;
      const right = pos === rightIndex;
      rows.forEach((r) => {
        r.obj.dataset.locked = '1';
        if (r.pos === rightIndex) {
          r.btn.classList.add('right'); r.state.replaceChildren(icon('check', 24));
          if (!right) { r.ink.style.animationDelay = '0.3s'; setTimeout(() => FX.anim(r.obj, { scale: [1, 1.05, 1] }, FX.spring.bouncy), 260); }
        } else if (r.pos === pos) {
          r.btn.classList.add('wrong'); r.state.replaceChildren(icon('x', 24)); r.ink.insertAdjacentHTML('beforeend', SCRIBBLE);
        } else r.obj.classList.add('dimmed');
        FX.anim(r.obj._p.lift, r.pos === pos ? { x: 4, y: 4, z: 0 } : { x: 0, y: 0, z: 0 }, FX.spring.snappy);
      });
      const chosen = rows[pos];
      if (!right) FX.anim(chosen.obj, { x: [0, -11, 11, -9, 9, -5, 3, 0] }, { duration: 0.42 });
      const [cx, cy] = evt && evt.clientX ? [evt.clientX, evt.clientY] : centre(chosen.btn);
      answered(right ? 1 : 0, cx, cy);
      showNote(right);
    };
    rows.forEach((r) => r.btn.addEventListener('click', (e) => pick(r.pos, e)));
    body.append(h('div', { class: 'options' }, rows.map((r) => r.obj)));
    return { rows, pick };
  }

  if (q.type === 'mc') {
    const order = q.fixedOrder ? q.options.map((_, i) => i) : shuffle(q.options.map((_, i) => i));
    const { rows, pick } = optionList(order.map((i) => q.options[i]), order.indexOf(q.answer), order.map((_, i) => String(i + 1)));
    keyHandlers.push((e) => {
      const letter = e.key.length === 1 ? e.key.toLowerCase().charCodeAt(0) - 97 : -1;
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : letter;
      if (!st.answered && n >= 0 && n < rows.length) { pick(n, null); return true; }
      return false;
    });
    hints.mc = [`1`, String(rows.length), 'answer'];
  } else if (q.type === 'tf') {
    const { pick } = optionList(['True', 'False'], q.answer ? 0 : 1, ['T', 'F']);
    keyHandlers.push((e) => {
      if (st.answered) return false;
      if (e.key === '1' || e.key.toLowerCase() === 't') { pick(0, null); return true; }
      if (e.key === '2' || e.key.toLowerCase() === 'f') { pick(1, null); return true; }
      return false;
    });
  } else if (q.type === 'fill') {
    const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer', placeholder: q.placeholder || 'Type your answer' });
    const inObj = FX.obj(input, { cls: 'o-input', hover: false });
    const check = h('button', { class: 'btn yellow', type: 'button' }, 'Check answer');
    const checkObj = FX.obj(check, { cls: 'o-btn' });
    const extra = h('div', { class: 'grades' });
    const doCheck = () => {
      if (st.answered || !input.value.trim()) return;
      const ok = gradeFill(q, input.value);
      input.disabled = true; input.classList.add(ok ? 'right' : 'wrong'); checkObj.style.display = 'none';
      const [cx, cy] = centre(input);
      answered(ok ? 1 : 0, cx, cy);
      if (!ok) {
        FX.anim(inObj, { x: [0, -11, 11, -9, 9, -5, 3, 0] }, { duration: 0.42 });
        const ov = h('button', { class: 'btn alt', type: 'button' }, 'My answer was right');
        ov.addEventListener('click', () => {
          st.score = 1; input.classList.remove('wrong'); input.classList.add('right'); extra.replaceChildren();
          opts.onOverride?.({ x: cx, y: cy });
          showNote(true);
        });
        extra.append(FX.obj(ov, { cls: 'o-btn' }));
      }
      showNote(ok);
    };
    check.addEventListener('click', doCheck);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doCheck(); } });
    body.append(h('div', { class: 'fill-row' }, inObj, checkObj), extra);
    setTimeout(() => input.focus({ preventScroll: true }), 80);
    hints.fill = ['Enter', null, 'check'];
  } else {
    const area = h('textarea', { rows: 4, 'aria-label': 'Your answer', placeholder: 'Write your own answer first (optional), then compare it with the model answer.' });
    const areaObj = FX.obj(area, { cls: 'o-input', hover: false });
    const show = h('button', { class: 'btn yellow', type: 'button' }, 'Show model answer');
    const showObj = FX.obj(show, { cls: 'o-btn' });
    const grades = h('div', { class: 'grades' }, showObj);
    const grade = (s, label, cls) => {
      const b = h('button', { class: `btn ${cls}`, type: 'button' }, label);
      b.addEventListener('click', (e) => {
        if (st.advanced) return;
        const [cx, cy] = e.clientX ? [e.clientX, e.clientY] : centre(b);
        answered(s, cx, cy);
        st.advanced = true;
        opts.onNext(s);
      });
      return FX.obj(b, { cls: 'o-btn' });
    };
    show.addEventListener('click', () => {
      if (st.answered) return;
      st.answered = true;
      area.disabled = true;
      showNote(true);
      fb.querySelector('.label')?.replaceWith(h('span', { class: 'label neutral' }, 'Model answer'));
      fb.querySelector('.answer-line .lab')?.remove();
      mount(grades, h('span', { class: 'next-hint' }, 'How did yours compare?'), grade(0, 'Missed it', 'g0'), grade(0.5, 'Partly', 'g1'), grade(1, 'Got it', 'g2'));
      st.answered = false;      // the answer counts when you grade it
      keyHandlers.push((e) => {
        const map = { 1: [0, 'g0'], 2: [0.5, 'g1'], 3: [1, 'g2'] };
        if (!map[e.key]) return false;
        grades.querySelectorAll('.btn')[+e.key - 1]?.click(); return true;
      });
    });
    body.append(areaObj, grades);
    nextObj.style.display = 'none';
    hints.open = ['1', '3', 'grade'];
  }

  const hintFor = hints[q.type];
  const hintEl = h('div', { class: 'hints' },
    hintFor ? h('span', null, h('kbd', null, hintFor[0]), hintFor[1] ? h('kbd', null, hintFor[1]) : null, ` ${hintFor[2]}`) : null,
    q.type === 'open' ? null : h('span', null, h('kbd', null, 'Enter'), ' next'));

  const cardFace = h('article', { class: 'qcard' },
    h('div', { class: 'qmeta' }, h('span', { class: 'chip accent' }, opts.topicTitle || ''), h('span', { class: 'chip' }, TYPE_LABEL[q.type])),
    h('h1', { class: 'qtext' }, q.question),
    body, fb,
    h('div', { class: 'qfoot' }, hintEl, nextObj));
  const el = FX.obj(cardFace, { cls: 'o-card', hover: false });

  const card = { el, destroy: () => { document.removeEventListener('keydown', onKey); if (active === card) active = null; } };
  active = card;
  return card;
}
