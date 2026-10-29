// Exam simulation: setup -> timed exam -> (grade your own open answers) -> results. One exam at a time.
// The rules live in sim.js (no DOM); the attempt in progress is saved after every change, so a reload or a closed tab loses nothing.
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { TYPE_LABEL, sourceText } from './question.js';
import { answerText } from './cards.js';
import { loadSim, saveSim, clearSim, recordExam } from './store.js';
import { simConfig, simPool, pickExam, newAttempt, isAnswered, timeLeft, secondsUsed, clock, pendingGrades, finalScores, passed } from './sim.js';
import { pillBtn, renderResults, runQuiz } from './quiz.js';

const M = window.Motion;
const WARN_MINUTES = [10, 5, 1];
const centreOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const pos = (e, el) => (e && e.clientX ? { x: e.clientX, y: e.clientY } : centreOf(el));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let active = null;
/** Stops the timer and the key handler of the exam on screen (called when the route changes). The attempt stays saved. */
export function destroySim() { active?.destroy(); active = null; }

/** A saved attempt whose questions were removed from the content since is cleaned up; null when nothing is left. */
function usable(at, byId) {
  if (!at) return null;
  at.ids = at.ids.filter((id) => byId.has(id));
  return at.ids.length ? at : null;
}

const segmented = (options, current, onPick) => {
  const items = options.map(([val, label]) => [val, pillBtn(label, val === current, () => { onPick(val); items.forEach(([v, x]) => x.querySelector('.pill-btn').setAttribute('aria-pressed', String(v === val))); })]);
  return h('div', { class: 'pills' }, items.map(([, o]) => o));
};

function startSimulation(root, ctx, count, minutes, from) {
  const cfg = simConfig(ctx.exam);
  const attempt = newAttempt(ctx.exam.id, pickExam(simPool(ctx.questions, cfg), count), minutes);
  saveSim(ctx.exam.id, attempt);
  FX.transition(() => runSim(root, ctx, attempt), from);
}

/** Where a saved attempt goes next: still running, ran out of time while away, or waiting for your grades. */
function resumeSim(root, ctx, at) {
  if (!at.submittedAt && timeLeft(at) === 0) { at.submittedAt = at.endAt; at.timedOut = true; saveSim(ctx.exam.id, at); }
  if (at.submittedAt) afterSubmit(root, ctx, at); else runSim(root, ctx, at);
}

// ---------------------------------------------------------------- setup
export function renderSimSetup(root, ctx) {
  destroySim();
  const { exam, questions } = ctx;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const cfg = simConfig(exam);
  const pool = simPool(questions, cfg);
  const state = { count: Math.min(cfg.questions, pool.length), minutes: cfg.minutes };
  const counts = [...new Set([10, 20, 40, 60, state.count].filter((n) => n > 0 && n <= pool.length))].sort((a, b) => a - b);
  const mins = [...new Set([15, 30, 45, 60, 90, 120, state.minutes])].sort((a, b) => a - b);
  const typeNames = cfg.types.map((t) => TYPE_LABEL[t]).join(', ');

  const summary = h('p', { class: 'setup-summary', role: 'status' });
  const refresh = () => { summary.textContent = `${plural(state.count, 'question', 'questions')} in ${state.minutes} min, about ${Math.round((state.minutes * 60) / state.count)} s each`; };
  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('timer', 22), 'Start exam');
  startBtn.disabled = !pool.length;
  const startObj = FX.obj(startBtn, { cls: 'o-btn' });
  startBtn.addEventListener('click', (e) => startSimulation(root, ctx, state.count, state.minutes, pos(e, startBtn)));

  const noteFace = h('div', { class: 'card sim-note' },
    h('span', { class: `chip ${cfg.official ? 'accent' : 'yellow'}` }, icon('info', 14), cfg.official ? 'Official format' : 'Practice setup, not the official format'),
    h('p', null, cfg.note || (cfg.official ? '' : 'The real exam format is not known, so the numbers below are yours to set.')),
    h('p', { class: 'fine' }, `Question types: ${typeNames}. ${Number.isFinite(cfg.passMark) ? `Pass mark: ${cfg.passMark}%.` : 'No pass mark is set, so you get a score but no pass or fail.'}`));
  const noteObj = FX.obj(noteFace, { cls: 'o-tile', hover: false });

  const how = h('ul', { class: 'sim-how' },
    h('li', null, 'No feedback until you submit, like the real thing.'),
    h('li', null, 'Go back, change answers and flag questions to come back to.'),
    h('li', null, 'When the time is up the exam is submitted for you.'),
    cfg.types.includes('open') ? h('li', null, 'Open questions: write your answer, then grade yourself against the model answer at the end.') : null,
    h('li', null, 'Your answers count toward your accuracy and weak spots, like any other answer.'));

  // an exam in progress (the attempt is saved, so it survives a reload)
  const saved = usable(loadSim(exam.id), byId);
  let resumeBlock = null;
  if (saved) {
    const answered = saved.ids.filter((id) => isAnswered(saved.answers[id])).length;
    const left = timeLeft(saved);
    const msg = saved.submittedAt ? 'Your last exam was submitted, but not graded yet.'
      : left === 0 ? 'Time ran out on your last exam while you were away.'
        : `Exam in progress: ${answered} of ${saved.ids.length} answered, ${clock(left)} left.`;
    const go = h('button', { class: 'btn yellow', type: 'button' }, icon('play', 18), saved.submittedAt ? 'Continue grading' : left === 0 ? 'See my result' : 'Resume exam');
    go.addEventListener('click', (e) => FX.transition(() => resumeSim(root, ctx, saved), pos(e, go)));
    let armed = false;
    const drop = h('button', { class: 'btn alt', type: 'button' }, 'Discard it');
    drop.addEventListener('click', () => {
      if (!armed) { armed = true; drop.textContent = 'Click again to confirm'; setTimeout(() => { armed = false; drop.textContent = 'Discard it'; }, 4000); return; }
      clearSim(exam.id); renderSimSetup(root, ctx);
    });
    resumeBlock = FX.obj(h('div', { class: 'card sim-resume' }, h('h3', null, 'Unfinished exam'), h('p', null, msg),
      h('p', { class: 'fine' }, 'Starting a new exam replaces it.'),
      h('div', { class: 'grades' }, FX.obj(go, { cls: 'o-btn' }), FX.obj(drop, { cls: 'o-btn' }))), { cls: 'o-tile', hover: false });
  }

  const sections = [
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'How many questions'), segmented(counts.map((c) => [c, String(c)]), state.count, (v) => { state.count = v; refresh(); })),
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Minutes'), segmented(mins.map((m) => [m, String(m)]), state.minutes, (v) => { state.minutes = v; refresh(); })),
    h('div', { class: 'start-row' }, startObj, summary),
    h('p', { class: 'fine', style: { marginTop: '18px' } }, `Questions are drawn from all topics of this exam (${pool.length} match), spread evenly across the topics.`),
  ];
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Exam simulation'),
    h('p', { class: 'lead' }, 'A timed run through mixed questions with one score at the end.'),
    noteObj, resumeBlock, how, sections);
  refresh();
  const base = FX.base();
  FX.enter([noteObj, resumeBlock].filter(Boolean), { y: 30, delay: base, stagger: 0.07, spring: FX.spring.soft });
  FX.enter(sections, { y: 30, delay: base + 0.15, stagger: 0.07, spring: FX.spring.soft });
}

// ---------------------------------------------------------------- the exam
export function runSim(root, ctx, at) {
  destroySim();
  const { exam, topics } = ctx;
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  if (!usable(at, byId)) { renderSimSetup(root, ctx); return; }
  const qs = at.ids.map((id) => byId.get(id));
  const total = qs.length;
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  let i = 0, over = false, confirming = false, cur = {}, saveTimer = 0;
  const warned = new Set();

  const flush = () => { clearTimeout(saveTimer); saveSim(exam.id, at); };
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSim(exam.id, at), 250); };

  // ---- top: timer, counter, submit
  const tText = h('span', { class: 't' });
  const timerEl = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' }, icon('timer', 20), tText);
  const countEl = h('span', { class: 'lab' });
  const live = h('p', { class: 'sim-live', role: 'status' });
  const submitBtn = h('button', { class: 'btn yellow', type: 'button' }, icon('check', 18), 'Submit exam');
  const top = h('div', { class: 'sim-top' }, h('div', { class: 'left' }, timerEl, countEl), FX.obj(submitBtn, { cls: 'o-btn' }));

  const tick = () => {
    const left = timeLeft(at);
    const txt = clock(left);
    if (tText.textContent !== txt) tText.textContent = txt;
    timerEl.classList.toggle('low', left <= 5 * 60000 && left > 60000);
    timerEl.classList.toggle('crit', left <= 60000);
    for (const m of WARN_MINUTES) if (left <= m * 60000 && !warned.has(m)) { warned.add(m); live.textContent = `${plural(m, 'minute', 'minutes')} left`; }
    if (left <= 0) submit(true);
  };
  { const left = timeLeft(at); for (const m of WARN_MINUTES) if (left <= m * 60000) warned.add(m); }   // do not announce thresholds already passed

  // ---- navigator: one numbered button per question
  const navBtns = qs.map((_, k) => { const b = h('button', { class: 'nav-q', type: 'button' }, String(k + 1)); b.addEventListener('click', () => go(k)); return b; });
  const nav = h('div', { class: 'sim-nav', role: 'group', 'aria-label': 'Questions' }, navBtns);
  const paint = () => {
    let answered = 0;
    navBtns.forEach((b, k) => {
      const id = at.ids[k];
      const done = isAnswered(at.answers[id]), flag = at.flags.includes(id);
      if (done) answered += 1;
      b.classList.toggle('done', done); b.classList.toggle('flag', flag); b.classList.toggle('cur', k === i);
      b.setAttribute('aria-current', k === i ? 'step' : 'false');
      b.setAttribute('aria-label', `Question ${k + 1}, ${done ? 'answered' : 'not answered'}${flag ? ', flagged' : ''}`);
    });
    countEl.textContent = `Question ${i + 1} / ${total} / ${answered} answered`;
  };

  // ---- one question
  const stage = h('div', { class: 'sim-stage' });
  function buildCard(k) {
    const q = qs[k], id = q.id;
    const body = h('div', { class: 'qbody' });
    cur = { type: q.type };
    if (q.type === 'mc' || q.type === 'tf') {
      const labels = q.type === 'mc' ? at.orders[id].map((o) => q.options[o]) : ['True', 'False'];
      const keys = q.type === 'mc' ? labels.map((_, n) => String(n + 1)) : ['T', 'F'];
      const rows = labels.map((label, p) => {
        const btn = h('button', { class: 'opt', type: 'button', 'aria-pressed': String(at.answers[id] === p) }, h('span', { class: 'key' }, keys[p]), h('span', { class: 'txt' }, h('span', { class: 'ink' }, label)));
        btn.classList.toggle('picked', at.answers[id] === p);
        btn.addEventListener('click', () => choose(p));
        return { btn, obj: FX.obj(btn, { cls: 'o-opt', tilt: 3, z: 20 }) };
      });
      const choose = (p) => {
        if (at.answers[id] === p) delete at.answers[id]; else at.answers[id] = p;     // pressing the chosen option again clears it
        rows.forEach((r, n) => { const on = at.answers[id] === n; r.btn.classList.toggle('picked', on); r.btn.setAttribute('aria-pressed', String(on)); });
        flush(); paint();
      };
      cur = { type: q.type, choose, n: rows.length };
      body.append(h('div', { class: 'options' }, rows.map((r) => r.obj)));
    } else {
      const field = q.type === 'fill'
        ? h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer', placeholder: 'Type your answer' })
        : h('textarea', { rows: 6, 'aria-label': 'Your answer', placeholder: 'Write your answer. You will compare it with the model answer and grade yourself after submitting.' });
      field.value = at.answers[id] || '';
      field.addEventListener('input', () => { if (field.value.trim()) at.answers[id] = field.value; else delete at.answers[id]; persist(); paint(); });
      body.append(FX.obj(field, { cls: 'o-input', hover: false }));
    }

    const flagged = () => at.flags.includes(id);
    const flagBtn = h('button', { class: 'btn flagbtn', type: 'button', 'aria-pressed': String(flagged()) }, icon('flag', 18), 'Flag for review', h('kbd', null, 'M'));
    const toggleFlag = () => { at.flags = flagged() ? at.flags.filter((x) => x !== id) : [...at.flags, id]; flagBtn.setAttribute('aria-pressed', String(flagged())); flush(); paint(); };
    flagBtn.addEventListener('click', toggleFlag);
    cur.toggleFlag = toggleFlag;
    const prevBtn = h('button', { class: 'btn', type: 'button' }, icon('arrow-left', 18), 'Previous');
    prevBtn.disabled = k === 0;
    prevBtn.addEventListener('click', () => go(k - 1));
    const last = k === total - 1;
    const nextBtn = h('button', { class: `btn ${last ? 'yellow' : ''}`, type: 'button' }, last ? 'Review and submit' : 'Next', icon(last ? 'check' : 'arrow-right', 18));
    nextBtn.addEventListener('click', () => (last ? openConfirm() : go(k + 1)));
    const hint = h('div', { class: 'hints' }, h('span', null, h('kbd', null, '←'), h('kbd', null, '→'), ' move'),
      q.type === 'mc' ? h('span', null, h('kbd', null, '1'), h('kbd', null, String(cur.n)), ' answer') : q.type === 'tf' ? h('span', null, h('kbd', null, 'T'), h('kbd', null, 'F'), ' answer') : null);

    const face = h('article', { class: 'qcard' },
      h('div', { class: 'qmeta' }, h('span', { class: 'chip accent' }, topicTitle(q.topic)), h('span', { class: 'chip' }, TYPE_LABEL[q.type])),
      h('h1', { class: 'qtext' }, q.question), body,
      h('div', { class: 'qfoot' }, FX.obj(flagBtn, { cls: 'o-btn' }), hint, h('div', { class: 'sim-steps' }, FX.obj(prevBtn, { cls: 'o-btn' }), FX.obj(nextBtn, { cls: 'o-btn' }))));
    return FX.obj(face, { cls: 'o-card', hover: false });
  }
  function show(dir = 0) {
    const el = buildCard(i);
    stage.replaceChildren(el);
    if (dir) { M.animate(el, { opacity: 0, x: 36 * dir }, { duration: 0 }); FX.anim(el, { opacity: 1, x: 0 }, FX.spring.soft); }
    paint();
  }
  function go(k) {
    if (over || k < 0 || k >= total || k === i) return;
    flush();
    const dir = k > i ? 1 : -1;
    i = k;
    show(dir);
  }

  // ---- submit: a panel that shows what is still open; the page behind it is inert
  const overlay = h('div', { class: 'sim-confirm-wrap', hidden: true });
  const page = h('div', { class: 'quiz-wrap sim-wrap' }, top, nav,
    h('p', { class: 'fine sim-legend' }, 'Filled = answered. Dot = flagged. Ring = this question.'), stage, live);
  mount(root, page, overlay);
  function openConfirm() {
    if (over || confirming) return;
    confirming = true;
    flush();
    const open = at.ids.map((id, k) => [id, k]).filter(([id]) => !isAnswered(at.answers[id]));
    const flagged = at.ids.map((id, k) => [id, k]).filter(([id]) => at.flags.includes(id));
    const jumps = (list) => h('div', { class: 'jumps' }, list.map(([, k]) => { const b = h('button', { class: 'nav-q', type: 'button', 'aria-label': `Go to question ${k + 1}` }, String(k + 1)); b.addEventListener('click', () => { closeConfirm(); go(k); }); return b; }));
    const submitNow = h('button', { class: 'btn yellow', type: 'button' }, icon('check', 18), 'Submit now');
    const keep = h('button', { class: 'btn', type: 'button' }, 'Keep working');
    submitNow.addEventListener('click', () => submit(false));
    keep.addEventListener('click', closeConfirm);
    overlay.replaceChildren(h('div', { class: 'card sim-confirm', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Submit the exam' },
      h('h2', { class: 'small' }, 'Ready to submit?'),
      h('p', null, `${total - open.length} of ${total} answered. ${plural(open.length, 'question is', 'questions are')} still empty${flagged.length ? `, ${plural(flagged.length, 'is', 'are')} flagged` : ''}.`),
      open.length ? h('div', null, h('span', { class: 'lab' }, 'Not answered'), jumps(open)) : null,
      flagged.length ? h('div', null, h('span', { class: 'lab' }, 'Flagged'), jumps(flagged)) : null,
      h('p', { class: 'fine' }, 'Empty questions score 0. You cannot change anything after this.'),
      h('div', { class: 'grades' }, FX.obj(submitNow, { cls: 'o-btn' }), FX.obj(keep, { cls: 'o-btn' }))));
    overlay.hidden = false;
    page.inert = true;
    keep.focus();
  }
  function closeConfirm() { confirming = false; overlay.hidden = true; page.inert = false; }
  submitBtn.addEventListener('click', openConfirm);

  function submit(timedOut) {
    if (over) return;
    over = true;
    session.destroy();
    clearTimeout(saveTimer);
    at.submittedAt = Date.now(); at.timedOut = timedOut;
    saveSim(exam.id, at);
    overlay.hidden = true; page.inert = false;
    FX.transition(() => afterSubmit(root, ctx, at), centreOf(top));
  }

  const onKey = (e) => {
    if (over || e.ctrlKey || e.metaKey || e.altKey) return;
    if (confirming) { if (e.key === 'Escape') closeConfirm(); return; }
    if (e.target.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowRight') { if (i < total - 1) go(i + 1); else openConfirm(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(i - 1); e.preventDefault(); }
    else if (k === 'm') { cur.toggleFlag?.(); e.preventDefault(); }
    else if (cur.choose) {
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= cur.n) { cur.choose(Number(e.key) - 1); e.preventDefault(); }
      else if (cur.type === 'tf' && (k === 't' || k === 'f')) { cur.choose(k === 't' ? 0 : 1); e.preventDefault(); }
    }
  };
  document.addEventListener('keydown', onKey);
  const timer = setInterval(tick, 250);
  const session = { destroy() { over = true; clearInterval(timer); clearTimeout(saveTimer); document.removeEventListener('keydown', onKey); } };
  active = session;

  tick();
  show(0);
  FX.enter([top, nav, stage], { y: 24, delay: FX.base(), stagger: 0.06, spring: FX.spring.soft });
}

// ---------------------------------------------------------------- after submitting
function afterSubmit(root, ctx, at) {
  destroySim();
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  if (!usable(at, byId)) { clearSim(ctx.exam.id); renderSimSetup(root, ctx); return; }
  const pending = pendingGrades(at, byId);
  if (pending.length) renderGrading(root, ctx, at, byId, pending); else finishExam(root, ctx, at, byId);
}

/** Open answers need your own grade; fill-in answers marked wrong can be overruled. Nothing is scored until you finish. */
function renderGrading(root, ctx, at, byId, pending) {
  const { exam, topics } = ctx;
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  const required = pending.filter((p) => p.required);
  const status = h('p', { class: 'setup-summary', role: 'status' });
  const finish = h('button', { class: 'btn yellow xl', type: 'button' }, icon('check', 22), 'Show my result');
  const finishObj = FX.obj(finish, { cls: 'o-btn' });
  const paintLeft = () => {
    const left = required.filter((p) => at.grades[p.id] === undefined).length;
    finish.disabled = left > 0;
    status.textContent = left ? `${plural(left, 'answer', 'answers')} left to grade` : 'All graded';
  };

  const cards = pending.map((p, n) => {
    const q = byId.get(p.id);
    const buttons = p.kind === 'open'
      ? [[0, 'Missed it', 'g0'], [0.5, 'Partly', 'g1'], [1, 'Got it', 'g2']]
      : [[undefined, 'Mine was wrong', 'alt'], [1, 'Mine was right', 'g2']];
    const btns = buttons.map(([v, label, cls]) => h('button', { class: `btn ${cls}`, type: 'button', 'aria-pressed': String(at.grades[p.id] === v) }, label));
    const sync = () => btns.forEach((b, k) => b.setAttribute('aria-pressed', String(at.grades[p.id] === buttons[k][0])));
    btns.forEach((b, k) => b.addEventListener('click', () => {
      if (buttons[k][0] === undefined) delete at.grades[p.id]; else at.grades[p.id] = buttons[k][0];
      saveSim(exam.id, at); sync(); paintLeft();
    }));
    const face = h('div', { class: 'card grade-item' },
      h('div', { class: 'qmeta' }, h('span', { class: 'chip accent' }, topicTitle(q.topic)), h('span', { class: 'chip' }, TYPE_LABEL[q.type])),
      h('h3', { class: 'qtext-s' }, q.question),
      h('span', { class: 'lab' }, 'Your answer'), h('p', { class: 'quote' }, at.answers[p.id]),
      h('span', { class: 'lab' }, q.type === 'open' ? 'Model answer' : 'Accepted answer'), h('p', { class: 'quote model' }, answerText(q)),
      q.explanation ? h('p', { class: 'why' }, q.explanation) : null,
      h('p', { class: 'src' }, icon('book-open', 14), sourceText(q, exam.documents)),
      h('div', { class: 'grades' }, p.kind === 'open' ? h('span', { class: 'next-hint' }, 'How did yours compare?') : null, btns.map((b) => FX.obj(b, { cls: 'o-btn' }))));
    return FX.obj(face, { cls: 'o-tile', hover: false, rot: 0 });
  });

  finish.addEventListener('click', (e) => { finish.disabled = true; FX.transition(() => finishExam(root, ctx, at, byId), pos(e, finish)); });
  mount(root,
    h('h1', { class: 'pagetitle' }, 'Grade your answers'),
    h('p', { class: 'lead' }, [required.length ? 'Compare your open answers with the model answers and grade yourself.' : '', pending.some((p) => p.kind === 'fill') ? 'Fill-in answers the app marked wrong are listed too: say so if yours was right.' : ''].filter(Boolean).join(' ')),
    h('div', { class: 'review-list' }, cards),
    h('div', { class: 'start-row' }, finishObj, status));
  paintLeft();
  window.scrollTo(0, 0);
  FX.enter(cards, { y: 28, delay: FX.base(), stagger: 0.05, spring: FX.spring.soft });
}

/** Records the exam once (question totals and one session), clears the saved attempt, shows the results. */
function finishExam(root, ctx, at, byId) {
  const { exam } = ctx;
  const final = finalScores(at, byId);
  recordExam(exam.id, final.items, { mode: 'simulation', label: 'Exam simulation', answered: final.answered, total: final.total, score: final.points, minutes: at.minutes, seconds: secondsUsed(at), timedOut: !!at.timedOut, bestStreak: 0 });
  clearSim(exam.id);
  const cfg = simConfig(exam);
  const verdict = passed(final.pct, cfg.passMark);
  const used = secondsUsed(at);
  const yours = (q) => {
    const a = at.answers[q.id];
    const text = !isAnswered(a) ? null : q.type === 'mc' ? q.options[at.orders[q.id][a]] : q.type === 'tf' ? (a === 0 ? 'True' : 'False') : String(a);
    return h('p', { class: 'yours' }, h('span', { class: 'lab' }, 'Your answer'), text === null ? 'Not answered' : text);
  };
  renderResults(root, ctx, final.items.map((x) => ({ q: x.q, score: x.score })), {
    bestStreak: 0, planned: final.total,
    title: 'Exam finished',
    sub: `${exam.shortTitle || exam.title} / practice simulation / ${used < 60 ? `${used} s` : `${Math.round(used / 60)} min`} of ${at.minutes} min used`,
    chips: [
      `${final.answered} of ${final.total} answered`,
      at.timedOut ? 'Time ran out' : null,
      verdict === null ? null : verdict ? `Pass mark ${cfg.passMark}% reached` : `Below the ${cfg.passMark}% pass mark`,
    ].filter(Boolean),
    reviewExtra: yours,
    againLabel: 'Another simulation', newLabel: 'Exam setup', newHref: `#/exam/${exam.id}/simulation`,
    again: (e) => startSimulation(root, ctx, at.ids.length, at.minutes, pos(e, document.body)),
    retry: (qs, e) => FX.transition(() => runQuiz(root, ctx, qs, { label: 'Retry missed' }), pos(e, document.body)),
  });
}
