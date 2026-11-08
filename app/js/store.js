// Progress lives in the browser (localStorage), kept strictly separate per exam.
// Your own device's part is what the record* functions change. If you use the app on a second device (the phone), the parts of the
// other devices are kept here too (peers, see sync.js) and loadProgress returns all of them combined (merge.js): counters add up,
// the latest change wins. So a device never overwrites another one's progress.
// Shape per exam: { v: 1, exam, questions: { [id]: { n, score, last, lastScore, streak } },
//                   cards: { [id]: { due, interval, ease, reps, lapses, misses, first, last } },   (flashcards, see srs.js)
//                   games: { [game]: { plays, best, last, lastTs } },   (mini games, see games-data.js)
//                   learn: { [topicId]: { read } },   (Learn mode: when the lesson was read to the end, see learn-data.js)
//                   calc: { [generatorId]: { n, right, last } },   (calculation trainer, see calc-data.js)
//                   confuse: { [groupId]: { n, right, last } },   ("easily confused" drills, see confuse-data.js)
//                   plan: { examAt },   (the exam date, in ms, for the countdown)
//                   study: { [YYYY-MM-DD]: minutes },   (time spent with the study timer)
//   questions[id] also counts guesses (marked "I'm guessing") and sureWrong (wrong without that mark).
//                   sessions: [...], bestStreak, streak }
// "streak" is the carried-over run of correct answers, kept between quizzes. Older saves do not have it:
// every field is defaulted on load, so no migration is needed and nothing breaks.
import { combineProgress } from './merge.js';
const key = (examId) => `learnathanze:v1:${examId}`;
const peersKey = (examId) => `learnathanze:peers:${examId}`;       // { [deviceId]: that device's part }, copied from the computer by sync.js
const metaKey = (examId) => `learnathanze:syncmeta:${examId}`;      // { resetAt, pushedTs, pushedReset, last }
/** Tells sync.js that something changed (nothing listens in the tests). */
const changed = (examId) => { try { globalThis.dispatchEvent?.(new CustomEvent('lah:progress', { detail: { examId } })); } catch { /* no window */ } };

const empty = (examId) => ({ v: 1, exam: examId, questions: {}, cards: {}, games: {}, learn: {}, calc: {}, confuse: {}, plan: {}, study: {}, sessions: [], bestStreak: 0, streak: 0 });

/** Fills in anything an older save is missing. */
function normalize(examId, data) {
  const base = empty(examId);
  return {
    ...base, ...data,
    v: 1, exam: examId,
    questions: data.questions && typeof data.questions === 'object' ? data.questions : {},
    cards: data.cards && typeof data.cards === 'object' && !Array.isArray(data.cards) ? data.cards : {},
    games: data.games && typeof data.games === 'object' && !Array.isArray(data.games) ? data.games : {},
    learn: data.learn && typeof data.learn === 'object' && !Array.isArray(data.learn) ? data.learn : {},
    calc: data.calc && typeof data.calc === 'object' && !Array.isArray(data.calc) ? data.calc : {},
    confuse: data.confuse && typeof data.confuse === 'object' && !Array.isArray(data.confuse) ? data.confuse : {},
    plan: data.plan && typeof data.plan === 'object' && !Array.isArray(data.plan) ? data.plan : {},
    study: data.study && typeof data.study === 'object' && !Array.isArray(data.study) ? data.study : {},
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    bestStreak: Number.isFinite(data.bestStreak) ? data.bestStreak : 0,
    streak: Number.isFinite(data.streak) ? data.streak : 0,
  };
}

/** This device's own part of the progress (what the record* functions change). */
export function loadOwn(examId) {
  try {
    const raw = localStorage.getItem(key(examId));
    if (!raw) return empty(examId);
    const data = JSON.parse(raw);
    if (data.v !== 1 || data.exam !== examId) return empty(examId);
    return normalize(examId, data);
  } catch {
    return empty(examId);
  }
}

/** The progress of the exam as you see it: this device's part combined with the parts of your other devices. */
export function loadProgress(examId) {
  const own = loadOwn(examId);
  const peers = Object.values(loadPeers(examId));
  return peers.length ? combineProgress(examId, [own, ...peers.map((p) => normalize(examId, p))]) : own;
}

/** Saves this device's own part and stamps the time (the combination uses it to know which device changed last). */
export function saveProgress(examId, data) {
  try {
    data.ts = Date.now();
    localStorage.setItem(key(examId), JSON.stringify(data));
    changed(examId);
    return true;
  } catch {
    return false;
  }
}

/** Record one answered question. score is 0..1 (open questions allow 0.5). Only a full score extends the streak. opts.guess: the learner marked it "I'm guessing". */
export function recordAnswer(examId, qid, score, opts = {}) {
  const carried = loadProgress(examId).streak;       // the run continues from whichever device was used last
  const p = loadOwn(examId);
  const q = p.questions[qid] || { n: 0, score: 0, last: 0, lastScore: 0, streak: 0 };
  if (opts.guess) q.guesses = (q.guesses || 0) + 1;
  else if (score < 1) q.sureWrong = (q.sureWrong || 0) + 1;      // wrong although it was not marked as a guess
  q.n += 1;
  q.score += score;
  q.last = Date.now();
  q.lastScore = score;
  q.streak = score >= 1 ? q.streak + 1 : 0;
  p.questions[qid] = q;
  p.streak = score >= 1 ? carried + 1 : 0;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  saveProgress(examId, p);
  return p.streak;
}

/** Save one flashcard's new schedule (see srs.js rate). */
export function recordCard(examId, cardId, state) {
  const p = loadOwn(examId);
  p.cards[cardId] = state;
  saveProgress(examId, p);
}

/** Learn mode: remember that a topic's lesson was read to the end. */
export function recordLessonRead(examId, topicId) {
  const p = loadOwn(examId);
  p.learn[topicId] = { read: Date.now() };
  saveProgress(examId, p);
}

/** Draw it: remember that a drawing exercise was finished (kept in the learn map under "ex:<id>"). */
export function recordExerciseDone(examId, exId) {
  const p = loadOwn(examId);
  p.learn[`ex:${exId}`] = { done: Date.now() };
  saveProgress(examId, p);
}

/** Calculation trainer: one answered calculation of a generator. */
export function recordCalc(examId, genId, correct) {
  const p = loadOwn(examId);
  const c = p.calc[genId] || { n: 0, right: 0, last: 0 };
  c.n += 1; if (correct) c.right += 1; c.last = Date.now();
  p.calc[genId] = c;
  saveProgress(examId, p);
}
/** "Easily confused" drill: one answered clue of a group. */
export function recordConfuse(examId, groupId, correct) {
  const p = loadOwn(examId);
  const c = p.confuse[groupId] || { n: 0, right: 0, last: 0 };
  c.n += 1; if (correct) c.right += 1; c.last = Date.now();
  p.confuse[groupId] = c;
  saveProgress(examId, p);
}
/** The exam date for the countdown (ms since 1970), or null to remove it. */
export function setExamAt(examId, ms) {
  const p = loadOwn(examId);
  if (ms == null) delete p.plan.examAt; else p.plan.examAt = ms;
  p.plan.upd = Date.now();
  saveProgress(examId, p);
}
export const dayKey = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Study timer: add minutes to today. */
export function recordStudy(examId, minutes) {
  if (!(minutes > 0)) return;
  const p = loadOwn(examId);
  const k = dayKey();
  p.study[k] = Math.round(((p.study[k] || 0) + minutes) * 10) / 10;
  saveProgress(examId, p);
}

export function recordSession(examId, session) {
  const p = loadOwn(examId);
  p.sessions.push({ ts: Date.now(), ...session });
  p.sessions = p.sessions.slice(-200);
  p.bestStreak = Math.max(p.bestStreak, session.bestStreak || 0);
  saveProgress(examId, p);
}

/** Reset: this device's part and the copies of the other devices go; the other devices follow at their next sync. */
export function resetProgress(examId) {
  try { localStorage.removeItem(key(examId)); localStorage.removeItem(peersKey(examId)); localStorage.removeItem(simKey(examId)); } catch { /* ignore */ }
  saveSyncMeta(examId, { ...syncMeta(examId), resetAt: Date.now() });
  changed(examId);
}

// ---- exam simulation: the attempt in progress lives apart from the progress object (it is not part of Export/Import)
const simKey = (examId) => `learnathanze:sim:${examId}`;
export function loadSim(examId) {
  try {
    const d = JSON.parse(localStorage.getItem(simKey(examId)));
    return d && d.v === 1 && d.exam === examId && Array.isArray(d.ids) && d.answers && d.orders ? d : null;
  } catch { return null; }
}
export function saveSim(examId, attempt) { try { localStorage.setItem(simKey(examId), JSON.stringify(attempt)); } catch { /* ignore */ } }
export function clearSim(examId) { try { localStorage.removeItem(simKey(examId)); } catch { /* ignore */ } }

/**
 * Record a finished mini game: the game's own tally (plays, best and last score), one session, and, for the games that
 * ask real questions, each answered question's totals (so weak spots learn from them; the carried-over streak is left alone).
 * result: { score, answered, seconds }. items: [{ id, score }]. Returns { isBest, best, plays }.
 */
export function recordGame(examId, game, result, items = []) {
  const p = loadOwn(examId);
  const now = Date.now();
  const g = p.games[game] || { plays: 0, best: 0, last: 0 };
  const isBest = g.plays > 0 && result.score > g.best;
  g.plays += 1; g.best = Math.max(g.best, result.score); g.last = result.score; g.lastTs = now;
  p.games[game] = g;
  for (const it of items) {
    const q = p.questions[it.id] || { n: 0, score: 0, last: 0, lastScore: 0, streak: 0 };
    q.n += 1; q.score += it.score; q.last = now; q.lastScore = it.score;
    q.streak = it.score >= 1 ? q.streak + 1 : 0;
    p.questions[it.id] = q;
  }
  p.sessions.push({ ts: now, mode: 'game', label: game, game, answered: result.answered, score: result.score, seconds: result.seconds, bestStreak: 0 });
  p.sessions = p.sessions.slice(-200);
  saveProgress(examId, p);
  return { isBest, best: g.best, plays: g.plays };
}

/**
 * Record a finished exam in one write: each answered question's totals (so weak spots and accuracy learn from it, but the
 * carried-over streak is left alone) and one session. items: [{ id, score, answered }].
 */
export function recordExam(examId, items, session) {
  const p = loadOwn(examId);
  const now = Date.now();
  for (const it of items) {
    if (!it.answered) continue;
    const q = p.questions[it.id] || { n: 0, score: 0, last: 0, lastScore: 0, streak: 0 };
    q.n += 1; q.score += it.score; q.last = now; q.lastScore = it.score;
    q.streak = it.score >= 1 ? q.streak + 1 : 0;
    p.questions[it.id] = q;
  }
  p.sessions.push({ ts: now, ...session });
  p.sessions = p.sessions.slice(-200);
  saveProgress(examId, p);
}

/** The backup holds the progress of all your devices together. */
export function exportProgress(examId) {
  return JSON.stringify(loadProgress(examId), null, 2);
}

/** Import a backup. Refuses a file that belongs to a different exam so the two never get mixed. */
export function importProgress(examId, text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (data?.v !== 1 || typeof data.questions !== 'object' || data.questions === null) throw new Error('That is not a LearnAtHanze progress file.');
  if (data.exam !== examId) throw new Error(`That backup belongs to "${data.exam}", not "${examId}". Import it on the matching exam.`);
  // a backup replaces everything: the parts of the other devices would count the same answers a second time
  try { localStorage.removeItem(peersKey(examId)); } catch { /* ignore */ }
  saveSyncMeta(examId, { ...syncMeta(examId), resetAt: Date.now() });
  if (!saveProgress(examId, normalize(examId, data))) throw new Error('Could not save to browser storage.');
}

// ---- what sync.js needs: the parts of the other devices and the bookkeeping of the last sync
export function loadPeers(examId) {
  try {
    const d = JSON.parse(localStorage.getItem(peersKey(examId)));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}
export function savePeers(examId, peers) {
  try { if (Object.keys(peers).length) localStorage.setItem(peersKey(examId), JSON.stringify(peers)); else localStorage.removeItem(peersKey(examId)); } catch { /* ignore */ }
}
export function syncMeta(examId) {
  try {
    const m = JSON.parse(localStorage.getItem(metaKey(examId)));
    return { resetAt: 0, pushedTs: 0, pushedReset: 0, last: 0, ...(m && typeof m === 'object' ? m : {}) };
  } catch { return { resetAt: 0, pushedTs: 0, pushedReset: 0, last: 0 }; }
}
export function saveSyncMeta(examId, meta) { try { localStorage.setItem(metaKey(examId), JSON.stringify(meta)); } catch { /* ignore */ } }
/** Put a part in place without stamping a new save time and without announcing a change (used by sync.js). */
export function replaceOwn(examId, data) {
  try { if (data) localStorage.setItem(key(examId), JSON.stringify(data)); else localStorage.removeItem(key(examId)); } catch { /* ignore */ }
}

/** Per-question stats used by pickers and dashboards. */
export function questionStat(progress, qid) {
  const q = progress.questions[qid];
  if (!q || !q.n) return { seen: false, n: 0, accuracy: 0, lastScore: null, mastered: false, guesses: 0, sureWrong: 0 };
  return { seen: true, n: q.n, accuracy: q.score / q.n, lastScore: q.lastScore, mastered: q.lastScore >= 1, guesses: q.guesses || 0, sureWrong: q.sureWrong || 0 };
}

/** Topics where you have answered at least 3 times and got under 60% right. */
export function weakTopicIds(progress, questions, topics) {
  return topics.filter((t) => {
    let n = 0, score = 0;
    for (const q of questions) if (q.topic === t.id) { const x = progress.questions[q.id]; if (x) { n += x.n; score += x.score; } }
    return n >= 3 && score / n < 0.6;
  }).map((t) => t.id);
}
