// Learn mode: a guided path through one exam. Per topic: a short lesson in small parts, then a "test yourself" quiz on it.
// Also a one-day plan, and a cheat sheet of formulas and lists. Lesson text lives in content/<exam>/lessons.json (see learn-data.js for the rules).
import { h, mount, shuffle, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress, recordLessonRead, recordAnswer, setExamAt } from './store.js';
import { runQuiz } from './quiz.js';
import { hasCalc } from './calc.js';
import { questionCard, sourceText } from './question.js';
import { studyTimer } from './study-timer.js';
import { canSpeak, speak, stopSpeaking, speechOn, setSpeechOn, speechRate, setSpeechRate, RATES } from './speech.js';
import { cardStatus } from './flashcards.js';
import { weakCounts } from './weak.js';
import { hasExercises } from './draw.js';
import { pathTopics, topicStatus, pickCheck, nextTopic, minutesLeft, topicMinutes, hm, isOften, CHECK_SIZE, studyWindow, formatLeft, prioritize } from './learn-data.js';

let keyHandler = null;
let timers = [];
/** Removes what the Learn screens left running: the arrow keys, the voice and the timer widgets (called when the route changes). */
export function destroyLearn() {
  if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
  stopSpeaking();
  timers.forEach((t) => t.destroy()); timers = [];
}

const pos = (e, el) => { if (e && e.clientX) return { x: e.clientX, y: e.clientY }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const card = (face, extra = {}) => FX.obj(face, { cls: 'o-tile', fill: true, hover: false, ...extra });

const toLocalInput = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const VERDICT = {
  comfortable: (w, often) => `You have time: about ${hm(w.focusMinutes)} of focused study for ${hm(w.minutesNeeded)} of lessons and questions. Use the extra time on weak spots, the calculations and a timed simulation.`,
  enough: (w) => `Enough time for the whole path (about ${hm(w.focusMinutes)} of focused study for ${hm(w.minutesNeeded)}), but not much to spare. Keep your breaks short.`,
  tight: (w, often) => `Tight: about ${hm(w.focusMinutes)} of focused study for ${hm(w.minutesNeeded)} of material.${often ? ' Start with the topics marked with a flame: the class missed those most.' : ''}`,
  short: (w, often) => `Not enough time for everything (about ${hm(w.focusMinutes)} of focused study for ${hm(w.minutesNeeded)}).${often ? ' Do the topics with a flame first, then the cheat sheet.' : ' Do the first topics, then the cheat sheet.'}`,
  done: () => 'You finished the path. Use the time for weak spots, flashcards and a timed exam simulation.',
};

/** The exam date, what it leaves in study time, and what to do next. */
function countdownCard(ctx, path, statusOf, left) {
  const { exam, lessons, topics } = ctx;
  const examAt = loadProgress(exam.id).plan.examAt;
  const win = studyWindow(Date.now(), examAt, left);
  const often = path.some((t) => isOften(lessons, t.id));
  const input = h('input', { class: 'face', type: 'datetime-local', 'aria-label': 'Exam date and time', value: Number.isFinite(examAt) ? toLocalInput(examAt) : '' });
  const save = h('button', { class: 'btn yellow', type: 'button' }, 'Save the date');
  save.addEventListener('click', () => { const ms = new Date(input.value).getTime(); if (!Number.isFinite(ms)) { input.focus(); return; } setExamAt(exam.id, ms); FX.reroute?.(); });
  const form = h('div', { class: 'count-form' }, FX.obj(input, { cls: 'o-input', hover: false }), FX.obj(save, { cls: 'o-btn' }));
  let body;
  if (!win) {
    body = [h('h3', null, 'Exam countdown'), h('p', { class: 'fine' }, 'Tell the app when your exam is. It works out how much study time you really have, after sleep, and what to do next.'), form];
  } else if (win.over) {
    body = [h('h3', null, 'The exam time has passed'), h('p', { class: 'fine' }, 'Change the date if it moved.'), form];
  } else {
    const order = (win.verdict === 'tight' || win.verdict === 'short') ? prioritize(path, lessons, statusOf) : path.filter((t) => statusOf(t.id).state !== 'done');
    const items = order.slice(0, 3).map((t) => h('li', null, h('a', { href: `#/exam/${exam.id}/learn/${t.id}` }, t.title), isOften(lessons, t.id) ? h('span', { class: 'warn-badge', title: 'Often missed in class' }, icon('flame', 13)) : null));
    const due = cardStatus(ctx).due, weak = weakCounts(ctx).questions;
    if (due) items.push(h('li', null, h('a', { href: `#/exam/${exam.id}/cards` }, `${due} flashcard${due === 1 ? '' : 's'} due today`)));
    if (weak) items.push(h('li', null, h('a', { href: `#/exam/${exam.id}/weak` }, `${weak} weak question${weak === 1 ? '' : 's'} to fix`)));
    const remove = h('button', { class: 'btn textlink', type: 'button' }, 'Remove the date');
    remove.addEventListener('click', () => { setExamAt(exam.id, null); FX.reroute?.(); });
    const change = h('details', { class: 'count-change' }, h('summary', null, 'Change the date'), form);
    body = [
      h('p', { class: 'lab' }, 'Exam in'), h('div', { class: 'count-big' }, formatLeft(win.msLeft)),
      h('div', { class: 'chips' }, h('span', { class: 'chip' }, icon('moon', 14), ` ${win.nights} night${win.nights === 1 ? '' : 's'} of sleep`), h('span', { class: 'chip' }, icon('timer', 14), ` about ${hm(win.focusMinutes)} to study`), h('span', { class: 'chip' }, icon('book-open', 14), ` ${hm(win.minutesNeeded)} of path left`)),
      h('p', { class: `count-verdict v-${win.verdict}` }, VERDICT[win.verdict](win, often)),
      items.length ? h('div', null, h('p', { class: 'lab' }, 'Up next'), h('ol', { class: 'count-list' }, items)) : null,
      h('div', { class: 'count-tools' }, change, remove)];
  }
  return card(h('div', { class: 'card count-card' }, body));
}

/** Counts for the tile on the exam page. */
export function learnCounts(ctx) {
  const path = pathTopics(ctx.topics, ctx.lessons);
  const progress = loadProgress(ctx.exam.id);
  return { done: path.filter((t) => topicStatus(progress, ctx.questions, t.id).state === 'done').length, total: path.length };
}

// ---------------------------------------------------------------- the path
export function renderLearnHome(root, ctx) {
  destroyLearn();
  const { exam, topics, questions, lessons } = ctx;
  const path = pathTopics(topics, lessons);
  const progress = loadProgress(exam.id);
  const statusOf = (id) => topicStatus(progress, questions, id);
  const done = path.filter((t) => statusOf(t.id).state === 'done').length;
  const started = path.some((t) => statusOf(t.id).state !== 'todo');
  const next = nextTopic(path, statusOf);
  const left = minutesLeft(path, lessons, statusOf);

  const go = next
    ? h('a', { class: 'btn yellow xl', href: `#/exam/${exam.id}/learn/${next.id}` }, icon('play', 22), started ? 'Continue' : 'Start learning')
    : h('a', { class: 'btn yellow xl', href: `#/exam/${exam.id}/simulation` }, icon('timer', 22), 'Try the exam simulation');
  const goObj = FX.obj(go, { cls: 'o-btn' });
  const heroFace = h('div', { class: 'hero' },
    h('div', { class: 'hero-main' },
      h('h1', null, 'Learn'),
      h('p', { class: 'sub' }, lessons.intro),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, icon('circle-check', 14), ` ${done} of ${path.length} topics done`),
        h('span', { class: 'chip' }, icon('timer', 14), next ? ` about ${hm(left)} left` : ' all topics done'))),
    goObj);
  const heroObj = FX.obj(heroFace, { cls: 'o-hero', tilt: 4, shine: true, z: 0 });

  // your day: the blocks of the plan and the study tips
  const blocks = (lessons.plan?.blocks || []).map((b) => {
    const ids = b.topics.filter((id) => path.some((t) => t.id === id));
    const mins = ids.reduce((s, id) => s + topicMinutes(lessons, id), 0);
    return h('li', null, h('strong', null, b.title), h('span', { class: 'plan-meta' }, ` ${hm(mins)}`),
      h('span', { class: 'plan-topics' }, ids.map((id) => topics.find((t) => t.id === id)?.title).filter(Boolean).join(', ')));
  });
  const total = path.reduce((s, t) => s + topicMinutes(lessons, t.id), 0);
  const planFace = h('div', { class: 'card plan-card' },
    h('h3', null, 'A plan for one day'),
    h('p', { class: 'fine' }, `The whole path is about ${hm(total)}, including answering the questions. Take a break after each block.`),
    h('ol', { class: 'plan-list' }, blocks,
      h('li', null, h('strong', null, 'Last hour'), h('span', { class: 'plan-topics' }, 'Cheat sheet, then Weak spots and Flashcards, then one timed Exam simulation.'))));
  const tipsFace = h('div', { class: 'card plan-card' },
    h('h3', null, 'How to make it stick'),
    h('ul', { class: 'tips-list' }, (lessons.plan?.tips || []).map((t) => h('li', null, t))));
  const planRow = h('div', { class: 'two-col plan-row' }, card(planFace), card(tipsFace));
  const countObj = countdownCard(ctx, path, statusOf, left);
  const tm = studyTimer(exam.id); timers.push(tm);

  const rows = path.map((t, k) => {
    const st = statusOf(t.id);
    const face = h('a', { class: `trow lrow${st.state === 'done' ? ' is-done' : ''}`, href: `#/exam/${exam.id}/learn/${t.id}` },
      h('span', { class: 'name' }, h('span', { class: 'lnum' }, st.state === 'done' ? icon('check', 14) : String(k + 1)), t.title,
        isOften(lessons, t.id) ? h('span', { class: 'warn-badge', title: 'Part of this topic is often missed in class' }, icon('flame', 13)) : null),
      h('span', { class: 'count' }, `about ${topicMinutes(lessons, t.id)} min`),
      h('span', { class: 'segs', 'data-filled': Math.round(st.share * 10), 'aria-label': `${Math.round(st.share * 100)}% of the questions answered right` }, Array.from({ length: 10 }, () => h('i'))),
      h('span', { class: 'pct' }, st.state === 'todo' ? '–' : `${pct(st.mastered, st.total)}%`));
    face.addEventListener('pointerenter', () => FX.wave(face.querySelector('.segs')));
    return h('li', null, FX.obj(face, { cls: 'o-row', z: 10 }));
  });
  const list = h('ul', { class: 'topics' }, rows);

  const extras = h('div', { class: 'tools-row' },
    FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/learn/cheatsheet` }, icon('book-open-check', 18), 'Cheat sheet'), { cls: 'o-btn' }),
    hasExercises(ctx) ? FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/learn/draw` }, icon('mouse-pointer-2', 18), 'Draw it'), { cls: 'o-btn' }) : null,
    ctx.confusions?.groups?.length ? FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/confused` }, icon('arrow-left-right', 18), 'Easily confused'), { cls: 'o-btn' }) : null,
    hasCalc(exam.id) ? FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/calc` }, icon('zap', 18), 'Calculation trainer'), { cls: 'o-btn' }) : null,
    FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/weak` }, icon('crosshair', 18), 'Weak spots'), { cls: 'o-btn' }),
    FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/cards` }, icon('layers', 18), 'Flashcards'), { cls: 'o-btn' }),
    FX.obj(h('a', { class: 'btn', href: `#/exam/${exam.id}/simulation` }, icon('timer', 18), 'Exam simulation'), { cls: 'o-btn' }));

  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('section', { class: 'bento', style: { marginTop: '14px' } }, heroObj),
    h('h2', { class: 'section' }, 'Your day'), countObj, h('div', { style: { marginTop: '16px' } }, tm.el), planRow,
    h('h2', { class: 'section' }, 'Study path', h('span', { class: 'lab' }, 'In this order')), list,
    h('h2', { class: 'section' }, 'Also useful'), extras);

  const base = FX.base();
  FX.enter([heroObj], { y: -60, rotate: -1, delay: base, spring: FX.spring.deal });
  FX.enter([countObj, tm.el, ...planRow.children], { y: 30, delay: base + 0.25, stagger: 0.07, spring: FX.spring.soft });
  FX.enter(rows, { y: 26, delay: base + 0.4, stagger: 0.03, spring: FX.spring.soft });
  list.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.7 + k * 0.03 }));
}

// ---------------------------------------------------------------- one topic: lesson, then test yourself
export function renderLearnTopic(root, ctx, topicId) {
  destroyLearn();
  const { exam, topics, questions, lessons } = ctx;
  const lesson = lessons.topics[topicId];
  const topic = topics.find((t) => t.id === topicId);
  if (!lesson || !topic) { mount(root, h('p', { class: 'lead' }, 'There is no lesson for this topic. ', h('a', { href: `#/exam/${exam.id}/learn`, class: 'back' }, 'Back to the path'))); return; }
  const path = pathTopics(topics, lessons);
  const step = path.findIndex((t) => t.id === topicId) + 1;
  const chunks = lesson.chunks;
  let i = 0, checking = false, qc = null;
  const asked = new Set();

  const startCheck = (e, el) => {
    const progress = loadProgress(exam.id);
    const picks = pickCheck(questions, topicId, progress, CHECK_SIZE, shuffle);
    if (!picks.length) return;
    const statusOf = (id) => topicStatus(progress, questions, id);
    const next = nextTopic(path, statusOf, topicId);
    stopSpeaking();
    FX.transition(() => runQuiz(root, ctx, picks, {
      label: `Learn: ${topic.title}`,
      newHref: next ? `#/exam/${exam.id}/learn/${next.id}` : `#/exam/${exam.id}/learn`,
      newLabel: next ? 'Next topic' : 'Back to the path',
    }), pos(e, el));
  };

  const segs = h('div', { class: 'quiz-segs', role: 'progressbar', 'aria-label': 'Lesson parts', 'aria-valuemin': 1, 'aria-valuemax': chunks.length }, chunks.map(() => h('i')));
  const body = h('div', { class: 'card lesson-card' });
  const bodyObj = card(body);
  const checkSlot = h('div', { class: 'quick-slot' });
  const backBtn = h('button', { class: 'btn', type: 'button' }, icon('arrow-left', 18), 'Back');
  const nextBtn = h('button', { class: 'btn yellow xl', type: 'button' });
  const nextObj = FX.obj(nextBtn, { cls: 'o-btn' });
  const backObj = FX.obj(backBtn, { cls: 'o-btn' });
  const nav = h('div', { class: 'lesson-nav' }, backObj, nextObj);

  // read aloud: the part is read when it appears, if switched on
  const partText = (c) => `${c.title}. ${c.points.join('. ')}${c.remember ? `. Remember: ${c.remember}` : ''}`;
  const say = () => { if (speechOn() && !checking) speak(partText(chunks[i]), { rate: speechRate() }); };
  let speechRow = null;
  if (canSpeak()) {
    const onBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(speechOn()) });
    const rateBtn = h('button', { class: 'btn', type: 'button' });
    const paintSpeech = () => { onBtn.replaceChildren(icon(speechOn() ? 'volume-2' : 'volume-x', 18), speechOn() ? 'Reading aloud' : 'Read aloud'); onBtn.setAttribute('aria-pressed', String(speechOn())); rateBtn.textContent = `Speed: ${RATES.find(([v]) => v === speechRate())[1]}`; rateBtn.hidden = !speechOn(); rateBtn.closest('.obj').hidden = !speechOn(); };
    onBtn.addEventListener('click', () => { setSpeechOn(!speechOn()); paintSpeech(); if (speechOn()) say(); else stopSpeaking(); });
    rateBtn.addEventListener('click', () => { const k = RATES.findIndex(([v]) => v === speechRate()); setSpeechRate(RATES[(k + 1) % RATES.length][0]); paintSpeech(); say(); });
    speechRow = h('div', { class: 'speech-row' }, FX.obj(onBtn, { cls: 'o-btn' }), FX.obj(rateBtn, { cls: 'o-btn' }));
    paintSpeech();
  }

  const paint = (dir) => {
    const c = chunks[i];
    body.replaceChildren(
      h('div', { class: 'lesson-top' }, h('span', { class: 'lab' }, `Part ${i + 1} of ${chunks.length}`),
        c.often ? h('span', { class: 'chip yellow', title: 'The syllabus lists this among the themes the class scored lowest on' }, icon('flame', 14), 'Often missed in class') : null),
      h('h2', { class: 'lesson-title' }, c.title),
      h('ul', { class: 'lesson-points' }, c.points.map((p) => h('li', null, p))),
      c.remember ? h('div', { class: 'remember' }, h('span', { class: 'lab' }, 'Remember'), h('p', null, c.remember)) : null);
    [...segs.children].forEach((b, k) => { b.classList.toggle('done', k < i); b.classList.toggle('current', k === i); });
    segs.setAttribute('aria-valuenow', i + 1);
    backBtn.disabled = i === 0;
    const last = i === chunks.length - 1;
    const quick = !last && c.ask && !asked.has(i);
    const label = last ? `Test yourself (${plural(Math.min(CHECK_SIZE, questions.filter((q) => q.topic === topicId).length), 'question', 'questions')})` : quick ? 'Quick check' : 'Next';
    nextBtn.replaceChildren(...[last ? icon('list-checks', 22) : quick ? icon('zap', 20) : null, label, last ? null : icon('arrow-right', 20)].filter(Boolean));
    if (last) recordLessonRead(exam.id, topicId);          // reaching the last part counts as having read the lesson
    if (dir) FX.anim(body, { opacity: [0, 1], x: [dir * 36, 0] }, { duration: 0.24, ease: 'easeOut' });
    say();
  };

  /** One question about the part just read, in the usual card; the answer is saved like any other. */
  const finishQuick = (after) => { qc?.destroy(); qc = null; checking = false; checkSlot.replaceChildren(); bodyObj.hidden = false; nav.hidden = false; after(); };
  const quickCheck = (k, after) => {
    const q = questions.find((x) => x.id === chunks[k].ask?.[0]);
    if (!q) { after(); return; }
    stopSpeaking();
    checking = true;
    let guessed = false;
    qc = questionCard(q, { index: 0, total: 1, last: false, docs: exam.documents, topicTitle: 'Quick check', nextLabel: 'Continue',
      onAnswer: ({ guess }) => { guessed = !!guess; },
      onNext: (score) => { recordAnswer(exam.id, q.id, score, { guess: guessed }); finishQuick(after); } });
    const skipQ = h('button', { class: 'btn textlink', type: 'button' }, 'Skip this question');
    skipQ.addEventListener('click', () => finishQuick(after));
    bodyObj.hidden = true; nav.hidden = true;
    checkSlot.replaceChildren(h('p', { class: 'lab quick-lab' }, icon('zap', 14), ` Quick check on part ${k + 1}`), qc.el, skipQ);
    FX.enter([qc.el], { y: 24, delay: 0, spring: FX.spring.soft });
  };

  const go = (e, d) => {
    if (checking) return;
    const n = i + d;
    if (n < 0) return;
    const move = () => { if (n >= chunks.length) { startCheck(e, nextBtn); return; } i = n; FX.sound('click'); paint(d); };
    if (d === 1 && n < chunks.length && chunks[i].ask && !asked.has(i)) { asked.add(i); quickCheck(i, move); return; }
    move();
  };
  backBtn.addEventListener('click', (e) => go(e, -1));
  nextBtn.addEventListener('click', (e) => go(e, 1));
  keyHandler = (e) => {
    if (checking || e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' && i < chunks.length - 1) go(null, 1);
    else if (e.key === 'ArrowLeft') go(null, -1);
  };
  document.addEventListener('keydown', keyHandler);

  const skip = h('button', { class: 'btn textlink', type: 'button' }, 'Skip the lesson, go to the questions');
  skip.addEventListener('click', (e) => startCheck(e, skip));
  const tm = studyTimer(exam.id); timers.push(tm);

  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}/learn` }, icon('arrow-left', 14), 'Study path'),
    h('div', { class: 'lesson-head' },
      h('p', { class: 'pagesub lab' }, `Step ${step} of ${path.length} / about ${lesson.minutes} min to read`),
      h('h1', { class: 'pagetitle' }, topic.title)),
    speechRow,
    segs, bodyObj, checkSlot, nav,
    h('p', { class: 'fine lesson-src' }, icon('book-open', 14), ' ', sourceText({ src: lesson.src }, exam.documents)),
    h('div', { class: 'actions', style: { marginTop: '8px' } }, skip),
    h('div', { style: { marginTop: '28px' } }, tm.el));
  paint(0);
  FX.enter([bodyObj], { y: 30, delay: FX.base(), spring: FX.spring.soft });
}

// ---------------------------------------------------------------- cheat sheet
export function renderCheatsheet(root, ctx) {
  const { exam, lessons, topics = [] } = ctx;
  const cs = lessons.cheatsheet || { formulas: [], lists: [], often: [] };
  const often = cs.often?.length ? card(h('div', { class: 'card cs-often' },
    h('h3', null, icon('flame', 20), ' Often missed in class'),
    h('p', { class: 'fine' }, cs.oftenSource || ''),
    h('div', { class: 'chips' }, cs.often.map((t) => h('span', { class: 'chip yellow' }, t))))) : null;
  const formulas = cs.formulas.map((f) => card(h('div', { class: 'card cs-card' },
    h('h3', null, f.name), h('p', { class: 'cs-formula' }, f.formula), f.example ? h('p', { class: 'cs-ex' }, h('span', { class: 'lab' }, 'Example'), ' ', f.example) : null)));
  const lists = cs.lists.map((l) => card(h('div', { class: 'card cs-card' }, h('h3', null, l.name), h('p', { class: 'cs-items' }, l.items))));

  // the one-line "Remember" of every lesson part, by topic: the whole course on a page or two
  const hooks = (lessons.order || Object.keys(lessons.topics || {})).map((id) => {
    const l = lessons.topics?.[id];
    const lines = (l?.chunks || []).filter((c) => c.remember);
    if (!lines.length) return null;
    return card(h('div', { class: 'card cs-card' }, h('h3', null, topics.find((t) => t.id === id)?.title || id),
      h('ul', { class: 'cs-hooks' }, lines.map((c) => h('li', null, h('strong', null, c.title), ' ', c.remember)))));
  }).filter(Boolean);
  const printBtn = h('button', { class: 'btn yellow', type: 'button' }, icon('printer', 18), 'Print this sheet');
  printBtn.addEventListener('click', () => window.print());
  const printHead = h('div', { class: 'cs-printhead' }, h('strong', null, `${exam.title}: cheat sheet`), h('span', null, new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })));

  mount(root, h('div', { class: 'cs-page' },
    h('a', { class: 'back', href: `#/exam/${exam.id}/learn` }, icon('arrow-left', 14), 'Study path'),
    printHead,
    h('h1', { class: 'pagetitle' }, 'Cheat sheet'),
    h('p', { class: 'lead' }, 'The formulas and lists to know by heart, with the numbers from the syllabus. Read it last, the evening before and an hour before the exam.'),
    h('div', { class: 'actions cs-noprint', style: { marginTop: '0', marginBottom: '22px' } }, FX.obj(printBtn, { cls: 'o-btn' }), h('span', { class: 'fine' }, 'Opens the print window of your browser (A4, black and white, about three pages). Choose "Save as PDF" to keep a copy.')),
    often,
    cs.formulas.length ? h('h2', { class: 'section' }, 'Formulas') : null, cs.formulas.length ? h('div', { class: 'cs-grid' }, formulas) : null,
    h('h2', { class: 'section' }, 'Lists to know by heart'), h('div', { class: 'cs-grid' }, lists),
    hooks.length ? h('h2', { class: 'section' }, 'Remember, topic by topic') : null, hooks.length ? h('div', { class: 'cs-grid' }, hooks) : null,
    h('div', { class: 'actions cs-noprint' }, FX.obj(h('a', { class: 'btn yellow xl', href: `#/exam/${exam.id}/simulation` }, icon('timer', 22), 'Exam simulation'), { cls: 'o-btn' }),
      h('a', { class: 'btn textlink', href: `#/exam/${exam.id}/learn` }, 'Back to the path'))));
  const base = FX.base();
  FX.enter([often, ...formulas, ...lists, ...hooks].filter(Boolean), { y: 24, delay: base, stagger: 0.025, spring: FX.spring.soft });
}
