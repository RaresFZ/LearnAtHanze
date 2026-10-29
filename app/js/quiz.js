// Quiz mode: setup screen -> question loop -> results. Works on one exam's data at a time.
import { h, mount, shuffle, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { questionCard, TYPE_LABEL, reviewBlocks, destroyActiveCard } from './question.js';
import { loadProgress, recordAnswer, recordSession, questionStat } from './store.js';

const M = window.Motion;
const COUNTS = [5, 10, 20, 40, 0];
const MILESTONES = [3, 5, 10];
const FLAME = '<svg viewBox="0 0 16 22" aria-hidden="true"><path d="M8 1 C 9 6 14 8 14 14 C 14 18 11 21 8 21 C 5 21 2 18 2 14 C 2 11 4 10 5 7 C 6 8 7 8 7.5 6 C 8 4 8 3 8 1 Z" fill="#ff9f7a" stroke="#141414" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 11 C 9 13 11 14 11 16 C 11 18 9.5 19 8 19 C 6.5 19 5 18 5 14 C 5 14 7 13 8 11Z" fill="#ffd83d"/></svg>';

function pickQuestions(pool, n, strategy, progress) {
  const ranked = pool.map((q) => {
    const s = questionStat(progress, q.id);
    let w = Math.random();
    if (strategy === 'unseen') w += s.seen ? 1 : 0;
    if (strategy === 'weak') w = (s.seen ? s.accuracy : 0.6) + Math.random() * 0.3;
    return { q, w };
  });
  ranked.sort((a, b) => a.w - b.w);
  return shuffle(ranked.slice(0, n || ranked.length).map((x) => x.q));
}

export const pillBtn = (label, on, onClick) => {
  const b = h('button', { class: 'pill-btn', type: 'button', 'aria-pressed': String(on) }, label);
  b.addEventListener('click', onClick);
  return FX.obj(b, { cls: 'o-pill' });
};
const centreOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

// ---------------------------------------------------------------- setup
export function renderQuizSetup(root, ctx, preset = {}) {
  const { exam, topics, questions } = ctx;
  const progress = loadProgress(exam.id);
  const types = Object.keys(TYPE_LABEL).filter((t) => questions.some((q) => q.type === t));
  const state = {
    topics: new Set(preset.topics || []),
    types: new Set(preset.types || types),
    count: preset.count ?? 10,
    strategy: preset.strategy || 'random',
  };
  const topicCount = (id) => questions.filter((q) => q.topic === id).length;
  const summary = h('p', { class: 'setup-summary', role: 'status' });
  const startBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('play', 22), 'Start quiz');
  const startObj = FX.obj(startBtn, { cls: 'o-btn' });

  const poolNow = () => questions.filter((q) => (state.topics.size === 0 || state.topics.has(q.topic)) && state.types.has(q.type));
  const refresh = () => {
    const n = poolNow().length;
    const take = state.count ? Math.min(state.count, n) : n;
    summary.textContent = n ? `${take} of ${n} matching questions` : 'No questions match these filters';
    startBtn.disabled = !n;
  };

  const toggle = (label, on, count, onToggle) => {
    const b = h('button', { class: 'toggle', type: 'button', 'aria-pressed': String(on) },
      h('span', { class: 'box' }, icon('check', 14)), h('span', { class: 't' }, label), count != null ? h('span', { class: 'count' }, count) : null);
    b.addEventListener('click', () => { b.setAttribute('aria-pressed', String(onToggle())); refresh(); });
    return { btn: b, obj: FX.obj(b, { cls: 'o-tile', tilt: 0, z: 10 }) };
  };
  const segmented = (options, current, onPick) => {
    const items = options.map(([val, label]) => {
      const o = pillBtn(label, val === current, () => { onPick(val); items.forEach(([v, x]) => x.querySelector('.pill-btn').setAttribute('aria-pressed', String(v === val))); refresh(); });
      return [val, o];
    });
    return h('div', { class: 'pills' }, items.map(([, o]) => o));
  };

  const topicToggles = topics.filter((t) => topicCount(t.id)).map((t) =>
    toggle(t.title, state.topics.has(t.id), topicCount(t.id), () => {
      state.topics.has(t.id) ? state.topics.delete(t.id) : state.topics.add(t.id);
      return state.topics.has(t.id);
    }));
  const clear = h('button', { class: 'btn', type: 'button' }, 'Clear selection');
  clear.addEventListener('click', () => { state.topics.clear(); topicToggles.forEach((t) => t.btn.setAttribute('aria-pressed', 'false')); refresh(); });
  const typeToggles = types.map((t) => toggle(TYPE_LABEL[t], state.types.has(t), questions.filter((q) => q.type === t).length, () => {
    if (state.types.has(t) && state.types.size === 1) return true;   // keep at least one type
    state.types.has(t) ? state.types.delete(t) : state.types.add(t);
    return state.types.has(t);
  }));

  startBtn.addEventListener('click', (e) => {
    const picked = pickQuestions(poolNow(), state.count, state.strategy, progress);
    FX.transition(() => runQuiz(root, ctx, picked, { label: state.topics.size ? 'Topic quiz' : 'Random mix' }), { x: e.clientX || centreOf(startBtn).x, y: e.clientY || centreOf(startBtn).y });
  });

  const sections = [
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Topics', FX.obj(clear, { cls: 'o-btn' })), h('div', { class: 'togglegrid' }, topicToggles.map((t) => t.obj))),
    h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Question types'), h('div', { class: 'togglegrid' }, typeToggles.map((t) => t.obj))),
    h('div', { class: 'two-col' },
      h('section', { class: 'field' }, h('h2', { class: 'small' }, 'How many questions'), segmented(COUNTS.map((c) => [c, c || 'All']), state.count, (v) => { state.count = v; })),
      h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Which questions first'), segmented([['random', 'Random'], ['unseen', 'Unseen'], ['weak', 'Weakest']], state.strategy, (v) => { state.strategy = v; }))),
    h('div', { class: 'start-row' }, startObj, summary),
  ];
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Quiz'),
    h('p', { class: 'lead' }, 'Choose topics, question types and length. Leave the topics empty for a random mix of everything.'),
    sections);
  refresh();
  const base = FX.base();
  FX.enter(sections, { y: 30, delay: base, stagger: 0.07, spring: FX.spring.soft });
}

// ---------------------------------------------------------------- run
export function runQuiz(root, ctx, questions, { label = 'Quiz' } = {}) {
  const { exam, topics } = ctx;
  if (!questions.length) { mount(root, h('p', null, 'No questions to ask.')); return; }
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  const total = questions.length;
  const results = [];
  let i = 0;
  let streak = loadProgress(exam.id).streak;      // carried over from earlier quizzes
  let bestStreak = streak;
  let pending = null;                              // answered, not yet advanced
  let card = null;
  let over = false;

  // blocks: one per question, or 20 blocks when the quiz is long
  const nBlocks = total <= 24 ? total : 20;
  const doneBlocks = (answered) => (total <= 24 ? answered : Math.floor((answered * nBlocks) / total));

  const exitBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'End quiz' }, icon('x', 18));
  const countEl = h('span', { class: 'lab' });
  const segs = h('div', { class: 'quiz-segs', role: 'progressbar', 'aria-label': 'Questions answered', 'aria-valuemin': 0, 'aria-valuemax': total }, Array.from({ length: nBlocks }, () => h('i')));
  const sticker = h('div', { class: 'sticker-wrap' });
  const flames = h('div', { class: 'flames' });
  const roll = h('b', { class: 'roll' });
  sticker.append(flames, h('span', { class: 'sticker' }, icon('flame', 16), ' ', roll, ' in a row'));
  M.animate(sticker, { rotate: -2 }, { duration: 0 });
  const deck = h('div', { class: 'deck' });
  const mascot = FX.mascot();
  deck.append(mascot);

  const level = (s) => (s >= 10 ? 3 : s >= 5 ? 2 : s >= 3 ? 1 : 0);
  const paintSticker = (pop) => {
    roll.textContent = streak;
    const L = level(streak);
    flames.className = 'flames lvl' + L; flames.innerHTML = FLAME.repeat(L ? L * 2 + 1 : 0);
    if (streak >= 2) {
      sticker.style.display = '';
      if (pop) { FX.anim(sticker, { scale: [0.7, 1.18, 1], rotate: [-2, -8, -2] }, { duration: 0.5, ease: 'easeOut' }); FX.anim(roll, { y: [16, 0], opacity: [0, 1] }, FX.spring.bouncy); }
    } else if (pop && sticker.style.display !== 'none') {
      FX.anim(sticker, { scale: [1, 0.2], opacity: [1, 0] }, { duration: 0.22 }).then(() => { sticker.style.display = 'none'; M.animate(sticker, { scale: 1, opacity: 1 }, { duration: 0 }); });
    } else if (streak < 2) sticker.style.display = 'none';
  };
  const paintSegs = (answered, { pop } = {}) => {
    const done = doneBlocks(answered);
    const cur = Math.min(done, nBlocks - 1);
    [...segs.children].forEach((b, k) => {
      const was = b.classList.contains('done');
      b.classList.toggle('done', k < done);
      b.classList.toggle('current', k === cur && k >= done);
      if (pop && k < done && !was) { b.classList.add(pop); FX.anim(b, { scale: [1.25, 1] }, FX.spring.bouncy); }
    });
    segs.setAttribute('aria-valuenow', answered);
    countEl.textContent = `Question ${Math.min(i + 1, total)} / ${total}`;
  };

  mount(root, h('div', { class: 'quiz-wrap' },
    h('div', { class: 'quiz-top' }, h('div', { class: 'left' }, FX.obj(exitBtn, { cls: 'o-icon' }), countEl), sticker),
    segs, deck));
  paintSticker(false);
  paintSegs(0);

  const record = (score) => {
    if (!pending) return;
    recordAnswer(exam.id, pending.q.id, score);
    results.push({ q: pending.q, score });
    pending = null;
  };

  const finish = (from) => {
    if (over) return;
    over = true;
    card?.destroy();
    record(pending ? pending.score : 0);
    if (results.length) {
      const sum = results.reduce((s, r) => s + r.score, 0);
      recordSession(exam.id, { mode: 'quiz', label, answered: results.length, score: sum, bestStreak });
    }
    const where = from || centreOf(deck);
    FX.transition(() => renderResults(root, ctx, results, {
      bestStreak, planned: total,
      again: (e) => FX.transition(() => runQuiz(root, ctx, shuffle(questions), { label }), pos(e)),
      retry: (qs, e) => FX.transition(() => runQuiz(root, ctx, qs, { label: 'Retry missed' }), pos(e)),
    }), where);
  };
  const pos = (e) => (e && e.clientX ? { x: e.clientX, y: e.clientY } : { x: innerWidth / 2, y: innerHeight / 2 });
  exitBtn.addEventListener('click', (e) => finish(pos(e)));

  const onAnswer = ({ score, right, x, y }) => {
    const q = questions[i];
    pending = { q, score, prevStreak: streak, x, y };
    paintSegs(results.length + 1, { pop: right ? 'flash-good' : 'flash-bad' });
    if (right) {
      streak += 1;
      applyCorrect(x, y);
    } else {
      streak = 0;
      FX.sound(score === 0 ? 'thud' : 'click');
      paintSticker(true);
      mascot.mood(score === 0 ? 'sad' : 'idle', 2200);
    }
  };
  const applyCorrect = (x, y) => {
    bestStreak = Math.max(bestStreak, streak);
    const milestone = MILESTONES.includes(streak);
    FX.confetti(x, y, { count: 8 });                                  // small burst, fire and forget
    FX.sound(milestone ? 'big' : 'pop');
    paintSticker(true);
    mascot.mood('happy', milestone ? 2600 : 1900);
    if (milestone) {
      const c = centreOf(sticker);
      FX.confetti(c.x, c.y, { count: 14, big: true });
      FX.anim(sticker, { scale: [1, 1.5, 1], rotate: [-2, 10, -4, -2] }, { type: 'spring', stiffness: 300, damping: 9 });
    }
  };
  const onOverride = ({ x, y }) => {            // fill-in: "my answer was right"
    if (!pending) return;
    pending.score = 1;
    streak = pending.prevStreak + 1;
    applyCorrect(x, y);
  };

  const deal = (delay = 0) => {
    const q = questions[i];
    card = questionCard(q, {
      index: i, total, last: i === total - 1, docs: exam.documents, topicTitle: topicTitle(q.topic),
      onAnswer, onOverride,
      onNext: (score) => {
        record(pending ? pending.score : score);
        if (i + 1 >= total) { finish(); return; }
        const old = card.el;
        card.destroy();
        const after = () => { old.remove(); i += 1; paintSegs(results.length); deal(0); const cur = segs.querySelector('.current'); if (cur) FX.anim(cur, { scale: [1.3, 1] }, FX.spring.bouncy); };
        FX.anim(old, { x: 560, y: -110, rotate: 14, opacity: 0 }, { duration: 0.3, ease: [0.5, 0, 0.9, 0.5] }).then(after, after);
      },
    });
    deck.append(card.el);
    M.animate(card.el, { opacity: 0, rotateX: -18, y: -70, x: -36, rotate: -3 }, { duration: 0 });
    FX.anim(card.el, { opacity: 1, rotateX: 0, y: 0, x: 0, rotate: 0 }, { ...FX.spring.deal, delay });
  };
  deal(FX.base());
}

// ---------------------------------------------------------------- results
function stampFor(percent) {
  return percent >= 100 ? 'Boss mode' : percent >= 85 ? 'Nailed it' : percent >= 65 ? 'Solid' : percent >= 45 ? 'Almost' : 'Keep going';
}

/** The results screen, also used by the exam simulation (title, sub, chips, labels and the "new" link are then its own). */
export function renderResults(root, ctx, results, { bestStreak, planned, again, retry, title = 'Quiz finished', sub, chips = [], againLabel = 'Same questions again', newLabel = 'New quiz', newHref, reviewExtra }) {
  destroyActiveCard();
  const { exam, topics } = ctx;
  const sum = results.reduce((s, r) => s + r.score, 0);
  const percent = pct(sum, results.length);
  const missed = results.filter((r) => r.score < 1);
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  const points = Number.isInteger(sum) ? sum : sum.toFixed(1);
  const mood = percent >= 65 ? 'happy' : percent >= 45 ? 'idle' : 'sad';

  const byTopic = new Map();
  for (const r of results) { const t = byTopic.get(r.q.topic) || { n: 0, s: 0 }; t.n += 1; t.s += r.score; byTopic.set(r.q.topic, t); }
  const segsFor = (p) => h('span', { class: 'segs', 'data-filled': Math.round(p / 10) }, Array.from({ length: 10 }, () => h('i')));

  const numEl = h('span', null, results.length ? percent : 0);
  const stampText = h('div', { class: 'stamp' }, results.length ? stampFor(percent) : 'No answers');
  const stampShadow = h('i', { class: 'stamp-shadow' });
  const stampWrap = h('div', { class: 'stamp-wrap' }, stampShadow, stampText);
  const mascot = FX.mascot(); mascot.dataset.mood = mood;
  const scoreFace = h('div', { class: 'score-card' },
    h('div', { class: 'score-row' }, h('div', { class: 'score-num' }, numEl, h('small', null, '%')), h('div', { class: 'stamp-spot' }, stampWrap)),
    h('div', { class: 'meta' },
      h('p', null, `${points} of ${results.length} points`),
      bestStreak >= 2 ? h('span', { class: 'chip' }, icon('flame', 14), `Best run ${bestStreak} in a row`) : null,
      h('span', { class: 'chip' }, `${missed.length} to review`),
      results.length < planned ? h('span', { class: 'chip' }, `${planned - results.length} unanswered`) : null,
      chips.map((c) => h('span', { class: 'chip' }, c))),
    h('div', { class: 'mascot-spot' }, mascot));
  const scoreObj = FX.obj(scoreFace, { cls: 'o-tile', tilt: 4, shine: true, fill: true, z: 12 });

  const topicFace = h('div', { class: 'card' }, h('h3', null, 'By topic'),
    byTopic.size ? [...byTopic].map(([id, t]) => h('div', { class: 'brow' },
      h('div', { class: 'nm' }, topicTitle(id), h('span', null, `${t.s % 1 ? t.s.toFixed(1) : t.s} of ${t.n} correct`)), segsFor(pct(t.s, t.n)), h('span', { class: 'pct' }, `${pct(t.s, t.n)}%`))) : h('p', null, 'Nothing answered yet.'));
  const topicObj = FX.obj(topicFace, { cls: 'o-tile', fill: true, hover: false });

  const retryBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('rotate-ccw', 20), `Retry wrong ones (${missed.length})`);
  retryBtn.addEventListener('click', (e) => retry(missed.map((r) => r.q), e));
  const againBtn = h('button', { class: `btn xl${missed.length ? '' : ' yellow'}`, type: 'button' }, againLabel);
  againBtn.addEventListener('click', (e) => again(e));
  const reviewRows = missed.map(({ q }, k) => h('details', { class: 'review', open: k === 0 }, h('summary', null, h('span', null, q.question), icon('chevron-down', 22)), h('div', { class: 'body' }, reviewExtra ? reviewExtra(q) : null, reviewBlocks(q, exam.documents))));
  const actions = h('div', { class: 'actions' },
    missed.length ? FX.obj(retryBtn, { cls: 'o-btn' }) : null,
    FX.obj(againBtn, { cls: 'o-btn' }),
    FX.obj(h('a', { class: 'btn xl', href: newHref || `#/exam/${exam.id}/quiz` }, newLabel), { cls: 'o-btn' }),
    h('a', { class: 'btn textlink', href: `#/exam/${exam.id}` }, 'Back to exam'));
  const reviewHead = h('h2', { class: 'section' }, missed.length ? `To review (${missed.length})` : 'Nothing to review');

  const page = h('div', null,
    h('h1', { class: 'pagetitle' }, title),
    h('p', { class: 'pagesub lab' }, sub ?? `${exam.shortTitle || exam.title} / ${results.length} answered`),
    h('section', { class: 'results-top' }, scoreObj, topicObj),
    reviewHead,
    missed.length ? h('div', { class: 'review-list' }, reviewRows) : h('p', { class: 'lead' }, 'You got everything right.'),
    actions);
  mount(root, page);
  window.scrollTo(0, 0);

  // 1. the tiles drop in, the number counts up, the bars fill block by block
  const base = FX.base();
  FX.enter([scoreObj, topicObj], { delay: base, stagger: 0.08, y: -50 });
  FX.count(numEl, results.length ? percent : 0, { duration: 1.05, delay: base + 0.15 });
  topicFace.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.35 + k * 0.12 }));
  FX.enter([reviewHead, ...root.querySelectorAll('.review-list > details, .actions > .obj, .actions > a')], { y: 22, delay: base + 0.7, stagger: 0.05, spring: FX.spring.soft });

  // 2. the stamp lands last: drops from above, thud, tiny shake, hard shadow snaps in
  M.animate(stampWrap, { opacity: 0 }, { duration: 0 });
  const land = () => {
    FX.sound('thud');
    FX.anim(stampWrap, { scale: [1, 0.9, 1.04, 1] }, { duration: 0.34, ease: 'easeOut' });
    FX.anim(stampShadow, { x: [0, 5], y: [0, 5] }, FX.spring.thud);
    FX.anim(page, { x: [0, -7, 6, -4, 2, 0], y: [0, 5, -3, 2, 0, 0] }, { duration: 0.34 });
    if (percent >= 65) { const r = stampWrap.getBoundingClientRect(); FX.confetti(r.left + 60, r.top + 20, { count: 8, big: percent >= 85 }); }
    mascot.mood(mood === 'sad' ? 'sad' : mood === 'happy' ? 'happy' : 'idle', 3000);
  };
  const drop = () => {
    if (!stampWrap.isConnected) return;
    M.animate(stampWrap, { opacity: 0, y: -440, scale: 2.6, rotate: -26 }, { duration: 0 });
    FX.anim(stampWrap, { opacity: [0, 1], y: [-440, 0], scale: [2.6, 1], rotate: [-26, -7] }, { duration: 0.34, ease: [0.55, 0, 0.9, 0.6] }).then(land, land);
  };
  if (FX.reduced()) { M.animate(stampWrap, { opacity: 1, rotate: -7 }, { duration: 0 }); M.animate(stampShadow, { x: 5, y: 5 }, { duration: 0 }); } else setTimeout(drop, (base + 1.25) * 1000);
}
