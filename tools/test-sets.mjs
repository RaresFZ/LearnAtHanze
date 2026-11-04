// Ready-made exams (exam.json "simulation.sets") and the content that came from the teacher's own files.
// The right answers below are copied from the teacher's documents ("LEAN Test Exam+Answers.docx" and "Scrum Kahoot.docx"), so a change in the content that moves an answer fails here.
// Run with: npm run test:learn
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { examSets, newAttempt, simConfig, finalScores } from '../app/js/sim.js';

const load = (id) => ({
  exam: JSON.parse(fs.readFileSync(`content/${id}/exam.json`, 'utf8')),
  questions: JSON.parse(fs.readFileSync(`content/${id}/questions.json`, 'utf8')),
  topics: JSON.parse(fs.readFileSync(`content/${id}/topics.json`, 'utf8')),
});
const A = load('lean-agile');
const rightText = (q) => q.options[q.answer];

// the 20 answers of the Microsoft Forms test exam, in order (the "Google Forms Green Belt Practice Exam" list of the docx)
const TEACHER = ['Inventory', 'Lead time', 'Lean focuses on flow and waste; Six Sigma on variation and defects', 'Map the current process and handoffs',
  'Respond to 90% of priority tickets within 4 business hours', 'Requests arrive in large unpredictable batches', 'Define high-level process boundaries and interfaces', 'Analyze',
  '3 minutes per request', '3 days', '50,000', 'A controlled pilot addressing the cause reduces the problem', 'Rank defect categories by their contribution',
  'To reduce overload and expose blocked work', 'A form prevents submission when a required field is empty', 'Standardize', '68.4%',
  'To monitor performance and define responses to deterioration', 'It structures possible causes that still require verification', '10%'];

// the 26 right answers of the Scrum Kahoot (typos fixed), in order
const KAHOOT = ['The Product Owner', 'Ensuring Scrum is understood and enacted', '1 month or less', 'The Daily Scrum', 'An ordered list of everything that is needed in a product',
  'To determine when a backlog item is complete', 'Transparency, Inspection and Adaptation', 'To inspect how the last Sprint went and plan improvements', 'Visualize the workflow',
  'Start with what you do now', 'To improve flow and reduce bottlenecks', 'The workflow stages of the current work', 'To ensure work items move smoothly through the system',
  'Use time-boxed iterations', 'To improve collaboration between development and operations', 'Shared responsibility and continuous learning', 'Continuous Integration / Continuous Deployment',
  'Kubernetes', 'To observe system performance and detect issues early', 'Performing tasks earlier in the development lifecycle', 'To deliver value through effective service management',
  'Start from scratch', 'The service value chain', 'To align services with changing business needs', 'It ensures alignment with the organisational objectives', 'Progress iteratively with feedback'];

test('Exam A lists three ready-made exams, B none', () => {
  const sets = examSets(A.exam, A.questions);
  assert.deepEqual(sets.map((s) => [s.id, s.questions.length]), [['teacher-test', 20], ['scrum-kahoot', 26], ['answer-key', 20]]);
  assert.ok(sets.every((s) => s.minutes > 0 && s.title && s.description));
  const B = load('outsourcing-governance');
  assert.deepEqual(examSets(B.exam, B.questions), []);
  assert.deepEqual(examSets(null, []), []);
  assert.equal(simConfig(A.exam).types.join(), 'mc', 'the exam is multiple choice');
});

test('the teacher\'s test exam: 20 questions in the order of the Forms, options exactly as written, right answers as in the docx', () => {
  const set = examSets(A.exam, A.questions).find((s) => s.id === 'teacher-test').questions;
  assert.equal(set.length, 20);
  set.forEach((q, i) => {
    assert.equal(q.type, 'mc'); assert.equal(q.fixedOrder, true, `${q.id} keeps its option order`);
    assert.equal(rightText(q), TEACHER[i], `question ${i + 1} (${q.id})`);
    assert.deepEqual(q.src, ['tp', `Question ${i + 1}`]);
    assert.equal(q.options.length, 4);
  });
  // a few options straight from the PDF (they were split over two pages there)
  assert.deepEqual(set[2].options[3], 'Both methods focus exclusively on reducing staff');
  assert.deepEqual(set[9].options, ['1 day', '2 days', '4 days', '3 days']);
  assert.deepEqual(set[16].options, ['76.0%', '68.4%', '85.5%', '95.0%']);
});

test('the Scrum Kahoot: 26 questions, the right answers are the teacher\'s', () => {
  const set = examSets(A.exam, A.questions).find((s) => s.id === 'scrum-kahoot').questions;
  assert.equal(set.length, 26);
  set.forEach((q, i) => assert.equal(rightText(q), KAHOOT[i], `Kahoot question ${i + 1} (${q.id})`));
  set.forEach((q, i) => assert.deepEqual(q.src, ['sk', `Question ${i + 1}`]));
  assert.equal(new Set(set.map((q) => q.topic)).size >= 5, true, 'spread over the Scrum, Kanban, DevOps and ITIL topics');
});

test('new multiple-choice questions do not give the answer away by length or position', () => {
  const fresh = A.questions.filter((q) => q.type === 'mc' && q.id >= 'la-330');
  const pos = [0, 0, 0, 0];
  let longest = 0;
  for (const q of fresh) {
    pos[q.answer]++;
    const len = q.options.map((o) => o.length), right = len[q.answer], others = len.filter((_, i) => i !== q.answer);
    if (right > Math.max(...others)) longest++;
  }
  assert.ok(longest / fresh.length < 0.3, `the right option is the longest in ${longest} of ${fresh.length}`);
  for (const n of pos) assert.ok(n / fresh.length > 0.15 && n / fresh.length < 0.35, `answer positions ${pos.join('/')}`);
});

test('a ready-made exam attempt keeps the questions in order and scores the teacher\'s answers 100%', () => {
  const set = examSets(A.exam, A.questions).find((s) => s.id === 'teacher-test');
  const at = newAttempt('lean-agile', set.questions, set.minutes, 1000, () => 0.5);
  assert.deepEqual(at.ids, set.questions.map((q) => q.id));
  for (const q of set.questions) assert.deepEqual(at.orders[q.id], [0, 1, 2, 3], 'options in the same order as the Forms');
  set.questions.forEach((q) => { at.answers[q.id] = q.answer; });
  const byId = new Map(A.questions.map((q) => [q.id, q]));
  const r = finalScores(at, byId);
  assert.equal(r.points, 20); assert.equal(r.pct, 100);
  at.answers[set.questions[0].id] = 0;                                                       // Overprocessing
  assert.equal(finalScores(at, byId).points, 19);
});

test('every lesson part with a quick check points to a question of its own topic, and the Scrum topics are complete', () => {
  const lessons = JSON.parse(fs.readFileSync('content/lean-agile/lessons.json', 'utf8'));
  const byId = new Map(A.questions.map((q) => [q.id, q]));
  for (const t of ['agile-scrum', 'scrum-team', 'scrum-events', 'scrum-artifacts', 'itil', 'kanban-devops', 'case-study']) {
    assert.ok(lessons.topics[t], `${t} has a lesson`);
    assert.ok(lessons.order.includes(t), `${t} is on the path`);
    for (const c of lessons.topics[t].chunks) if (c.ask) assert.equal(byId.get(c.ask[0]).topic, t);
    assert.ok(A.questions.filter((q) => q.topic === t).length >= 4, `${t} has questions`);
  }
  const events = lessons.topics['scrum-events'].chunks.map((c) => c.title);
  assert.deepEqual(events, ['The Sprint', 'Sprint Planning', 'The Daily Scrum', 'The Sprint Review', 'The Sprint Retrospective', 'The time-boxes on one page']);
});
