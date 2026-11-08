// Progress on several devices: how the parts of the computer and the phone are combined (merge.js), what one sync has to do (sync-core.js)
// and how store.js uses both, against a fake localStorage. Run with: npm run test:learn
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { combineProgress } = await import('../app/js/merge.js');
const { planSync, emptyPart } = await import('../app/js/sync-core.js');
const store = await import('../app/js/store.js');
const { loadProgress, loadOwn, recordAnswer, recordCard, recordGame, recordCalc, recordStudy, setExamAt, recordLessonRead, exportProgress, importProgress, resetProgress, savePeers, loadPeers, syncMeta } = store;

const E = 'lean-agile';
const part = (over = {}) => ({ ...emptyPart(E), ...over });

test('counters of the devices add up, the latest answer decides the rest', () => {
  const a = part({ ts: 100, questions: { q1: { n: 2, score: 1, last: 100, lastScore: 0, streak: 0, guesses: 1 }, q2: { n: 1, score: 1, last: 50, lastScore: 1, streak: 1 } } });
  const b = part({ ts: 200, questions: { q1: { n: 3, score: 3, last: 200, lastScore: 1, streak: 3, sureWrong: 2 } } });
  const c = combineProgress(E, [a, b]);
  assert.deepEqual(c.questions.q1, { n: 5, score: 4, last: 200, lastScore: 1, streak: 3, guesses: 1, sureWrong: 2 });
  assert.deepEqual(c.questions.q2, { n: 1, score: 1, last: 50, lastScore: 1, streak: 1 });
  assert.equal(c.questions.q2.guesses, undefined, 'a field nobody has stays absent');
});

test('the order of the parts does not matter, and a single part is returned untouched', () => {
  const a = part({ ts: 100, questions: { q1: { n: 1, score: 1, last: 100, lastScore: 1, streak: 1 } }, study: { '2026-11-08': 10.5 }, bestStreak: 4, streak: 2, sessions: [{ ts: 5 }, { ts: 9 }] });
  const b = part({ ts: 300, questions: { q1: { n: 2, score: 1, last: 300, lastScore: 0, streak: 0 } }, study: { '2026-11-08': 20, '2026-11-09': 5 }, bestStreak: 7, streak: 0, sessions: [{ ts: 7 }] });
  assert.deepEqual(combineProgress(E, [a, b]), combineProgress(E, [b, a]));
  const c = combineProgress(E, [a, b]);
  assert.deepEqual(c.study, { '2026-11-08': 30.5, '2026-11-09': 5 });
  assert.equal(c.bestStreak, 7);
  assert.equal(c.streak, 0, 'the carried-over run is the one of the device used last');
  assert.deepEqual(c.sessions.map((s) => s.ts), [5, 7, 9]);
  assert.equal(combineProgress(E, [a]), a);
  assert.equal(combineProgress(E, [a, null]), a);
});

test('flashcards: the latest review wins. Games, drills and lessons add up or take the best', () => {
  const a = part({ ts: 1, cards: { c1: { due: 5, interval: 1, ease: 2.5, reps: 1, lapses: 0, misses: 0, first: 1, last: 10 }, c2: { due: 9, interval: 3, ease: 2.4, reps: 2, lapses: 0, misses: 0, first: 1, last: 90 } },
    games: { match: { plays: 2, best: 80, last: 60, lastTs: 100 } }, learn: { foundations: { read: 50 } }, calc: { takt: { n: 2, right: 1, last: 7 } }, confuse: { x: { n: 1, right: 1, last: 3 } } });
  const b = part({ ts: 2, cards: { c1: { due: 20, interval: 6, ease: 2.6, reps: 2, lapses: 0, misses: 0, first: 1, last: 40 } },
    games: { match: { plays: 1, best: 95, last: 95, lastTs: 200 } }, learn: { foundations: { read: 80 }, 'ex:s': { done: 9 } }, calc: { takt: { n: 3, right: 3, last: 9 } }, confuse: { x: { n: 2, right: 0, last: 5 } } });
  const c = combineProgress(E, [a, b]);
  assert.equal(c.cards.c1.interval, 6); assert.equal(c.cards.c2.interval, 3);
  assert.deepEqual(c.games.match, { plays: 3, best: 95, last: 95, lastTs: 200 });
  assert.deepEqual(c.learn, { foundations: { read: 80 }, 'ex:s': { done: 9 } });
  assert.deepEqual(c.calc.takt, { n: 5, right: 4, last: 9 });
  assert.deepEqual(c.confuse.x, { n: 3, right: 1, last: 5 });
});

test('the exam date comes from the device that set it last, also when it was removed there', () => {
  const a = part({ ts: 1, plan: { examAt: 1800000000000, upd: 100 } });
  const b = part({ ts: 2, plan: { upd: 300 } });             // removed later on the other device
  assert.deepEqual(combineProgress(E, [a, b]).plan, { upd: 300 });
  const c = part({ ts: 3, plan: { examAt: 1900000000000, upd: 500 } });
  assert.equal(combineProgress(E, [a, b, c]).plan.examAt, 1900000000000);
  assert.deepEqual(combineProgress(E, [part(), part()]).plan, {});
});

test('sessions: at most the newest 200', () => {
  const many = (from) => part({ sessions: Array.from({ length: 150 }, (_, i) => ({ ts: from + i })) });
  const c = combineProgress(E, [many(0), many(1000)]);
  assert.equal(c.sessions.length, 200); assert.equal(c.sessions.at(-1).ts, 1149); assert.equal(c.sessions[0].ts, 100, 'the 100 oldest of the 300 are dropped');
});

test('store: you see the sum of your own part and the parts of your other devices, and only your own part is ever written', () => {
  mem.clear();
  recordAnswer(E, 'q1', 1); recordAnswer(E, 'q1', 0);
  savePeers(E, { aaaaaaaaaaaaaaaa: part({ ts: Date.now() + 5000, questions: { q1: { n: 3, score: 3, last: Date.now() + 5000, lastScore: 1, streak: 3 } }, streak: 3, study: { '2020-01-01': 10 } }) });
  const seen = loadProgress(E);
  assert.equal(seen.questions.q1.n, 5); assert.equal(seen.questions.q1.score, 4);
  assert.equal(loadOwn(E).questions.q1.n, 2, 'the own part still holds only its own answers');
  recordAnswer(E, 'q1', 1);                                   // the run of right answers continues from the phone's 3
  assert.equal(loadOwn(E).questions.q1.n, 3);
  assert.equal(loadProgress(E).questions.q1.n, 6);
  assert.equal(loadOwn(E).streak, 4, 'the carried-over run continues from the device used last');
  recordStudy(E, 5);
  assert.equal(loadProgress(E).study['2020-01-01'], 10, 'the minutes of the other device are there');
  assert.equal(Object.values(loadOwn(E).study).reduce((a, b) => a + b, 0), 5, 'but only the own minutes are written');
  assert.equal(loadOwn(E).ts > 0, true, 'every save is stamped');
  // Exam B is not touched by Exam A's parts
  assert.deepEqual(loadProgress('outsourcing-governance').questions, {});
});

test('store: other writers also only touch the own part', () => {
  mem.clear();
  savePeers(E, { bbbbbbbbbbbbbbbb: part({ ts: 10, cards: { c1: { due: 1, interval: 1, ease: 2.5, reps: 1, lapses: 0, misses: 0, first: 1, last: 10 } }, games: { match: { plays: 1, best: 10, last: 10, lastTs: 10 } }, calc: { t: { n: 1, right: 1, last: 10 } }, learn: { a: { read: 10 } } }) });
  recordGame(E, 'match', { score: 50, answered: 3, seconds: 20 }); recordCalc(E, 't', false); recordLessonRead(E, 'b'); setExamAt(E, 1800000000000);
  recordCard(E, 'c2', { due: 2, interval: 1, ease: 2.5, reps: 1, lapses: 0, misses: 0, first: 2, last: Date.now() });
  assert.equal(loadOwn(E).games.match.plays, 1); assert.equal(loadProgress(E).games.match.plays, 2);
  assert.equal(loadOwn(E).calc.t.n, 1); assert.equal(loadProgress(E).calc.t.n, 2);
  assert.deepEqual(Object.keys(loadOwn(E).learn), ['b']); assert.deepEqual(Object.keys(loadProgress(E).learn).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(loadProgress(E).cards).sort(), ['c1', 'c2']);
  assert.equal(loadProgress(E).plan.examAt, 1800000000000);
});

test('store: a backup holds all devices together and replaces everything, a reset clears all', () => {
  mem.clear();
  recordAnswer(E, 'q1', 1);
  savePeers(E, { cccccccccccccccc: part({ ts: Date.now(), questions: { q1: { n: 4, score: 4, last: Date.now(), lastScore: 1, streak: 4 } } }) });
  const backup = exportProgress(E);
  assert.equal(JSON.parse(backup).questions.q1.n, 5, 'the backup is what you see: the sum of the devices');
  importProgress(E, backup);
  assert.deepEqual(loadPeers(E), {}, 'the parts of the other devices are dropped, they would count the same answers again');
  assert.equal(loadProgress(E).questions.q1.n, 5);
  assert.ok(syncMeta(E).resetAt > 0, 'and the others are told to follow');
  const at = syncMeta(E).resetAt;
  resetProgress(E);
  assert.deepEqual(loadProgress(E).questions, {});
  assert.ok(syncMeta(E).resetAt >= at);
});

// ---------------------------------------------------------------- what one sync does
const own = (ts) => part({ ts, questions: { q: { n: 1, score: 1, last: ts, lastScore: 1, streak: 1 } } });
const noMeta = { resetAt: 0, pushedTs: 0, pushedReset: 0 };

test('sync plan: a first sync sends the own part, an unchanged part is not sent again', () => {
  let p = planSync({ examId: E, device: 'mine', meta: noMeta, own: own(100), pull: { resetAt: 0, devices: {} } });
  assert.equal(p.push.ts, 100); assert.equal(p.push.data.questions.q.n, 1); assert.equal(p.meta.pushedTs, 100);
  p = planSync({ examId: E, device: 'mine', meta: p.meta, own: own(100), pull: { resetAt: 0, devices: {} } });
  assert.equal(p.push, null);
  p = planSync({ examId: E, device: 'mine', meta: p.meta, own: own(150), pull: { resetAt: 0, devices: {} } });
  assert.equal(p.push.ts, 150, 'changed since the last sync');
  assert.equal(planSync({ examId: E, device: 'mine', meta: noMeta, own: null, pull: { resetAt: 0, devices: {} } }).push, null, 'nothing to send for a device that was never used');
});

test('sync plan: the other devices come back as peers, never this device itself, never anything older than a reset', () => {
  const pull = { resetAt: 500, devices: { mine: { ts: 600, data: own(600) }, phone: { ts: 700, data: own(700) }, old: { ts: 400, data: own(400) }, broken: { ts: 800, data: null } } };
  const p = planSync({ examId: E, device: 'mine', meta: { resetAt: 500, pushedTs: 600, pushedReset: 500 }, own: own(600), pull });
  assert.deepEqual(Object.keys(p.peers), ['phone']);
  assert.equal(p.push, null);
});

test('sync plan: a reset on another device clears this device\'s part, a reset here is announced', () => {
  const pull = { resetAt: 900, devices: { phone: { ts: 950, data: own(950) } } };
  const p = planSync({ examId: E, device: 'mine', meta: { resetAt: 100, pushedTs: 300, pushedReset: 100 }, own: own(300), pull });
  assert.equal(p.clearOwn, true); assert.equal(p.meta.resetAt, 900); assert.equal(p.push, null); assert.deepEqual(Object.keys(p.peers), ['phone']);
  // reset here: nothing left, but the reset has to reach the computer
  const here = planSync({ examId: E, device: 'mine', meta: { resetAt: 1000, pushedTs: 300, pushedReset: 100 }, own: null, pull: { resetAt: 100, devices: { phone: { ts: 120, data: own(120) } } } });
  assert.equal(here.clearOwn, false); assert.equal(here.push.resetAt, 1000); assert.equal(here.push.data.questions.q, undefined); assert.equal(here.push.ts, 1000);
  assert.deepEqual(here.peers, {}, 'the phone\'s part is older than the reset');
  assert.equal(here.meta.pushedReset, 1000);
});
