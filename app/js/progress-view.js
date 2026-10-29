// Progress view for one exam: headline numbers, accuracy per day, mastery per topic, and what you keep missing.
// Numbers come from progress.js, which only reads what is already saved; nothing here is estimated.
import { h, mount, pct } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { buildCards } from './cards.js';
import { TYPE_LABEL, reviewBlocks } from './question.js';
import { loadProgress } from './store.js';
import { WEAK_MISSES, RECOVERED_STREAK, RECOVERED_DAYS, weakQuestions, weakCards, dailySeries, studyDays, topicRows, overall } from './progress.js';
import { pillBtn } from './quiz.js';
import { tile } from './flashcards.js';
import { GAMES } from './game-ui.js';

const SHOW = 10;                              // rows in each "keeps missing" list
const DAYS = 14;                              // days in the chart
const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtDayLong = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const segsFor = (p) => h('span', { class: 'segs', 'data-filled': Math.round(p / 10), 'aria-hidden': 'true' }, Array.from({ length: 10 }, () => h('i')));

const CHARTS = {
  quiz: { label: 'Quizzes', head: `Share of points you scored on each day you took a quiz (your last ${DAYS} such days, oldest first). A day adds up all of its quizzes.`, unit: 'points', empty: 'No quiz finished yet. Your accuracy per day shows up here after your first one.' },
  cards: { label: 'Flashcards', head: `Share of flashcard ratings that were Good or Easy on each day you reviewed cards (your last ${DAYS} such days, oldest first).`, unit: 'ratings Good or Easy', empty: 'No flashcard session yet. Your recall per day shows up here after your first one.' },
};

export function renderProgress(root, ctx) {
  const { exam, topics, questions } = ctx;
  const progress = loadProgress(exam.id);
  const cards = buildCards(questions, ctx.flashcards);
  const o = overall(progress, questions);
  const days = studyDays(progress);
  const qById = new Map(questions.map((q) => [q.id, q]));
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;

  // ---- headline tiles
  const tiles = [
    tile('cream', 'Practised', 'book-open-check', o.practised, `/ ${o.total}`),
    tile('yellow', 'Accuracy', 'target', o.accuracy === null ? '–' : Math.round(o.accuracy * 100), o.accuracy === null ? 'no answers yet' : '%', 1),
    tile('coral', 'Current streak', 'flame', o.streak, 'in a row'),
    tile('lilac', 'Study days', 'crosshair', days.current, days.current === 1 ? 'day in a row' : 'days in a row', -1),
  ];
  const stats = h('section', { class: 'stats', 'aria-label': 'Your progress' }, tiles);
  const streakNote = h('p', { class: 'fine', style: { marginTop: '14px' } },
    `Best streak: ${o.bestStreak} correct in a row. A streak counts correct answers and carries over between quizzes. A study day is any day with a quiz answer or a flashcard rating${days.current && !days.today ? '; you have not practised yet today' : ''}.`);

  // ---- accuracy over time
  let mode = 'quiz';
  const chartBody = h('div', { class: 'chartbody' });
  const chartHead = h('p', { class: 'fine' });
  const modeBtns = Object.entries(CHARTS).map(([key, c]) => pillBtn(c.label, key === mode, () => { mode = key; paintChart(); }));
  const chartFace = h('div', { class: 'card chartcard' }, chartHead, chartBody);
  const chartObj = FX.obj(chartFace, { cls: 'o-tile', fill: true, hover: false });

  function paintChart() {
    const c = CHARTS[mode];
    modeBtns.forEach((b, k) => b.querySelector('.pill-btn').setAttribute('aria-pressed', String(Object.keys(CHARTS)[k] === mode)));
    chartHead.textContent = c.head;
    const series = dailySeries(progress, mode, DAYS);
    if (!series.length) { chartBody.replaceChildren(h('p', { class: 'chart-empty' }, c.empty)); return; }

    const n = series.length;
    const readout = h('p', { class: 'readout', role: 'status' });
    const show = (d) => { readout.textContent = `${fmtDayLong(d.day)}: ${d.pct}% (${num(d.score)} of ${d.answered} ${c.unit})`; };
    const cols = series.map((d, i) => {
      const labelled = i === 0 || i === n - 1 || (i % 3 === 0 && n - 1 - i >= 2);
      const b = h('button', { class: 'col', type: 'button', style: { '--h': `${d.pct}%` }, 'aria-label': `${fmtDayLong(d.day)}: ${d.pct}%, ${num(d.score)} of ${d.answered} ${c.unit}` },
        h('span', { class: 'bar' }), h('span', { class: 'val' }, `${d.pct}%`), labelled ? h('span', { class: 'xl' }, fmtDay(d.day)) : null);
      if (i === n - 1) b.classList.add('last');
      b.addEventListener('pointerenter', () => show(d));
      b.addEventListener('focus', () => show(d));
      return b;
    });
    show(series[n - 1]);
    const plot = h('div', { class: 'plot' }, h('i', { class: 'gl g100' }), h('i', { class: 'gl g50' }), h('i', { class: 'gl g0' }), h('div', { class: 'cols', role: 'group', 'aria-label': `${c.label}, accuracy per day` }, cols));
    const axis = h('div', { class: 'yaxis', 'aria-hidden': 'true' }, h('span', null, '100%'), h('span', null, '50%'), h('span', null, '0%'));
    const table = h('details', { class: 'chart-table' }, h('summary', null, 'Show as a table'),
      h('table', null,
        h('thead', null, h('tr', null, ['Day', 'Answered', 'Scored', 'Accuracy'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, series.map((d) => h('tr', null, h('td', null, fmtDayLong(d.day)), h('td', null, String(d.answered)), h('td', null, num(d.score)), h('td', null, `${d.pct}%`))))));
    chartBody.replaceChildren(h('div', { class: 'chart' }, axis, plot), readout, table);
    cols.forEach((b, i) => { const bar = b.querySelector('.bar'); FX.anim(bar, { scaleY: [0, 1] }, { ...FX.spring.soft, delay: 0.04 * i }); });
  }
  const chartSection = h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Accuracy over time', h('div', { class: 'pills' }, modeBtns)), chartObj);

  // ---- practice exams (only once you have taken one)
  const exams = progress.sessions.filter((s) => s.mode === 'simulation' && s.total).slice(-8).reverse();
  const examRows = exams.map((s) => {
    const p = Math.round((s.score / s.total) * 100);
    const used = s.seconds < 60 ? `${s.seconds} s` : `${Math.round(s.seconds / 60)} min`;
    return h('div', { class: 'brow' },
      h('div', { class: 'nm' }, fmtDayLong(s.ts), h('span', null, `${num(s.score)} of ${s.total} points, ${used} of ${s.minutes} min${s.timedOut ? ', time ran out' : ''}`)),
      segsFor(p), h('span', { class: 'pct' }, `${p}%`));
  });
  const examsObj = exams.length ? FX.obj(h('div', { class: 'card' }, examRows), { cls: 'o-tile', fill: true, hover: false }) : null;
  const examsSection = exams.length ? h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Practice exams', h('span', { class: 'lab' }, `latest ${exams.length}`)), examsObj) : null;

  // ---- mini games (only the ones you have played)
  const played = Object.entries(progress.games || {}).filter(([id, g]) => GAMES[id] && g.plays);
  const gamesSection = played.length ? h('section', { class: 'field' }, h('h2', { class: 'small' }, 'Mini games'),
    FX.obj(h('div', { class: 'card' }, played.map(([id, g]) => h('div', { class: 'brow' },
      h('div', { class: 'nm' }, GAMES[id].title, h('span', null, `Played ${plural(g.plays, 'time', 'times')}, last score ${g.last}`)),
      h('span', { class: 'lab' }, 'Best'), h('span', { class: 'pct' }, String(g.best))))), { cls: 'o-tile', fill: true, hover: false })) : null;

  // ---- mastery per topic
  const rows = topicRows(progress, questions, cards, topics);
  const masteryRows = rows.map((r) => {
    const qp = r.qTotal ? pct(r.qMastered, r.qTotal) : 0;
    const cp = r.cTotal ? pct(r.cLearned, r.cTotal) : 0;
    const sub = r.qTotal ? `${r.qMastered} of ${r.qTotal} mastered${r.accuracy === null ? ', not practised yet' : `, ${Math.round(r.accuracy * 100)}% right over ${plural(r.answers, 'answer', 'answers')}`}` : 'no questions';
    return h('div', { class: 'mrow' },
      h('div', { class: 'nm' }, r.title, r.weak ? h('span', { class: 'warn-badge', title: 'Weak topic: 3+ answers and under 60% right' }, icon('triangle-alert', 13)) : null, h('span', null, sub)),
      r.qTotal ? h('div', { class: 'mcell', 'data-label': 'Questions', 'aria-label': `${qp}% of questions mastered` }, segsFor(qp), h('span', { class: 'pct' }, `${qp}%`)) : h('div', { class: 'mcell none', 'data-label': 'Questions' }, 'no questions'),
      r.cTotal ? h('div', { class: 'mcell', 'data-label': 'Cards', 'aria-label': `${cp}% of cards learned` }, segsFor(cp), h('span', { class: 'pct' }, `${cp}%`), h('span', { class: 'cnote' }, `${r.cLearned} of ${r.cTotal}`)) : h('div', { class: 'mcell none', 'data-label': 'Cards' }, 'no cards'));
  });
  const masteryFace = h('div', { class: 'card mastery' },
    h('div', { class: 'mrow head' }, h('span'), h('span', { class: 'lab' }, 'Questions mastered'), h('span', { class: 'lab' }, 'Cards learned')),
    masteryRows);
  const masteryObj = FX.obj(masteryFace, { cls: 'o-tile', fill: true, hover: false });
  const masterySection = h('section', { class: 'field' },
    h('h2', { class: 'small' }, 'Mastery by topic'),
    masteryObj,
    h('p', { class: 'fine', style: { marginTop: '12px' } }, 'Mastered: the last time you answered the question, you got it fully right. Learned: the card has been rated Good or Easy and is scheduled at least a day out.'));

  // ---- what you keep missing
  const missRow = (q, sub, chip) => h('details', { class: 'review' },
    h('summary', null, h('span', null, q.question, h('small', { class: 'sub' }, sub)), h('span', { class: 'chip miss' }, chip), icon('chevron-down', 22)),
    h('div', { class: 'body' }, reviewBlocks(q, exam.documents)));
  const list = (items, build, empty, more) => (items.length
    ? h('div', null, h('div', { class: 'review-list' }, items.slice(0, SHOW).map(build)), items.length > SHOW ? h('p', { class: 'fine', style: { marginTop: '12px' } }, `Showing the worst ${SHOW} of ${items.length}. ${more}`) : null)
    : h('p', { class: 'fine' }, empty));
  const wq = weakQuestions(progress, questions);
  const wc = weakCards(progress, cards);
  const qList = list(wq,
    (w) => missRow(w.q, `${topicTitle(w.q.topic)} / ${TYPE_LABEL[w.q.type]}`, `Missed ${num(w.misses)} of ${w.n}`),
    `No question has been missed ${WEAK_MISSES} times yet. One shows up here after that, and leaves once you answer it right ${RECOVERED_STREAK} times in a row.`,
    'The weak-spots quiz takes the weakest 20.');
  const cList = list(wc,
    (w) => missRow(qById.get(w.card.id) || { question: w.card.front, type: 'open', modelAnswer: w.card.back, src: w.card.src, explanation: w.card.explanation, flag: w.card.flag }, `${topicTitle(w.card.topic)} / Flashcard`, `Again ${w.misses}x`),
    `No card has been rated Again ${WEAK_MISSES} times yet. One shows up here after that, and leaves once it is scheduled ${RECOVERED_DAYS} or more days out.`,
    'The weak-spots review takes the weakest 20.');
  const missSection = h('section', { class: 'field' },
    h('h2', { class: 'small' }, 'Questions you keep missing', h('span', { class: 'lab' }, plural(wq.length, 'question', 'questions'))), qList,
    h('h2', { class: 'small', style: { marginTop: '32px' } }, 'Cards you keep missing', h('span', { class: 'lab' }, plural(wc.length, 'card', 'cards'))), cList);

  const weakBtn = h('a', { class: `btn xl${wq.length || wc.length ? ' yellow' : ''}`, href: `#/exam/${exam.id}/weak` }, icon('crosshair', 22), 'Practise weak spots');
  const actions = h('div', { class: 'actions', style: { marginTop: '36px' } }, FX.obj(weakBtn, { cls: 'o-btn' }), h('a', { class: 'btn textlink', href: `#/exam/${exam.id}` }, 'Back to exam'));

  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Progress'),
    h('p', { class: 'lead' }, 'Saved in this browser, for this exam only. Quiz answers and flashcard ratings are tracked separately.'),
    stats, streakNote, chartSection, examsSection, gamesSection, masterySection, missSection, actions);
  paintChart();

  const base = FX.base();
  FX.enter(tiles, { delay: base, stagger: 0.06 });
  stats.querySelectorAll('.cnt').forEach((c, k) => { const to = +c.dataset.to; if (Number.isFinite(to)) FX.count(c, to, { duration: 0.9, delay: base + 0.15 + k * 0.06 }); });
  FX.enter([chartObj, examsObj, masteryObj].filter(Boolean), { y: 30, delay: base + 0.35, stagger: 0.08, spring: FX.spring.soft });
  examsObj?.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.6 + k * 0.04 }));
  masteryFace.querySelectorAll('.segs').forEach((s, k) => FX.fillSegs(s, { delay: base + 0.7 + k * 0.025 }));
}
