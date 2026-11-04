// "Easily confused" drills (app/js/confuse-data.js) over the real content of both exams. Run with: npm run test:confuse
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { drillItems, makeItem, checkConfusions, groupStat, bareName, MAX_OPTIONS } from '../app/js/confuse-data.js';

const load = (exam, file) => JSON.parse(fs.readFileSync(new URL(`../content/${exam}/${file}`, import.meta.url), 'utf8'));
function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

for (const exam of ['lean-agile', 'outsourcing-governance']) {
  const config = load(exam, 'confusions.json');
  const topics = load(exam, 'topics.json');
  const docs = load(exam, 'exam.json').documents;

  test(`${exam}: the content is sound (ids, topics, sources, clues)`, () => {
    const { errors, warnings } = checkConfusions(config, { topicIds: new Set(topics.map((t) => t.id)), docKeys: new Set(Object.keys(docs)) });
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [], 'no clue gives its own term away');
    assert.ok(config.groups.length >= 10);
  });

  test(`${exam}: every drill item has its right answer among at most ${MAX_OPTIONS} different options, for many seeds`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const items = drillItems(config.groups, { n: 20, rng: seeded(seed) });
      assert.equal(items.length, 20);
      for (const it of items) {
        assert.ok(it.options.length >= 2 && it.options.length <= MAX_OPTIONS);
        assert.equal(new Set(it.options).size, it.options.length, 'options are different');
        assert.equal(it.options[it.answer], it.term.name);
        assert.ok(it.term.clues.includes(it.clue), 'the clue belongs to the right term');
        const group = config.groups.find((g) => g.id === it.gid);
        assert.ok(it.options.every((o) => group.terms.some((t) => t.name === o)), 'all options come from the same group');
        assert.ok(!it.options.slice().filter((o, i) => i !== it.answer).some((o) => group.terms.find((t) => t.name === o).clues.includes(it.clue)), 'no other option owns the clue');
      }
    }
  });
}

test('a drill spreads over the groups and can be limited to some', () => {
  const { groups } = load('lean-agile', 'confusions.json');
  const items = drillItems(groups, { n: 14, rng: seeded(3) });
  assert.equal(new Set(items.map((i) => i.gid)).size, 14, '14 questions from 14 groups when n equals the number of groups');
  const two = drillItems(groups, { n: 10, only: ['3ms', 'roles'], rng: seeded(4) });
  assert.ok(two.every((i) => ['3ms', 'roles'].includes(i.gid)));
  assert.deepEqual(drillItems(groups, { n: 5, only: ['nope'] }), []);
});

test('a clue is not repeated until all the clues of its group have been used', () => {
  const group = { id: 'g', title: 'g', terms: [{ name: 'A', means: 'a', tip: 'a', clues: ['a1', 'a2'] }, { name: 'B', means: 'b', tip: 'b', clues: ['b1', 'b2'] }] };
  const items = drillItems([group], { n: 4, rng: seeded(9) });
  assert.equal(new Set(items.map((i) => i.clue)).size, 4);
  assert.equal(drillItems([group], { n: 9, rng: seeded(9) }).length, 9, 'more questions than clues: they are used again');
});

test('the checker catches bad content', () => {
  const bad = { groups: [{ id: 'x', title: 'X', terms: [{ name: 'Alpha', means: 'm', tip: 't', clues: ['Alpha is first', 'same'] }, { name: 'Beta', means: 'm', tip: 't', clues: ['same'] }] }, { id: 'x', title: 'Y', terms: [{ name: 'Only', means: 'm', tip: 't', clues: ['c'] }] }] };
  const { errors, warnings } = checkConfusions(bad);
  assert.ok(errors.some((e) => /duplicate id/.test(e)));
  assert.ok(errors.some((e) => /at least 2 terms/.test(e)));
  assert.ok(errors.some((e) => /is used by/.test(e)), 'a clue owned by two terms is ambiguous');
  assert.ok(warnings.some((w) => /contains the term itself/.test(w)));
  assert.ok(checkConfusions({}).errors.length);
});

test('names and stats', () => {
  assert.equal(bareName('Skills (unused talent)'), 'skills');
  assert.equal(bareName('Muda'), 'muda');
  assert.deepEqual(groupStat({ confuse: { g: { n: 4, right: 3 } } }, 'g'), { n: 4, right: 3, share: 0.75 });
  assert.deepEqual(groupStat({ confuse: {} }, 'g'), { n: 0, right: 0, share: 0 });
  const g = { id: 'g', title: 'g', terms: [{ name: 'A', means: 'a', tip: 'a', clues: ['x'] }, { name: 'B', means: 'b', tip: 'b', clues: ['y'] }, { name: 'C', means: 'c', tip: 'c', clues: ['z'] }, { name: 'D', means: 'd', tip: 'd', clues: ['w'] }, { name: 'E', means: 'e', tip: 'e', clues: ['v'] }] };
  assert.equal(makeItem(g, g.terms[0], 'x', seeded(1)).options.length, MAX_OPTIONS, 'a group of five shows four options');
});
