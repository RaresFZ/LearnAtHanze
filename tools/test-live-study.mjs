// Live Quiz "Study together": lesson parts followed by a question about each. Engine only, fake clock. Run with: npm run test:live
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGame, LIMITS, PACE, lessonMs } from '../server/live/engine.js';
import { studyParts, usable } from '../server/live/study.js';

const load = (id) => ({
  exam: { ...JSON.parse(fs.readFileSync(`content/${id}/exam.json`, 'utf8')), id },
  topics: JSON.parse(fs.readFileSync(`content/${id}/topics.json`, 'utf8')),
  questions: JSON.parse(fs.readFileSync(`content/${id}/questions.json`, 'utf8')),
  lessons: JSON.parse(fs.readFileSync(`content/${id}/lessons.json`, 'utf8')),
});
function fakeClock() {
  let t = 1000; const jobs = [];
  return {
    now: () => t,
    after(ms, fn) { const j = { at: t + ms, fn, dead: false }; jobs.push(j); return () => { j.dead = true; }; },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = jobs.filter((j) => !j.dead && j.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at; due.dead = true; due.fn();
      }
      t = end;
    },
  };
}
function study(config = {}, exam = 'lean-agile') {
  const clock = fakeClock();
  const d = load(exam);
  const game = createGame({ ...d, config: { study: true, topicIds: ['define', 'mapping'], seconds: 20, ...config }, code: '12345', clock, random: () => 0.42 });
  return { game, clock, d };
}
const joinN = (game, names) => names.map((n) => { const r = game.join({ nick: n }); game.setConnected(r.player.token, true); return r.player; });
const correctOf = (game, i) => game._rounds()[i].correct;
const answerAll = (game, players, i) => { for (const p of players) game.answer({ token: p.token, q: i, choice: correctOf(game, i) }); };

for (const exam of ['lean-agile', 'outsourcing-governance']) {
  test(`${exam}: the study rounds are the lesson parts in lesson order, each with one usable, different question`, () => {
    const d = load(exam);
    const all = Object.keys(d.lessons.topics);
    const parts = studyParts({ ...d, topicIds: all });
    const total = Object.values(d.lessons.topics).reduce((s, l) => s + l.chunks.length, 0);
    assert.ok(parts.length >= total - 4 && parts.length <= total, `${parts.length} of ${total} parts have a question`);
    assert.equal(new Set(parts.map((p) => p.q.id)).size, parts.length, 'no question twice');
    assert.ok(parts.every((p) => usable(p.q)), 'only multiple choice or true/false, never flagged');
    const orderIdx = (t) => d.lessons.order.indexOf(t);
    assert.ok(parts.every((p, i) => i === 0 || orderIdx(parts[i - 1].topicId) <= orderIdx(p.topicId)), 'topics follow the lesson order');
    assert.ok(parts.every((p) => p.lesson.title && p.lesson.points.length && p.lesson.part >= 1 && p.lesson.part <= p.lesson.parts));
    for (const p of parts) {                                                                            // a part's own question comes first when it is usable
      const c = d.lessons.topics[p.topicId].chunks[p.part - 1];
      const own = c.study?.[0] ?? c.ask?.[0];
      if (own && usable(d.questions.find((q) => q.id === own))) assert.equal(p.q.id, own, `${p.topicId} part ${p.part} keeps its own question`);
    }
    assert.deepEqual(studyParts({ ...d, topicIds: [] }), [], 'no topic, no rounds');
    assert.deepEqual(studyParts({ ...d, topicIds: ['nope'] }), []);
  });
}

test('a part marked "study": [] is left out, and a "study" question replaces the quick check', () => {
  const d = load('outsourcing-governance');
  const fw = studyParts({ ...d, topicIds: ['frameworks'] });
  assert.ok(!fw.some((p) => p.part === 3), 'frameworks part 3 is left out');
  const a = load('lean-agile');
  const flow = studyParts({ ...a, topicIds: ['improve-flow'] });
  assert.equal(flow.find((p) => p.part === 2).q.id, 'la-203', 'Heijunka part uses the Heijunka question');
});

test('creating a study game: it needs lessons and topics, and the rounds are the lesson parts', () => {
  const { game, d } = study();
  const parts = studyParts({ ...d, topicIds: ['define', 'mapping'] });
  assert.equal(game._rounds().length, parts.length);
  assert.equal(game.hostView().settings.study, true);
  assert.equal(game.hostView().settings.count, parts.length);
  assert.equal(game.config.board, false, 'no leaderboard between rounds by default');
  assert.throws(() => study({ topicIds: [] }), /at least one topic/);
  assert.throws(() => study({ topicIds: ['nope'] }), /No lesson parts/);
  const d2 = load('lean-agile');
  assert.throws(() => createGame({ ...d2, lessons: null, config: { study: true, topicIds: ['define'], seconds: 20 }, code: '1' }), /no lessons/);
  const quiz = createGame({ ...d2, config: { count: 5, seconds: 20 }, code: '1' });
  assert.equal(quiz.config.study, false); assert.equal(quiz.config.board, true, 'a normal quiz keeps its leaderboard');
});

test('a round: lesson, then get ready, then the question, the answer, and straight on to the next lesson (no leaderboard)', () => {
  const { game, clock } = study();
  const ps = joinN(game, ['Ana', 'Bo']);
  game.start();
  assert.equal(game.phase, 'lesson');
  const v = game.hostView();
  assert.ok(v.lesson.title && v.lesson.points.length && v.q.index === 0);
  assert.equal(game.playerView(ps[0].token).lesson.title, v.lesson.title);
  clock.advance(10 * 60 * 1000); assert.equal(game.phase, 'lesson', 'manual: it waits for the host');
  assert.ok(game.next().ok); assert.equal(game.phase, 'ready');
  clock.advance(LIMITS.readyMs); assert.equal(game.phase, 'question');
  answerAll(game, ps, 0); assert.equal(game.phase, 'reveal');
  game.next(); assert.equal(game.phase, 'lesson', 'no board: the next lesson part');
  assert.equal(game.hostView().q.index, 1);
  assert.notEqual(game.hostView().lesson.title, v.lesson.title);
});

test('with the leaderboard switched on, it comes after each answer as in a quiz', () => {
  const { game, clock } = study({ board: true });
  const ps = joinN(game, ['Ana']);
  game.start(); game.next(); clock.advance(LIMITS.readyMs); answerAll(game, ps, 0);
  game.next(); assert.equal(game.phase, 'board');
  game.next(); assert.equal(game.phase, 'lesson');
});

test('the last round goes from the answer to the podium, and Play again starts the same lessons over', () => {
  const { game, clock } = study({ topicIds: ['define'] });
  const ps = joinN(game, ['Ana']);
  const n = game._rounds().length;
  game.start();
  for (let i = 0; i < n; i++) {
    assert.equal(game.phase, 'lesson'); game.next(); clock.advance(LIMITS.readyMs);
    answerAll(game, ps, i); assert.equal(game.phase, 'reveal'); game.next();
  }
  assert.equal(game.phase, 'podium');
  game.again();
  assert.equal(game.phase, 'lobby'); assert.equal(game._rounds().length, n); assert.equal(game.hostView().settings.study, true);
});

test('vote in the lesson: everybody taps "I\'ve read it", then the question comes', () => {
  const { game, clock } = study({ advance: 'vote' });
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  game.start();
  assert.deepEqual([game.hostView().advance.mode, game.hostView().advance.ready, game.hostView().advance.of], ['vote', 0, 2]);
  assert.ok(game.ready(a.token).ok); assert.equal(game.phase, 'lesson');
  assert.equal(game.playerView(a.token).advance.you, true);
  game.ready(b.token); assert.equal(game.phase, 'ready');
  clock.advance(LIMITS.readyMs); answerAll(game, [a, b], 0);
  assert.equal(game.phase, 'reveal');
  game.ready(a.token); game.ready(b.token); assert.equal(game.phase, 'lesson', 'the vote on the answer leads to the next lesson part');
  game.setConnected(b.token, false);                    // a phone dropping does not hold up the lesson vote
  game.ready(a.token); assert.equal(game.phase, 'ready');
});

test('auto: the reading time of a lesson part grows with its length', () => {
  const { game, clock } = study({ advance: 'auto' });
  joinN(game, ['Ana']);
  game.start();
  const wait = lessonMs(game.hostView().lesson);
  assert.ok(wait >= 12000 && wait <= 60000);
  assert.equal(game.hostView().advance.remainingMs, wait);
  clock.advance(wait - 1); assert.equal(game.phase, 'lesson');
  clock.advance(1); assert.equal(game.phase, 'ready');
  assert.equal(lessonMs({ title: 'x', points: ['y'] }), 12000);
  assert.equal(lessonMs({ title: 'x', points: ['y'.repeat(5000)] }), 60000);
});

test('the host can skip a lesson, and the lesson text is the only new thing a phone gets before the answer', () => {
  const { game, clock } = study();
  const [a] = joinN(game, ['Ana']);
  game.start();
  assert.ok(game.skip().ok); assert.equal(game.phase, 'ready');
  for (const v of [game.hostView(), game.playerView(a.token)]) assert.ok(!('reveal' in v) && !/"(explanation|correct|source)":/.test(JSON.stringify(v)), 'ready payload');
  clock.advance(LIMITS.readyMs);
  for (const v of [game.hostView(), game.playerView(a.token)]) assert.ok(!('reveal' in v) && !/"(explanation|correct|source)":/.test(JSON.stringify(v)), 'question payload');
  game.start; // (already started) a second start is refused
  assert.equal(game.start().error, 'phase');
  // the lesson payload itself
  const g2 = study().game; const [b] = joinN(g2, ['Bo']); g2.start();
  const lessonView = JSON.stringify(g2.playerView(b.token));
  assert.ok(!/"(explanation|correct|source|reveal)":/.test(lessonView), 'the lesson payload carries no answer fields');
});

test('a normal quiz is not changed: no lesson phase, the leaderboard stays', () => {
  const clock = fakeClock(); const d = load('lean-agile');
  const game = createGame({ ...d, config: { count: 5, seconds: 20 }, code: '1', clock, random: () => 0.42 });
  const [a] = joinN(game, ['Ana']);
  game.start(); assert.equal(game.phase, 'ready');
  clock.advance(LIMITS.readyMs); answerAll(game, [a], 0);
  game.next(); assert.equal(game.phase, 'board');
  assert.equal(game.hostView().lesson, undefined);
});

test('at the end of a study game, the parts somebody missed are listed, worst first, with the answer', () => {
  const { game, clock } = study({ topicIds: ['define'] });
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  const n = game._rounds().length;
  game.start();
  for (let i = 0; i < n; i++) {
    game.next(); clock.advance(LIMITS.readyMs);
    const right = correctOf(game, i), wrong = game._rounds()[i].options.findIndex((_, k) => k !== right);
    game.answer({ token: a.token, q: i, choice: right });                                                   // Ana always right
    if (i === 0) game.answer({ token: b.token, q: i, choice: wrong });                                      // Bo misses part 1 ...
    else if (i === 1) { /* ... and does not answer part 2 */ clock.advance(25000); }
    else game.answer({ token: b.token, q: i, choice: right });
    game.next();
  }
  assert.equal(game.phase, 'podium');
  const host = game.hostView().revisit;
  assert.deepEqual(host.map((r) => r.index), [0, 1], 'the two missed parts, in lesson order when equally bad');
  assert.ok(host.every((r) => r.right === 1 && r.of === 2 && r.question && r.answer && r.title));
  assert.equal(host[0].answer, game._rounds()[0].options[correctOf(game, 0)]);
  const mine = game.playerView(a.token).revisit, his = game.playerView(b.token).revisit;
  assert.deepEqual(mine.map((r) => r.you), ['right', 'right']);
  assert.deepEqual(his.map((r) => r.you), ['wrong', 'none']);
  game.again();
  assert.equal(game.hostView().revisit, undefined, 'back in the lobby: nothing left over');
});

test('a game where everybody gets everything right has an empty revisit list; a normal quiz has none at all', () => {
  const { game, clock } = study({ topicIds: ['define'] });
  const ps = joinN(game, ['Ana']);
  const n = game._rounds().length;
  game.start();
  for (let i = 0; i < n; i++) { game.next(); clock.advance(LIMITS.readyMs); answerAll(game, ps, i); game.next(); }
  assert.deepEqual(game.hostView().revisit, []);
  const clock2 = fakeClock(); const d = load('lean-agile');
  const quiz = createGame({ ...d, config: { count: 5, seconds: 20 }, code: '1', clock: clock2, random: () => 0.42 });
  const [q] = joinN(quiz, ['Ana']); quiz.start();
  for (let i = 0; i < 5; i++) { clock2.advance(LIMITS.readyMs); answerAll(quiz, [q], i); quiz.next(); if (quiz.phase === 'board') quiz.next(); }
  assert.equal(quiz.phase, 'podium'); assert.equal(quiz.hostView().revisit, undefined); assert.equal(quiz.playerView(q.token).revisit, undefined);
});
