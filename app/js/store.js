// Progress lives in the browser (localStorage), kept strictly separate per exam.
// Shape per exam: { v: 1, exam, questions: { [id]: { n, score, last, lastScore, streak } },
//                   cards: { [id]: { due, interval, ease, reps, lapses, misses, first, last } },   (flashcards, see srs.js)
//                   games: { [game]: { plays, best, last, lastTs } },   (mini games, see games-data.js)
//                   sessions: [...], bestStreak, streak }
// "streak" is the carried-over run of correct answers, kept between quizzes. Older saves do not have it:
// every field is defaulted on load, so no migration is needed and nothing breaks.
const key = (examId) => `learnathanze:v1:${examId}`;

const empty = (examId) => ({ v: 1, exam: examId, questions: {}, cards: {}, games: {}, sessions: [], bestStreak: 0, streak: 0 });

/** Fills in anything an older save is missing. */
function normalize(examId, data) {
  const base = empty(examId);
  return {
    ...base, ...data,
    v: 1, exam: examId,
    questions: data.questions && typeof data.questions === 'object' ? data.questions : {},
    cards: data.cards && typeof data.cards === 'object' && !Array.isArray(data.cards) ? data.cards : {},
    games: data.games && typeof data.games === 'object' && !Array.isArray(data.games) ? data.games : {},
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    bestStreak: Number.isFinite(data.bestStreak) ? data.bestStreak : 0,
    streak: Number.isFinite(data.streak) ? data.streak : 0,
  };
}

export function loadProgress(examId) {
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

export function saveProgress(examId, data) {
  try {
    localStorage.setItem(key(examId), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Record one answered question. score is 0..1 (open questions allow 0.5). Only a full score extends the streak. */
export function recordAnswer(examId, qid, score) {
  const p = loadProgress(examId);
  const q = p.questions[qid] || { n: 0, score: 0, last: 0, lastScore: 0, streak: 0 };
  q.n += 1;
  q.score += score;
  q.last = Date.now();
  q.lastScore = score;
  q.streak = score >= 1 ? q.streak + 1 : 0;
  p.questions[qid] = q;
  p.streak = score >= 1 ? p.streak + 1 : 0;
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  saveProgress(examId, p);
  return p.streak;
}

/** Save one flashcard's new schedule (see srs.js rate). */
export function recordCard(examId, cardId, state) {
  const p = loadProgress(examId);
  p.cards[cardId] = state;
  saveProgress(examId, p);
}

export function recordSession(examId, session) {
  const p = loadProgress(examId);
  p.sessions.push({ ts: Date.now(), ...session });
  p.sessions = p.sessions.slice(-200);
  p.bestStreak = Math.max(p.bestStreak, session.bestStreak || 0);
  saveProgress(examId, p);
}

export function resetProgress(examId) {
  try { localStorage.removeItem(key(examId)); localStorage.removeItem(simKey(examId)); } catch { /* ignore */ }
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
  const p = loadProgress(examId);
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
  const p = loadProgress(examId);
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

export function exportProgress(examId) {
  return JSON.stringify(loadProgress(examId), null, 2);
}

/** Import a backup. Refuses a file that belongs to a different exam so the two never get mixed. */
export function importProgress(examId, text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (data?.v !== 1 || typeof data.questions !== 'object' || data.questions === null) throw new Error('That is not a LearnAtHanze progress file.');
  if (data.exam !== examId) throw new Error(`That backup belongs to "${data.exam}", not "${examId}". Import it on the matching exam.`);
  if (!saveProgress(examId, normalize(examId, data))) throw new Error('Could not save to browser storage.');
}

/** Per-question stats used by pickers and dashboards. */
export function questionStat(progress, qid) {
  const q = progress.questions[qid];
  if (!q || !q.n) return { seen: false, n: 0, accuracy: 0, lastScore: null, mastered: false };
  return { seen: true, n: q.n, accuracy: q.score / q.n, lastScore: q.lastScore, mastered: q.lastScore >= 1 };
}

/** Topics where you have answered at least 3 times and got under 60% right. */
export function weakTopicIds(progress, questions, topics) {
  return topics.filter((t) => {
    let n = 0, score = 0;
    for (const q of questions) if (q.topic === t.id) { const x = progress.questions[q.id]; if (x) { n += x.n; score += x.score; } }
    return n >= 3 && score / n < 0.6;
  }).map((t) => t.id);
}
