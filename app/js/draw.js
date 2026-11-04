// "Draw it": exercises where you draw a diagram yourself (SIPOC, fishbone, swimlane, a charter, a waste walk), on a freehand pad or on paper,
// then check yourself against a list and compare with an example layout. The exercises are in content/<exam>/lessons.json ("exercises").
// Nothing you draw is saved or sent anywhere.
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress, recordExerciseDone } from './store.js';
import { sourceText } from './question.js';

const card = (face) => FX.obj(face, { cls: 'o-tile', fill: true, hover: false });
export const hasExercises = (ctx) => !!ctx.lessons?.exercises?.length;
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.flat().forEach((k) => e.append(k)); return e; };
const text = (x, y, s, attrs = {}) => { const t = svg('text', { x, y, 'font-family': 'Geist Mono, monospace', 'font-size': 15, fill: 'currentColor', ...attrs }); t.textContent = s; return t; };

// ---------------------------------------------------------------- example layouts
function tableEl(t, { empty = 0 } = {}) {
  const rows = t.rows || Array.from({ length: t.emptyRows || empty }, () => t.head.map(() => ''));
  return h('div', { class: 'draw-table-wrap' }, h('table', { class: 'draw-table' },
    h('thead', null, h('tr', null, t.head.map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
}
function fishboneEl(t) {
  const cats = t.categories, half = Math.ceil(cats.length / 2);
  const top = cats.slice(0, half), bottom = cats.slice(half);
  const root = svg('svg', { viewBox: '0 0 940 380', role: 'img', 'aria-label': `Fishbone layout: ${t.head}`, class: 'draw-svg' });
  root.append(svg('line', { x1: 30, y1: 190, x2: 720, y2: 190, stroke: 'currentColor', 'stroke-width': 4, 'stroke-linecap': 'round' }));
  root.append(svg('rect', { x: 720, y: 140, width: 200, height: 100, rx: 10, fill: 'var(--yellow)', stroke: 'currentColor', 'stroke-width': 3 }));
  const words = t.head.split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 17) { lines.push(cur.trim()); cur = w; } else cur = `${cur} ${w}`; }
  if (cur.trim()) lines.push(cur.trim());
  lines.slice(0, 4).forEach((l, k) => root.append(text(820, 190 + (k - (Math.min(lines.length, 4) - 1) / 2) * 20 + 5, l, { 'text-anchor': 'middle', 'font-weight': 600, fill: '#141414' })));
  const place = (list, up) => list.forEach((c, k) => {
    const x = 150 + k * (560 / Math.max(list.length, 1)) + 40, y0 = up ? 50 : 330;
    root.append(svg('line', { x1: x, y1: y0, x2: x + 80, y2: 190, stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    root.append(text(x - 6, up ? 36 : 358, c, { 'font-weight': 600 }));
    for (const f of [0.35, 0.65]) root.append(svg('line', { x1: x + 80 * (up ? f : f), y1: up ? 50 + 140 * f : 330 - 140 * f, x2: x + 80 * f - 46, y2: up ? 50 + 140 * f : 330 - 140 * f, stroke: 'currentColor', 'stroke-width': 1.5, opacity: 0.55 }));
  });
  place(top, true); place(bottom, false);
  return h('div', { class: 'draw-svg-wrap' }, root, h('p', { class: 'fine' }, 'The lines on the bones are where the ribs and sub-branches go: major causes on the ribs, root causes on the sub-branches.'));
}
function swimlaneEl(t) {
  const n = t.lanes.length, laneH = 70, w = 940;
  const root = svg('svg', { viewBox: `0 0 ${w} ${n * laneH + 10}`, role: 'img', 'aria-label': 'Swimlane layout', class: 'draw-svg' });
  t.lanes.forEach((name, k) => {
    root.append(svg('rect', { x: 5, y: 5 + k * laneH, width: w - 10, height: laneH, fill: k % 2 ? 'transparent' : 'rgba(127,127,127,0.12)', stroke: 'currentColor', 'stroke-width': 2 }));
    root.append(svg('rect', { x: 5, y: 5 + k * laneH, width: 130, height: laneH, fill: 'var(--accent)', stroke: 'currentColor', 'stroke-width': 2 }));
    root.append(text(70, 5 + k * laneH + laneH / 2 + 5, name, { 'text-anchor': 'middle', 'font-weight': 600, fill: '#141414' }));
  });
  return h('div', { class: 'draw-svg-wrap' }, root, h('p', { class: 'fine' }, 'Put each activity in the lane of whoever does it. An arrow that crosses a lane line is a handoff.'));
}
const layoutEl = (t, ex) => (t.kind === 'fishbone' ? fishboneEl(t) : t.kind === 'swimlane' ? swimlaneEl(t) : tableEl(t));

// ---------------------------------------------------------------- the freehand pad
function drawPad() {
  const narrow = window.matchMedia('(max-width: 600px)').matches;      // a phone gets a tall pad
  const W = narrow ? 640 : 1000, H = narrow ? 760 : 440;
  const canvas = h('canvas', { class: 'pad', width: W, height: H, 'aria-label': 'Drawing pad: draw with a finger, a pen or the mouse' });
  const c = canvas.getContext('2d');
  const strokes = [];
  let cur = null, tool = 'pen';
  const redraw = () => {
    c.clearRect(0, 0, W, H);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const s of strokes) {
      c.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
      c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--ink').trim() || '#141414';
      c.lineWidth = s.erase ? 26 : 4;
      c.beginPath(); s.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      if (s.pts.length === 1) c.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  };
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)]; };
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); cur = { erase: tool === 'eraser', pts: [at(e)] }; strokes.push(cur); redraw(); });
  canvas.addEventListener('pointermove', (e) => { if (!cur) return; cur.pts.push(at(e)); redraw(); });
  const end = () => { cur = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  const toolBtn = (name, label, ic) => { const b = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(tool === name) }, icon(ic, 16), label); b.addEventListener('click', () => { tool = name; bar.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tool === tool))); }); b.dataset.tool = name; return FX.obj(b, { cls: 'o-btn' }); };
  const undo = h('button', { class: 'btn', type: 'button' }, icon('rotate-ccw', 16), 'Undo'); undo.addEventListener('click', () => { strokes.pop(); redraw(); });
  const clear = h('button', { class: 'btn', type: 'button' }, icon('x', 16), 'Clear'); clear.addEventListener('click', () => { strokes.length = 0; redraw(); });
  const bar = h('div', { class: 'pad-bar' }, toolBtn('pen', 'Pen', 'mouse-pointer-2'), toolBtn('eraser', 'Eraser', 'x'), FX.obj(undo, { cls: 'o-btn' }), FX.obj(clear, { cls: 'o-btn' }));
  return { el: h('div', { class: 'pad-wrap' }, bar, h('div', { class: 'pad-paper' }, canvas), h('p', { class: 'fine' }, 'The pad is not saved. Paper works just as well.')), strokes };
}

// ---------------------------------------------------------------- the list of exercises
export function renderDrawHome(root, ctx) {
  const { exam, lessons, topics } = ctx;
  if (!hasExercises(ctx)) { mount(root, h('p', { class: 'lead' }, 'There are no drawing exercises for this exam. ', h('a', { href: `#/exam/${exam.id}`, class: 'back' }, 'Back to the exam'))); return; }
  const progress = loadProgress(exam.id);
  const rows = lessons.exercises.map((ex) => {
    const done = !!progress.learn[`ex:${ex.id}`]?.done;
    const face = h('a', { class: `trow draw-row${done ? ' is-done' : ''}`, href: `#/exam/${exam.id}/learn/draw/${ex.id}` },
      h('span', { class: 'name' }, h('span', { class: 'lnum' }, done ? icon('check', 14) : icon('mouse-pointer-2', 14)), ex.title),
      h('span', { class: 'count' }, topics.find((t) => t.id === ex.topic)?.title || ''),
      h('span', { class: 'count' }, `about ${ex.minutes} min`),
      h('span', { class: 'pct' }, done ? 'done' : ''));
    return h('li', null, FX.obj(face, { cls: 'o-row', z: 10 }));
  });
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}/learn` }, icon('arrow-left', 14), 'Study path'),
    h('h1', { class: 'pagetitle' }, 'Draw it'),
    h('p', { class: 'lead' }, 'A diagram sticks when you draw it yourself. Pick an exercise, read the case, draw it on the pad or on paper, then check yourself against the list and compare with an example.'),
    h('ul', { class: 'topics', style: { marginTop: '24px' } }, rows));
  FX.enter(rows, { y: 26, delay: FX.base(), stagger: 0.04, spring: FX.spring.soft });
}

// ---------------------------------------------------------------- one exercise
export function renderDrawExercise(root, ctx, id) {
  const { exam, lessons, topics } = ctx;
  const ex = lessons?.exercises?.find((e) => e.id === id);
  if (!ex) { mount(root, h('p', { class: 'lead' }, 'That exercise does not exist. ', h('a', { href: `#/exam/${exam.id}/learn/draw`, class: 'back' }, 'Back to the exercises'))); return; }
  const pad = drawPad();
  const caseObj = card(h('div', { class: 'card' }, ex.case ? h('p', { class: 'draw-case' }, ex.case) : null, h('p', { class: 'draw-prompt' }, ex.prompt)));
  const layout = h('details', { class: 'review' }, h('summary', null, h('span', null, 'A layout to copy'), icon('chevron-down', 22)), h('div', { class: 'body' }, layoutEl(ex.template)));

  // step 2: check yourself, then compare
  const tick = h('p', { class: 'fine', role: 'status' });
  const boxes = ex.checklist.map((t) => {
    const b = h('button', { class: 'toggle', type: 'button', 'aria-pressed': 'false' }, h('span', { class: 'box' }, icon('check', 14)), h('span', { class: 't' }, t));
    b.addEventListener('click', () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); const n = [...checkWrap.querySelectorAll('.toggle')].filter((x) => x.getAttribute('aria-pressed') === 'true').length; tick.textContent = `${n} of ${ex.checklist.length} ticked`; });
    return FX.obj(b, { cls: 'o-tile', tilt: 0, z: 10 });
  });
  const checkWrap = h('div', { class: 'togglegrid draw-check' }, boxes);
  const model = ex.model ? h('details', { class: 'review' }, h('summary', null, h('span', null, ex.model.title || 'An example'), icon('chevron-down', 22)),
    h('div', { class: 'body' }, tableEl(ex.model), ex.model.note ? h('p', { class: 'fine draw-note' }, ex.model.note) : null)) : null;
  const done = h('button', { class: 'btn yellow xl', type: 'button' }, icon('circle-check', 22), 'Mark as done');
  done.addEventListener('click', () => { recordExerciseDone(exam.id, ex.id); FX.navigate(`#/exam/${exam.id}/learn/draw`); });
  const stepTwo = h('div', { class: 'draw-step2', hidden: true }, h('h2', { class: 'section' }, '2. Check yourself'), h('p', { class: 'fine' }, 'Tick what your drawing has.'), checkWrap, tick, model,
    h('div', { class: 'actions' }, FX.obj(done, { cls: 'o-btn' })));
  const reveal = h('button', { class: 'btn yellow xl', type: 'button' }, icon('check', 22), 'I drew it, check my work');
  reveal.addEventListener('click', () => { stepTwo.hidden = false; reveal.closest('.obj').hidden = true; stepTwo.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}/learn/draw` }, icon('arrow-left', 14), 'Draw it'),
    h('div', { class: 'lesson-head' },
      h('div', { class: 'chips' }, h('span', { class: 'chip accent' }, topics.find((t) => t.id === ex.topic)?.title || ''), h('span', { class: 'chip' }, icon('timer', 14), ` about ${ex.minutes} min`)),
      h('h1', { class: 'pagetitle', style: { marginTop: '14px' } }, ex.title)),
    caseObj,
    h('h2', { class: 'section' }, '1. Draw it'), pad.el, layout,
    h('div', { class: 'actions' }, FX.obj(reveal, { cls: 'o-btn' })),
    stepTwo,
    h('p', { class: 'fine lesson-src' }, icon('book-open', 14), ' ', sourceText({ src: ex.src }, exam.documents)));
  FX.enter([caseObj], { y: 24, delay: FX.base(), spring: FX.spring.soft });
}
