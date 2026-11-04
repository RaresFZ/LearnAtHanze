// Learn mode rules (pure, no DOM): which topics are on the path, how far along each one is, which questions the
// "test yourself" step asks, what comes next and how long is left. The screens are in learn.js.
import { questionStat } from './store.js';

export const CHECK_SIZE = 8;          // questions asked after each lesson
export const CHECK_MINUTES = 8;       // time we count for answering them
export const DONE_AT = 0.8;           // a topic is done when its lesson was read and this share of its questions was last answered right
const AUTO = new Set(['mc', 'tf', 'fill']);          // graded by the app, so they make a quick check; open questions are self-graded

/** The topics that have a lesson, in the path order given by lessons.json (anything not listed follows in topic order). */
export function pathTopics(topics, lessons) {
  const have = (id) => !!lessons?.topics?.[id];
  const ordered = (lessons?.order || []).map((id) => topics.find((t) => t.id === id)).filter(Boolean).filter((t) => have(t.id));
  const rest = topics.filter((t) => have(t.id) && !ordered.includes(t));
  return [...ordered, ...rest];
}

/** The questions that decide whether a topic is mastered: the auto-graded ones (or all, if the topic has none). */
export function masteryPool(questions, topicId) {
  const all = questions.filter((q) => q.topic === topicId);
  const auto = all.filter((q) => AUTO.has(q.type));
  return auto.length ? auto : all;
}

/** { read, total, mastered, share, state } with state 'todo' (nothing yet), 'started' or 'done'. */
export function topicStatus(progress, questions, topicId) {
  const pool = masteryPool(questions, topicId);
  const stats = pool.map((q) => questionStat(progress, q.id));
  const mastered = stats.filter((s) => s.mastered).length;
  const share = pool.length ? mastered / pool.length : 0;
  const read = !!progress.learn?.[topicId]?.read;
  const touched = read || stats.some((s) => s.seen);
  const state = read && share >= DONE_AT ? 'done' : touched ? 'started' : 'todo';
  return { read, total: pool.length, mastered, share, state };
}

/**
 * The questions for the "test yourself" step: the ones not yet answered right come first, then the rest, auto-graded
 * types before open ones. `shuffle` is passed in so tests can be deterministic.
 */
export function pickCheck(questions, topicId, progress, n = CHECK_SIZE, shuffle = (a) => a) {
  const all = questions.filter((q) => q.topic === topicId);
  const rank = (q) => {
    const s = questionStat(progress, q.id);
    return (AUTO.has(q.type) ? 0 : 2) + (s.mastered ? 1 : 0);        // 0 = auto and not mastered ... 3 = open and mastered
  };
  const groups = [[], [], [], []];
  for (const q of shuffle(all.slice())) groups[rank(q)].push(q);
  return shuffle(groups.flat().slice(0, n));
}

/** The next topic to work on: the first not-done topic after `afterId`, else the first not-done one anywhere, else null. */
export function nextTopic(path, statusOf, afterId = null) {
  const open = (t) => statusOf(t.id).state !== 'done';
  const i = afterId ? path.findIndex((t) => t.id === afterId) : -1;
  return path.slice(i + 1).find(open) || path.find((t) => t.id !== afterId && open(t)) || null;
}

/** Minutes for one topic (reading + answering) and the minutes left over all topics that are not done. */
export const topicMinutes = (lessons, id) => (lessons.topics[id]?.minutes || 0) + CHECK_MINUTES;
export function minutesLeft(path, lessons, statusOf) {
  return path.filter((t) => statusOf(t.id).state !== 'done').reduce((s, t) => s + topicMinutes(lessons, t.id), 0);
}

/** "2 h 15 min" / "45 min" */
export function hm(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

// ---------------------------------------------------------------- the exam countdown
export const SLEEP_HOURS = 8;        // assumed per night
export const FOCUS_SHARE = 0.75;     // the rest of the waking time goes to meals, breaks and the way there

const startOfDay = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

/**
 * What the time until the exam allows: nights in between (each costs SLEEP_HOURS), the focused study time that is left, and whether
 * that covers the minutes the path still needs. Returns null without an exam date, { over: true } when the exam time has passed.
 */
export function studyWindow(now, examAt, minutesNeeded) {
  if (!Number.isFinite(examAt)) return null;
  const msLeft = examAt - now;
  if (msLeft <= 0) return { over: true };
  const hoursLeft = msLeft / 3600000;
  const nights = Math.round((startOfDay(examAt) - startOfDay(now)) / 86400000);        // midnights between now and the exam
  const focusMinutes = Math.max(0, Math.round((hoursLeft - nights * SLEEP_HOURS) * FOCUS_SHARE * 60));
  const ratio = minutesNeeded > 0 ? focusMinutes / minutesNeeded : Infinity;
  const verdict = minutesNeeded <= 0 ? 'done' : ratio >= 1.5 ? 'comfortable' : ratio >= 1 ? 'enough' : ratio >= 0.6 ? 'tight' : 'short';
  return { over: false, msLeft, hoursLeft, nights, focusMinutes, minutesNeeded, ratio, verdict };
}

/** "1 d 4 h", "5 h 20 min", "40 min" */
export function formatLeft(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

/** When time is short: the topics that are not done, those with an "often missed in class" part first (the path order otherwise). */
export function prioritize(path, lessons, statusOf) {
  const open = path.filter((t) => statusOf(t.id).state !== 'done');
  return [...open.filter((t) => isOften(lessons, t.id)), ...open.filter((t) => !isOften(lessons, t.id))];
}

/** Does any chunk of a topic carry the "often missed in class" mark? */
export const isOften = (lessons, id) => !!lessons.topics[id]?.chunks?.some((c) => c.often);
