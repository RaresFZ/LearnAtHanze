// Exam simulation, the parts that need no DOM: the setup, picking questions, the saved attempt, grading and scoring.
// An attempt: { v, exam, ids, orders, answers, flags, minutes, startedAt, endAt, submittedAt, timedOut, grades }
//   answers[id]: mc -> index of the option as shown, tf -> 0 (True) or 1 (False), fill and open -> the typed text
//   orders[id]:  mc only, the shuffled option order shown (a saved attempt must look the same after a reload)
//   grades[id]:  your own grade for an open answer (0, 0.5, 1), or 1 when you say a fill-in answer was right
import { gradeFill } from './grade.js';

/** The numbers and wording are the learner's to set in exam.json ("simulation"); nothing here is the real exam format. */
export const DEFAULTS = { questions: 30, minutes: 45, types: ['mc', 'tf', 'fill', 'open'], official: false, passMark: null, note: '' };
export const simConfig = (exam) => ({ ...DEFAULTS, ...(exam?.simulation || {}) });
export const simPool = (questions, cfg) => questions.filter((q) => cfg.types.includes(q.type));

const shuffled = (arr, rnd = Math.random) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** `count` questions spread evenly over the topics (one from each topic in turn), then mixed. */
export function pickExam(pool, count, rnd = Math.random) {
  const groups = new Map();
  for (const q of pool) { if (!groups.has(q.topic)) groups.set(q.topic, []); groups.get(q.topic).push(q); }
  const lists = shuffled([...groups.values()].map((g) => shuffled(g, rnd)), rnd);
  const out = [];
  while (out.length < count && lists.some((l) => l.length)) for (const l of lists) { if (out.length >= count) break; if (l.length) out.push(l.pop()); }
  return shuffled(out, rnd);
}

export function newAttempt(examId, picks, minutes, now = Date.now(), rnd = Math.random) {
  const orders = {};
  for (const q of picks) if (q.type === 'mc') { const idx = q.options.map((_, i) => i); orders[q.id] = q.fixedOrder ? idx : shuffled(idx, rnd); }
  return { v: 1, exam: examId, ids: picks.map((q) => q.id), orders, answers: {}, flags: [], minutes, startedAt: now, endAt: now + minutes * 60000, submittedAt: 0, timedOut: false, grades: {} };
}

export const isAnswered = (a) => a !== undefined && a !== null && (typeof a === 'string' ? a.trim() !== '' : true);
export const timeLeft = (at, now = Date.now()) => Math.max(0, at.endAt - now);
export const secondsUsed = (at) => Math.round((Math.min(at.submittedAt || at.endAt, at.endAt) - at.startedAt) / 1000);

/** "44:12", or "1:30:00" from an hour up. */
export function clock(ms) {
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

/** Score of one answer without any help from you: 1 or 0. Open answers have no automatic score (null), unanswered ones score 0. */
export function autoScore(q, answer, order) {
  if (!isAnswered(answer)) return 0;
  if (q.type === 'mc') return order[answer] === q.answer ? 1 : 0;
  if (q.type === 'tf') return (answer === 0) === q.answer ? 1 : 0;
  if (q.type === 'fill') return gradeFill(q, answer) ? 1 : 0;
  return null;
}

/** What still needs your word after submitting: every answered open question (required), and fill-ins marked wrong (optional). */
export function pendingGrades(at, byId) {
  const out = [];
  for (const id of at.ids) {
    const q = byId.get(id), a = at.answers[id];
    if (!isAnswered(a)) continue;
    if (q.type === 'open') out.push({ id, kind: 'open', required: true });
    else if (q.type === 'fill' && autoScore(q, a, null) === 0) out.push({ id, kind: 'fill', required: false });
  }
  return out;
}

/** Final per-question scores in exam order, and the totals. */
export function finalScores(at, byId) {
  const items = at.ids.map((id) => {
    const q = byId.get(id), a = at.answers[id];
    const answered = isAnswered(a);
    const auto = autoScore(q, a, at.orders[id]);
    const score = at.grades[id] !== undefined ? at.grades[id] : auto ?? 0;
    return { id, q, answered, score };
  });
  const points = items.reduce((s, x) => s + x.score, 0);
  const answered = items.filter((x) => x.answered).length;
  return { items, points, total: items.length, answered, unanswered: items.length - answered, pct: items.length ? Math.round((points / items.length) * 100) : 0 };
}

/** null when no pass mark is set (it is not stated in the course files), otherwise whether the percentage reaches it. */
export const passed = (pct, passMark) => (Number.isFinite(passMark) ? pct >= passMark : null);
