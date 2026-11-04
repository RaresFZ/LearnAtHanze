// Calculation trainer (app/js/calc-data.js): the formulas against the syllabus's own worked examples, every generator, grading.
// Run with: npm run test:calc
import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMULAS as F, GENERATORS, GROUPS, makeSet, parseNumber, gradeNumber, generatorsFor } from '../app/js/calc-data.js';

const near = (a, b, d = 6) => assert.ok(Math.abs(a - b) < 10 ** -d, `${a} is not ${b}`);
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('formulas reproduce the worked examples of the syllabus', () => {
  assert.equal(F.takt(420, 140), 3);                 // Ch.6: 420 min / 140 units = 3
  assert.equal(F.takt(420, 84), 5);                  // Ch.6 worked application
  assert.equal(F.takt(400, 100), 4);                 // Ch.14 and the answer key
  assert.equal(F.takt(450, 150), 3);                 // Ch.15 self-test 26
  assert.equal(F.flowTime(80, 20), 4);               // Ch.6 Little's Law
  assert.equal(F.flowTime(120, 40), 3);              // Ch.14
  assert.equal(F.flowTime(60, 30), 2);               // Ch.6 practice
  assert.equal(F.wip(20, 4), 80);
  assert.equal(F.throughput(80, 4), 20);
  near(F.pce(18, 4320), 0.4166667);                  // Ch.5: 0.42%
  assert.equal(F.ftr(1000, 90), 91);                 // Ch.14: 910 / 1,000
  near(F.dpu(40, 500), 0.08);                        // Ch.7
  near(F.dpo(40, 500, 4), 0.02);
  near(F.dpmo(40, 500, 4), 20000, 4);
  near(F.dpmo(24, 400, 3), 20000, 4);                // Ch.15 self-test 28
  near(F.dpmo(54, 1200, 3), 15000, 4);               // Ch.7 practice
  near(F.dpmo(30, 600, 2), 25000, 4);                // Ch.14
  near(F.defectiveRate(35, 500), 7);                 // Ch.7: 7%, not 8%
  near(F.oee(90, 80, 95), 68.4);                     // Ch.15 self-test 37
  near(F.availability(480, 60), 87.5);               // Ch.12 worked application
  near(F.performance(2, 180, 420), 85.7142857);
  near(F.quality(171, 180), 95);
  near(F.oee(F.availability(480, 60), F.performance(2, 180, 420), F.quality(171, 180)), 71.25);
  assert.equal(F.relativeReduction(300, 150), 50);   // Ch.14: 300 to 150 per 1,000 = 50% relative
  assert.equal(F.rpn(8, 3, 4), 96);
  near(F.cp(22, 10, 1), 2);
  near(F.rty([95, 98, 90]), 83.79, 4);
});

test('Exercise 4 (Hout enzo B.V.) reproduces the corrected answers of the teacher', () => {
  const steps = [['Sort material', 90, 20, 25, 1, 85, 5.29, 481.76], ['Assembling', 95, 25, 65, 2, 55, 8.18, 793.64], ['Apply lacquer layer', 160, 30, 130, 4, 60, 7.5, 1230], ['Packing and sending', 125, 30, 90, 1, 65, 6.92, 872.31]];
  const takt = F.takt(450, 15000 / 250);
  assert.equal(takt, 7.5);
  let processing = 0, lead = 0;
  for (const [name, s0, inflow, s1, fte, out, ct, lt] of steps) {
    assert.equal(F.stepOutput(s0, inflow, s1), out, name);
    const cycle = F.stepCycleTime(450, out);
    near(cycle, ct, 2);
    const l = F.leadSimplified(cycle, fte, s0);
    near(l, lt, 2);
    processing += cycle * fte; lead += l;
    assert.equal(cycle > takt, name === 'Assembling', name + ' is the only step above takt');
  }
  near(processing, 58.58, 2);
  near(lead, 3377.71, 2);
  near((processing / lead) * 100, 1.73, 2);
});

test('Exam A has the trainer, Exam B does not', () => {
  assert.ok(generatorsFor('lean-agile').length >= 15);
  assert.deepEqual(generatorsFor('outsourcing-governance'), []);
  assert.deepEqual(makeSet('outsourcing-governance', { n: 5 }), []);
  const groups = new Set(GROUPS.map((g) => g.id));
  for (const g of GENERATORS) assert.ok(groups.has(g.group), `${g.id} has a group`);
  assert.equal(new Set(GENERATORS.map((g) => g.id)).size, GENERATORS.length, 'unique ids');
});

test('every generator makes sound questions for many seeds, and its steps show its own answer', () => {
  for (const g of GENERATORS) {
    for (let seed = 1; seed <= 300; seed++) {
      const q = g.make(seeded(seed * 7919));
      assert.ok(typeof q.prompt === 'string' && q.prompt.length > 20, `${g.id} prompt`);
      assert.ok(Number.isFinite(q.answer) && q.answer >= 0, `${g.id} answer ${q.answer} (seed ${seed})`);
      assert.ok(Number.isInteger(q.decimals) && q.decimals >= 0 && q.decimals <= 4);
      assert.ok(q.formula && q.steps.length >= 1);
      const shown = q.answer.toLocaleString('en-US', { minimumFractionDigits: q.decimals, maximumFractionDigits: q.decimals });
      assert.ok(q.steps.join(' ').includes(shown), `${g.id} (seed ${seed}): the steps should show ${shown}: ${q.steps.join(' | ')}`);
      assert.ok(gradeNumber(shown, q.answer, q.decimals), `${g.id}: its own answer is accepted`);
      assert.ok(!gradeNumber(String(q.answer + 10 ** -q.decimals), q.answer, q.decimals), `${g.id}: one unit off is refused`);
      assert.ok(!/NaN|undefined|Infinity/.test(q.prompt + q.steps.join(' ')), `${g.id} prints clean text`);
    }
  }
});

test('generators with a percent result stay between 0 and 100', () => {
  for (const g of GENERATORS) for (let seed = 1; seed <= 200; seed++) {
    const q = g.make(seeded(seed * 104729));
    if (q.unit === '%' && g.id !== 'relative-reduction') assert.ok(q.answer > 0 && q.answer <= 100, `${g.id}: ${q.answer}`);
  }
});

test('makeSet: the right number, the chosen groups only, and variety', () => {
  const set = makeSet('lean-agile', { n: 20, rng: seeded(5) });
  assert.equal(set.length, 20);
  assert.ok(new Set(set.map((q) => q.gid)).size >= 10, 'many different types in 20 questions');
  const oee = makeSet('lean-agile', { groups: ['oee'], n: 8, rng: seeded(6) });
  assert.ok(oee.every((q) => q.group === 'oee'));
  assert.equal(makeSet('lean-agile', { groups: ['nope'], n: 5 }).length, 0);
});

test('reading what people type', () => {
  assert.equal(parseNumber('20,000'), 20000);
  assert.equal(parseNumber('20.000'), 20, 'a dot is always a decimal point');
  assert.equal(parseNumber('0,085'), 0.085);
  assert.equal(parseNumber('0.085'), 0.085);
  assert.equal(parseNumber('20 000'), 20000);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('0,42'), 0.42);
  assert.equal(parseNumber('87.5%'), 87.5);
  assert.equal(parseNumber('3 minutes'), 3);
  assert.equal(parseNumber('  4  '), 4);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber(null), null);
});

test('grading rounds to the asked decimals, and does not forgive a wrong answer', () => {
  assert.ok(gradeNumber('0.42', 0.42, 2));
  assert.ok(gradeNumber('0.4167', 0.42, 2), 'more decimals that round to the answer');
  assert.ok(gradeNumber('0,42 %', 0.42, 2));
  assert.ok(!gradeNumber('0.41', 0.42, 2));
  assert.ok(!gradeNumber('3.4', 3, 0), 'a whole-number answer is not "about" right');
  assert.ok(gradeNumber('68.4', 68.4, 1));
  assert.ok(gradeNumber('68.40', 68.4, 1));
  assert.ok(!gradeNumber('68.5', 68.4, 1));
  assert.ok(!gradeNumber('68.45', 68.4, 1), 'one extra decimal is not enough');
  assert.ok(gradeNumber('68.4013', 68.4, 1), 'clearly more precise and rounding to the answer');
  assert.ok(!gradeNumber('', 3, 0));
  assert.ok(gradeNumber('20,000', 20000, 0));
});
