// Learn mode rules (app/js/learn-data.js): path order, topic status, which questions the check asks, what comes next.
// Run with: npm run test:learn
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathTopics, topicStatus, pickCheck, nextTopic, minutesLeft, topicMinutes, hm, isOften, masteryPool, CHECK_SIZE, DONE_AT } from '../app/js/learn-data.js';

const load = (exam, file) => JSON.parse(fs.readFileSync(new URL(`../content/${exam}/${file}`, import.meta.url), 'utf8'));
const topics = load('lean-agile', 'topics.json');
const questions = load('lean-agile', 'questions.json');
const lessons = load('lean-agile', 'lessons.json');
const empty = () => ({ questions: {}, learn: {} });
const answered = (ids, score = 1) => Object.fromEntries(ids.map((id) => [id, { n: 1, score, last: 1, lastScore: score, streak: score >= 1 ? 1 : 0 }]));

test('every topic of Exam A has a lesson and the path follows lessons.order', () => {
  const path = pathTopics(topics, lessons);
  assert.equal(path.length, topics.length);
  assert.deepEqual(path.map((t) => t.id), lessons.order);
});

test('a topic without a lesson is not on the path, and Exam B has a lesson for every topic', () => {
  const b = load('outsourcing-governance', 'topics.json');
  assert.deepEqual(pathTopics(b, null), []);
  assert.deepEqual(pathTopics(b, { order: ['safe'], topics: {} }), []);
  const lessonsB = load('outsourcing-governance', 'lessons.json');
  const path = pathTopics(b, lessonsB);
  assert.equal(path.length, b.length);
  assert.deepEqual(path.map((t) => t.id), lessonsB.order);
  const qb = load('outsourcing-governance', 'questions.json');
  for (const t of path) assert.ok(qb.some((q) => q.topic === t.id && q.type !== 'open'), `${t.id} has questions for the check`);
});

test('status: todo, started after reading or answering, done only when read AND enough answered right', () => {
  const id = 'define';
  const pool = masteryPool(questions, id);
  assert.ok(pool.every((q) => q.type !== 'open'), 'mastery uses the auto-graded questions');
  const p = empty();
  assert.equal(topicStatus(p, questions, id).state, 'todo');
  p.learn[id] = { read: 1 };
  assert.equal(topicStatus(p, questions, id).state, 'started');
  p.questions = answered(pool.map((q) => q.id));
  assert.equal(topicStatus(p, questions, id).state, 'done');
  p.learn = {};
  assert.equal(topicStatus(p, questions, id).state, 'started', 'right answers without reading the lesson are not "done"');
  p.learn[id] = { read: 1 };
  const n = Math.ceil(pool.length * DONE_AT);
  p.questions = answered(pool.slice(0, n - 1).map((q) => q.id));
  assert.equal(topicStatus(p, questions, id).state, 'started', 'just under the bar');
  p.questions = answered(pool.slice(0, n).map((q) => q.id));
  assert.equal(topicStatus(p, questions, id).state, 'done', 'at the bar');
});

test('the check asks the questions not yet answered right first, auto-graded before open, at most CHECK_SIZE', () => {
  const id = 'foundations';
  const mine = questions.filter((q) => q.topic === id);
  const auto = mine.filter((q) => q.type !== 'open');
  assert.ok(auto.length > CHECK_SIZE, 'enough questions for the test to mean something');
  const p = empty();
  const first = pickCheck(questions, id, p, CHECK_SIZE);
  assert.equal(first.length, CHECK_SIZE);
  assert.ok(first.every((q) => q.type !== 'open'), 'open questions only when there are too few others');
  // everything auto-graded is mastered except three: those three must be asked
  const missing = auto.slice(0, 3);
  p.questions = answered(auto.slice(3).map((q) => q.id));
  const second = pickCheck(questions, id, p, CHECK_SIZE).map((q) => q.id);
  for (const q of missing) assert.ok(second.includes(q.id), `${q.id} was not answered right, so it comes first`);
  // a miss counts as not mastered
  p.questions[auto[5].id] = { n: 2, score: 1, last: 2, lastScore: 0, streak: 0 };
  assert.ok(pickCheck(questions, id, p, CHECK_SIZE).map((q) => q.id).includes(auto[5].id));
});

test('a small topic fills up with open questions', () => {
  const id = 'itil';
  const mine = questions.filter((q) => q.topic === id);
  assert.equal(pickCheck(questions, id, empty(), CHECK_SIZE).length, Math.min(CHECK_SIZE, mine.length));
});

test('next topic: first open one after this, else the first open one, else null', () => {
  const path = pathTopics(topics, lessons);
  const done = new Set(['foundations', 'waste']);
  const st = (id) => ({ state: done.has(id) ? 'done' : 'todo' });
  assert.equal(nextTopic(path, st).id, 'governance');
  assert.equal(nextTopic(path, st, 'governance').id, 'define');
  assert.equal(nextTopic(path, st, 'kanban-devops').id, 'governance', 'wraps around to the first open topic');
  for (const t of path) done.add(t.id);
  assert.equal(nextTopic(path, st), null);
});

test('time: reading plus checking, formatted', () => {
  const path = pathTopics(topics, lessons);
  const none = () => ({ state: 'todo' });
  const all = path.reduce((s, t) => s + topicMinutes(lessons, t.id), 0);
  assert.equal(minutesLeft(path, lessons, none), all);
  assert.equal(minutesLeft(path, lessons, () => ({ state: 'done' })), 0);
  assert.equal(hm(45), '45 min'); assert.equal(hm(120), '2 h'); assert.equal(hm(135), '2 h 15 min');
});

test('the lessons mark the themes the syllabus says the class missed most', () => {
  const often = topics.filter((t) => isOften(lessons, t.id)).map((t) => t.id);
  for (const id of ['foundations', 'governance', 'define', 'metrics-time', 'analyze', 'improve-flow']) assert.ok(often.includes(id), id);
});
