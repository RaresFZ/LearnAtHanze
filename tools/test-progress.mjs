// The progress fields added for the study tools (guess marks, calculations, drills, exam date, study time, drawing exercises),
// against a fake localStorage. Old saves must still load, and Exam A and B must stay apart. Run with: npm run test:learn
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const store = await import('../app/js/store.js');
const { loadProgress, recordAnswer, recordCalc, recordConfuse, setExamAt, recordStudy, recordExerciseDone, importProgress, exportProgress, questionStat, dayKey } = store;
const fresh = () => mem.clear();

test('a guess is counted when marked, and a wrong answer without the mark counts as "sure but wrong"', () => {
  fresh();
  recordAnswer('lean-agile', 'q1', 1, { guess: true });          // right, but a guess
  recordAnswer('lean-agile', 'q2', 0, { guess: false });         // wrong, and not marked
  recordAnswer('lean-agile', 'q3', 0, { guess: true });          // wrong, but it was a guess: not a wrong idea
  recordAnswer('lean-agile', 'q4', 1);                           // right, no mark
  recordAnswer('lean-agile', 'q2', 0.5, {});                     // partly: not full, not marked
  const p = loadProgress('lean-agile');
  assert.deepEqual([questionStat(p, 'q1').guesses, questionStat(p, 'q1').sureWrong], [1, 0]);
  assert.deepEqual([questionStat(p, 'q2').guesses, questionStat(p, 'q2').sureWrong], [0, 2]);
  assert.deepEqual([questionStat(p, 'q3').guesses, questionStat(p, 'q3').sureWrong], [1, 0]);
  assert.deepEqual([questionStat(p, 'q4').guesses, questionStat(p, 'q4').sureWrong], [0, 0]);
  assert.equal(questionStat(p, 'nope').guesses, 0);
  assert.equal(p.questions.q1.n, 1, 'the usual counters still work');
});

test('calculation and drill results are kept per type and per exam', () => {
  fresh();
  recordCalc('lean-agile', 'takt', true); recordCalc('lean-agile', 'takt', false); recordCalc('lean-agile', 'dpmo', true);
  recordConfuse('lean-agile', '3ms', true); recordConfuse('outsourcing-governance', 'pricing', false);
  const a = loadProgress('lean-agile'), b = loadProgress('outsourcing-governance');
  assert.deepEqual([a.calc.takt.n, a.calc.takt.right, a.calc.dpmo.n], [2, 1, 1]);
  assert.equal(a.confuse['3ms'].right, 1);
  assert.equal(b.confuse.pricing.n, 1); assert.equal(b.confuse.pricing.right, 0);
  assert.deepEqual(b.calc, {}, 'Exam B has none of Exam A\'s calculations');
  assert.equal(a.confuse.pricing, undefined, 'and Exam A none of Exam B\'s drills');
});

test('the exam date, study minutes and finished drawings', () => {
  fresh();
  setExamAt('lean-agile', 1800000000000);
  assert.equal(loadProgress('lean-agile').plan.examAt, 1800000000000);
  assert.equal(loadProgress('outsourcing-governance').plan.examAt, undefined, 'each exam has its own date');
  setExamAt('lean-agile', null);
  assert.equal(loadProgress('lean-agile').plan.examAt, undefined);
  recordStudy('lean-agile', 25); recordStudy('lean-agile', 12.5); recordStudy('lean-agile', 0); recordStudy('lean-agile', -3);
  assert.equal(loadProgress('lean-agile').study[dayKey()], 37.5);
  recordExerciseDone('lean-agile', 'coffee-sipoc');
  assert.ok(loadProgress('lean-agile').learn['ex:coffee-sipoc'].done > 0);
});

test('an old save without the new fields still loads, and Export and Import carry the new fields', () => {
  fresh();
  mem.set('learnathanze:v1:lean-agile', JSON.stringify({ v: 1, exam: 'lean-agile', questions: { a: { n: 2, score: 1, last: 1, lastScore: 1, streak: 1 } }, cards: {}, games: {}, sessions: [], bestStreak: 3, streak: 1 }));
  const old = loadProgress('lean-agile');
  assert.deepEqual([old.calc, old.confuse, old.plan, old.study, old.learn], [{}, {}, {}, {}, {}]);
  assert.equal(questionStat(old, 'a').sureWrong, 0);
  assert.equal(old.questions.a.n, 2, 'nothing of the old save is lost');
  recordCalc('lean-agile', 'oee', true); recordStudy('lean-agile', 10); setExamAt('lean-agile', 1800000000000);
  const text = exportProgress('lean-agile');
  fresh();
  importProgress('lean-agile', text);
  const back = loadProgress('lean-agile');
  assert.equal(back.calc.oee.right, 1); assert.equal(back.study[dayKey()], 10); assert.equal(back.plan.examAt, 1800000000000);
  assert.throws(() => importProgress('outsourcing-governance', text), /belongs to/);
});

test('a damaged save with the wrong shapes falls back to empty fields', () => {
  fresh();
  mem.set('learnathanze:v1:lean-agile', JSON.stringify({ v: 1, exam: 'lean-agile', questions: {}, calc: [1, 2], confuse: 'x', plan: null, study: 5, learn: [] }));
  const p = loadProgress('lean-agile');
  assert.deepEqual([p.calc, p.confuse, p.plan, p.study, p.learn], [{}, {}, {}, {}, {}]);
});
