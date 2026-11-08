// Several devices (the computer, the phone) each keep their OWN progress of an exam, and what you see is the combination of all of them.
// Because a device only ever changes its own part, nothing is counted twice and two devices can never overwrite each other.
// This file is pure (no browser, no network): how the parts are combined. See store.js (where it is used) and sync.js (how the parts travel).
//
//   counters (answers given, score, guesses, plays, minutes studied per day ...)  add up over the devices
//   "latest wins" fields (last answer, a flashcard's schedule, the exam date ...)  come from the device that changed them last
//   lists (sessions)                                                               are joined, sorted by time, the newest 200 kept
//   bests (best streak, best game score)                                           the highest

const num = (v) => (Number.isFinite(v) ? v : 0);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

/** The part of `parts` that changed last (ties: the first one), judged by its own save time. */
const newest = (parts, stamp) => parts.reduce((best, p) => (stamp(p) > stamp(best) ? p : best), parts[0]);

/** A part's save time. Older saves have none: the time of its latest answer stands in for it. */
export function partTime(p) {
  if (Number.isFinite(p?.ts)) return p.ts;
  let t = 0;
  for (const q of Object.values(obj(p?.questions))) t = Math.max(t, num(q.last));
  return t;
}

function mergeQuestions(parts) {
  const out = {};
  const ids = new Set(parts.flatMap((p) => Object.keys(obj(p.questions))));
  for (const id of ids) {
    const have = parts.map((p) => obj(p.questions)[id]).filter(Boolean);
    const latest = have.reduce((b, q) => (num(q.last) > num(b.last) ? q : b), have[0]);
    const m = { n: 0, score: 0, last: 0, lastScore: latest.lastScore ?? 0, streak: num(latest.streak) };
    let guesses = 0, sureWrong = 0;
    for (const q of have) { m.n += num(q.n); m.score += num(q.score); m.last = Math.max(m.last, num(q.last)); guesses += num(q.guesses); sureWrong += num(q.sureWrong); }
    if (have.some((q) => q.guesses !== undefined)) m.guesses = guesses;
    if (have.some((q) => q.sureWrong !== undefined)) m.sureWrong = sureWrong;
    out[id] = m;
  }
  return out;
}

function mergeCards(parts) {
  const out = {};
  for (const p of parts) for (const [id, c] of Object.entries(obj(p.cards))) {
    const cur = out[id];
    if (!cur || num(c.last) > num(cur.last) || (num(c.last) === num(cur.last) && num(c.reps) > num(cur.reps))) out[id] = c;
  }
  return out;
}

function mergeGames(parts) {
  const out = {};
  for (const p of parts) for (const [id, g] of Object.entries(obj(p.games))) {
    const cur = out[id];
    if (!cur) { out[id] = { ...g }; continue; }
    const later = num(g.lastTs) > num(cur.lastTs);
    out[id] = { plays: num(cur.plays) + num(g.plays), best: Math.max(num(cur.best), num(g.best)), last: later ? g.last : cur.last, lastTs: Math.max(num(cur.lastTs), num(g.lastTs)) };
  }
  return out;
}

function mergeLearn(parts) {
  const out = {};
  for (const p of parts) for (const [id, v] of Object.entries(obj(p.learn))) {
    const cur = out[id] || {};
    const m = { ...cur };
    for (const f of ['read', 'done']) if (v[f] !== undefined) m[f] = Math.max(num(cur[f]), num(v[f]));
    out[id] = m;
  }
  return out;
}

function mergeTally(parts, field) {        // { n, right, last } per id (calculation trainer, drills)
  const out = {};
  for (const p of parts) for (const [id, c] of Object.entries(obj(p[field]))) {
    const cur = out[id] || { n: 0, right: 0, last: 0 };
    out[id] = { n: cur.n + num(c.n), right: cur.right + num(c.right), last: Math.max(cur.last, num(c.last)) };
  }
  return out;
}

function mergePlan(parts) {
  const withDate = parts.filter((p) => Number.isFinite(obj(p.plan).upd) || obj(p.plan).examAt !== undefined);
  if (!withDate.length) return {};
  const best = withDate.reduce((b, p) => (num(obj(p.plan).upd) > num(obj(b.plan).upd) ? p : b), withDate[0]);
  return { ...obj(best.plan) };
}

function mergeStudy(parts) {
  const out = {};
  for (const p of parts) for (const [day, min] of Object.entries(obj(p.study))) out[day] = Math.round((num(out[day]) + num(min)) * 10) / 10;
  return out;
}

/**
 * The combined view of one exam. `parts[0]` is this device's own part; the rest come from the other devices.
 * One part: returned as it is (nothing to combine).
 */
export function combineProgress(examId, parts) {
  const list = parts.filter(Boolean);
  if (list.length === 1) return list[0];
  const latest = newest(list, partTime);
  const sessions = list.flatMap((p) => (Array.isArray(p.sessions) ? p.sessions : [])).sort((a, b) => num(a.ts) - num(b.ts)).slice(-200);
  return {
    v: 1, exam: examId,
    questions: mergeQuestions(list), cards: mergeCards(list), games: mergeGames(list), learn: mergeLearn(list),
    calc: mergeTally(list, 'calc'), confuse: mergeTally(list, 'confuse'), plan: mergePlan(list), study: mergeStudy(list),
    sessions,
    bestStreak: Math.max(...list.map((p) => num(p.bestStreak))),
    streak: num(latest.streak),                       // the carried-over run continues from the device used last
    ts: Math.max(...list.map(partTime)),
  };
}
