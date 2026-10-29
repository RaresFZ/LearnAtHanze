// The numbers behind the progress view and the weak-spots mode. Pure (no DOM), so Node can test it.
// Everything is derived from what is already saved for one exam (store.js shape): per-question totals, per-card schedule, sessions.
import { questionStat, weakTopicIds } from './store.js';
import { isNew } from './srs.js';

export const WEAK_MISSES = 2;        // a question or card "keeps getting missed" once it has been missed this many times...
export const RECOVERED_STREAK = 2;   // ...until the question is answered right this many times in a row
export const RECOVERED_DAYS = 7;     // ...or the card is scheduled at least this many days out again

const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };

/** Questions you keep missing: points lost (attempts minus score) >= minMisses and not yet right twice in a row. Worst first. */
export function weakQuestions(progress, questions, minMisses = WEAK_MISSES) {
  const out = [];
  for (const q of questions) {
    const e = progress.questions[q.id];
    if (!e || !e.n) continue;
    const misses = e.n - e.score;
    if (misses >= minMisses && (e.streak || 0) < RECOVERED_STREAK) out.push({ q, n: e.n, misses, accuracy: e.score / e.n, lastScore: e.lastScore, last: e.last });
  }
  return out.sort((a, b) => b.misses - a.misses || a.accuracy - b.accuracy || b.last - a.last);
}

/** Cards you keep missing: rated Again >= minMisses times (or lapsed that often) and not yet scheduled a week or more out. Worst first. */
export function weakCards(progress, cards, minMisses = WEAK_MISSES) {
  const out = [];
  for (const card of cards) {
    const s = progress.cards[card.id];
    if (isNew(s)) continue;
    const misses = Math.max(s.lapses || 0, s.misses || 0);
    if (misses >= minMisses && s.interval < RECOVERED_DAYS) out.push({ card, misses, interval: s.interval, ease: s.ease, last: s.last });
  }
  return out.sort((a, b) => b.misses - a.misses || a.ease - b.ease || b.last - a.last);
}

/** Per calendar day (local time) for one kind of session: [{ day, answered, score, pct }], the last `days` days that have any. */
export function dailySeries(progress, mode, days = 14) {
  const byDay = new Map();
  for (const s of progress.sessions) {
    if (s.mode !== mode || !s.answered) continue;
    const d = startOfDay(s.ts);
    const t = byDay.get(d) || { day: d, answered: 0, score: 0 };
    t.answered += s.answered; t.score += s.score;
    byDay.set(d, t);
  }
  return [...byDay.values()].sort((a, b) => a.day - b.day).slice(-days).map((t) => ({ ...t, pct: Math.round((t.score / t.answered) * 100) }));
}

/** Days in a row with any practice (quiz answers or card ratings), counting back from today. Yesterday still counts if today is empty. */
export function studyDays(progress, now = Date.now()) {
  const days = new Set();
  for (const s of progress.sessions) days.add(startOfDay(s.ts));
  for (const e of Object.values(progress.questions)) if (e.last) days.add(startOfDay(e.last));
  for (const e of Object.values(progress.cards)) if (e.last) days.add(startOfDay(e.last));
  const today = startOfDay(now);
  let d = days.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (days.has(d)) { current += 1; d = addDays(d, -1); }
  return { current, today: days.has(today), total: days.size };
}

/** One row per topic: quiz mastery and accuracy, card progress, and whether it is a weak topic (same rule as the exam page). */
export function topicRows(progress, questions, cards, topics) {
  const weak = new Set(weakTopicIds(progress, questions, topics));
  return topics.map((t) => {
    const qs = questions.filter((q) => q.topic === t.id);
    const cs = cards.filter((c) => c.topic === t.id);
    let n = 0, score = 0, seen = 0, mastered = 0;
    for (const q of qs) {
      const e = progress.questions[q.id];
      if (e && e.n) { n += e.n; score += e.score; seen += 1; }
      if (questionStat(progress, q.id).mastered) mastered += 1;
    }
    const learned = cs.filter((c) => (progress.cards[c.id]?.interval || 0) >= 1).length;
    return { id: t.id, title: t.title, qTotal: qs.length, qSeen: seen, qMastered: mastered, answers: n, accuracy: n ? score / n : null, cTotal: cs.length, cLearned: learned, weak: weak.has(t.id) };
  }).filter((r) => r.qTotal || r.cTotal);
}

/** Headline numbers; accuracy and "practised" use the same definitions as the exam page. */
export function overall(progress, questions) {
  const seen = questions.map((q) => questionStat(progress, q.id)).filter((s) => s.seen);
  return {
    practised: seen.length,
    total: questions.length,
    mastered: seen.filter((s) => s.mastered).length,
    accuracy: seen.length ? seen.reduce((s, x) => s + x.accuracy, 0) / seen.length : null,
    answers: seen.reduce((s, x) => s + x.n, 0),
    streak: progress.streak,
    bestStreak: progress.bestStreak,
  };
}
