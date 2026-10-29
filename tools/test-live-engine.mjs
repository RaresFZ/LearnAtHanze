// Live Quiz engine tests. Run with: npm run test:live   (node --test, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGame, scoreAnswer, eligibleQuestions, cleanNick, LIMITS } from '../server/live/engine.js';

const load = (id) => ({
  exam: { ...JSON.parse(fs.readFileSync(`content/${id}/exam.json`, 'utf8')), id },
  topics: JSON.parse(fs.readFileSync(`content/${id}/topics.json`, 'utf8')),
  questions: JSON.parse(fs.readFileSync(`content/${id}/questions.json`, 'utf8')),
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
const rng = () => 0.42;

function setup(over = {}) {
  const clock = fakeClock();
  const d = load(over.exam || 'lean-agile');
  let changes = 0;
  const game = createGame({ ...d, config: { count: 5, seconds: 20, ...over.config }, code: '12345', clock, random: over.random || rng, onChange: () => changes++ });
  return { game, clock, d, changes: () => changes };
}
const joinN = (game, names) => names.map((n) => { const r = game.join({ nick: n }); game.setConnected(r.player.token, true); return r.player; });
const toQuestion = (game, clock) => { game.start(); clock.advance(LIMITS.readyMs); };
const correctOf = (game, i) => game._rounds()[i].correct;

test('scoring: faster is worth more, streak bonus is capped', () => {
  assert.deepEqual(scoreAnswer({ correct: true, timeLeftMs: 20000, limitMs: 20000, streakBefore: 0 }), { points: 1000, bonus: 0 });
  assert.deepEqual(scoreAnswer({ correct: true, timeLeftMs: 10000, limitMs: 20000, streakBefore: 0 }), { points: 750, bonus: 0 });
  assert.deepEqual(scoreAnswer({ correct: true, timeLeftMs: 0, limitMs: 20000, streakBefore: 0 }), { points: 500, bonus: 0 });
  assert.equal(scoreAnswer({ correct: true, timeLeftMs: 0, limitMs: 20000, streakBefore: 2 }).bonus, 100);
  assert.equal(scoreAnswer({ correct: true, timeLeftMs: 0, limitMs: 20000, streakBefore: 9 }).bonus, 250);
  assert.deepEqual(scoreAnswer({ correct: false, timeLeftMs: 20000, limitMs: 20000, streakBefore: 4 }), { points: 0, bonus: 0 });
});

test('pool: only mc/tf, never flagged, topics filter', () => {
  for (const id of ['lean-agile', 'outsourcing-governance']) {
    const { questions, topics } = load(id);
    const all = eligibleQuestions(questions);
    assert.ok(all.every((q) => (q.type === 'mc' || q.type === 'tf') && !q.flag));
    const t = topics[0].id;
    assert.ok(eligibleQuestions(questions, [t]).every((q) => q.topic === t));
  }
  assert.throws(() => createGame({ ...load('lean-agile'), config: { count: 5, seconds: 20, topicIds: ['nope'] }, code: '1' }), /No multiple choice/);
  assert.throws(() => createGame({ ...load('lean-agile'), config: { count: 7, seconds: 20 }, code: '1' }), /5, 10 or 20/);
});

test('nicknames', () => {
  assert.equal(cleanNick('  Ana   B  '), 'Ana B');
  assert.equal(cleanNick(''), null);
  assert.equal(cleanNick('x'.repeat(17)), null);
  assert.equal(cleanNick('a\u0000b'), null);
  assert.equal(cleanNick(5), null);
  assert.equal(cleanNick('<b>hi</b>'), '<b>hi</b>');   // kept as text; the UI only ever uses textContent
});

test('join: duplicates, rejoin by token and by nickname, late joiners', () => {
  const { game, clock } = setup();
  const a = game.join({ nick: 'Ana' }); game.setConnected(a.player.token, true);
  assert.equal(game.join({ nick: 'ana' }).error, 'taken');
  assert.equal(game.join({ nick: 'ANA ' }).error, 'taken');
  assert.equal(game.join({ nick: 'x'.repeat(40) }).error, 'nick');
  // same token: resumes
  const again = game.join({ token: a.player.token, nick: 'whatever' });
  assert.ok(again.rejoined); assert.equal(again.player.id, a.player.id);
  // she disconnects; a new device with the same nickname takes the seat back, old token stops working
  const oldToken = a.player.token;
  game.setConnected(oldToken, false);
  clock.advance(LIMITS.awayMs + 1);
  const back = game.join({ nick: 'Ana' });
  assert.ok(back.rejoined); assert.equal(back.player.id, a.player.id); assert.notEqual(back.player.token, oldToken);
  assert.equal(game.find(oldToken), null);
  // late joiners are refused by default
  joinN(game, ['Bo']);
  toQuestion(game, clock);
  assert.equal(game.join({ nick: 'Cy' }).error, 'started');
});

test('late joiners allowed when the host turns it on: they start at 0 points', () => {
  const { game, clock } = setup({ config: { allowLate: true } });
  joinN(game, ['Ana']);
  toQuestion(game, clock);
  const late = game.join({ nick: 'Cy' }); assert.ok(late.ok);
  assert.equal(game.playerView(late.player.token).phase, 'question');
});

test('max players', () => {
  const { game } = setup();
  for (let i = 0; i < LIMITS.maxPlayers; i++) assert.ok(game.join({ nick: `p${i}` }).ok);
  assert.equal(game.join({ nick: 'one-too-many' }).error, 'full');
});

test('answers are checked on the server; points follow the clock; only one answer each', () => {
  const { game, clock } = setup();
  const [a, b, c] = joinN(game, ['Ana', 'Bo', 'Cy']);
  toQuestion(game, clock);
  assert.equal(game.phase, 'question');
  const good = correctOf(game, 0), bad = (good + 1) % 4;
  clock.advance(5000);   // 15s of 20s left
  assert.ok(game.answer({ token: a.token, q: 0, choice: good }).ok);
  assert.equal(game.answer({ token: a.token, q: 0, choice: bad }).error, 'dup');
  assert.equal(game.answer({ token: b.token, q: 0, choice: 99 }).error, 'choice');
  assert.equal(game.answer({ token: b.token, q: 3, choice: 0 }).error, 'closed');
  assert.ok(game.answer({ token: b.token, q: 0, choice: bad }).ok);
  clock.advance(1000);
  assert.ok(game.answer({ token: c.token, q: 0, choice: good }).ok);   // everybody has answered: ends early
  assert.equal(game.phase, 'reveal');
  const va = game.playerView(a.token), vb = game.playerView(b.token), vc = game.playerView(c.token);
  assert.equal(va.reveal.you.points, Math.round(500 + 500 * 15 / 20));
  assert.equal(vc.reveal.you.points, Math.round(500 + 500 * 14 / 20));
  assert.equal(vb.reveal.you.correct, false); assert.equal(vb.reveal.you.points, 0);
  assert.equal(va.reveal.you.rank, 1); assert.equal(vc.reveal.you.rank, 2); assert.equal(vb.reveal.you.rank, 3);
  assert.deepEqual(game.hostView().reveal.counts.reduce((s, x) => s + x, 0), 3);
});

test('timeout: unanswered = 0 and the streak resets; answers after the deadline are refused', () => {
  const { game, clock } = setup();
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock);
  assert.ok(game.answer({ token: a.token, q: 0, choice: correctOf(game, 0) }).ok);
  clock.advance(20000 + LIMITS.graceMs - 1);
  assert.equal(game.phase, 'question');
  clock.advance(2);
  assert.equal(game.phase, 'reveal');
  assert.equal(game.answer({ token: b.token, q: 0, choice: 0 }).error, 'closed');
  assert.equal(game.playerView(b.token).reveal.you.answered, false);
  assert.equal(game.playerView(b.token).reveal.you.points, 0);
});

test('streak bonus builds across questions and a miss resets it', () => {
  const { game, clock } = setup();
  const [a] = joinN(game, ['Ana']);
  const results = [];
  for (let i = 0; i < 4; i++) {
    if (i === 0) toQuestion(game, clock); else { game.next(); game.next(); clock.advance(LIMITS.readyMs); }
    const good = correctOf(game, i);
    game.answer({ token: a.token, q: i, choice: i === 2 ? (good + 1) % 4 : good });   // wrong on the third
    results.push(game.playerView(a.token).reveal.you);
  }
  assert.deepEqual(results.map((r) => r.bonus), [0, 50, 0, 0]);
  assert.deepEqual(results.map((r) => r.streak), [1, 2, 0, 1]);
});

test('leaderboard rows carry the points gained and the rank change', () => {
  const { game, clock } = setup();
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock);
  clock.advance(10000);                                              // Ana is slow: 750 points
  game.answer({ token: a.token, q: 0, choice: correctOf(game, 0) });
  game.answer({ token: b.token, q: 0, choice: (correctOf(game, 0) + 1) % 4 });
  game.next();
  let [first, second] = game.hostView().board;
  assert.deepEqual([first.nick, first.gain, first.rank, first.delta], ['Ana', 750, 1, 0]);
  assert.deepEqual([second.nick, second.gain, second.rank, second.delta], ['Bo', 0, 2, 0]);
  game.next(); clock.advance(LIMITS.readyMs);                       // question 2: Bo is instant (1000), Ana is wrong: they swap places
  game.answer({ token: b.token, q: 1, choice: correctOf(game, 1) });
  game.answer({ token: a.token, q: 1, choice: (correctOf(game, 1) + 1) % 4 });
  game.next();
  [first, second] = game.hostView().board;
  assert.deepEqual([first.nick, first.score, first.gain, first.delta], ['Bo', 1000, 1000, 1]);
  assert.deepEqual([second.nick, second.score, second.gain, second.delta], ['Ana', 750, 0, -1]);
});

test('phones never get the answer or explanation before the reveal', () => {
  const { game, clock } = setup();
  const [a] = joinN(game, ['Ana', 'Bo']);
  const secrets = (v) => /explanation|"correct"|"source"|reveal/.test(JSON.stringify(v));
  assert.ok(!secrets(game.playerView(a.token)) && !secrets(game.hostView()));
  game.start();
  assert.ok(!secrets(game.playerView(a.token)) && !secrets(game.hostView()), 'ready phase');
  clock.advance(LIMITS.readyMs);
  assert.equal(game.phase, 'question');
  for (const v of [game.playerView(a.token), game.hostView()]) {
    assert.ok(!secrets(v), 'question phase leaks nothing');
    assert.ok(!('reveal' in v));
  }
  game.answer({ token: a.token, q: 0, choice: 0 });
  assert.ok(!secrets(game.playerView(a.token)), 'after answering, still nothing until the reveal');
  game.skip();
  assert.equal(game.phase, 'reveal');
  assert.ok(game.playerView(a.token).reveal.explanation);
});

test('pause freezes the clock; resume continues; answers are refused while paused', () => {
  const { game, clock } = setup();
  const [a] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock);
  clock.advance(8000);
  game.pause();
  assert.equal(game.hostView().remainingMs, 12000);
  assert.equal(game.answer({ token: a.token, q: 0, choice: 0 }).error, 'closed');
  clock.advance(60000);
  assert.equal(game.phase, 'question');
  game.resume();
  assert.equal(game.hostView().remainingMs, 12000);
  clock.advance(12000 + LIMITS.graceMs + 1);
  assert.equal(game.phase, 'reveal');
});

test('skip ends the question with the answers so far; next walks reveal -> board -> next question -> podium', () => {
  const { game, clock } = setup();
  const [a] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock);
  game.answer({ token: a.token, q: 0, choice: correctOf(game, 0) });
  game.skip();
  assert.equal(game.phase, 'reveal');
  game.next(); assert.equal(game.phase, 'board');
  assert.ok(game.hostView().board.length <= 5);
  game.next(); assert.equal(game.phase, 'ready'); clock.advance(LIMITS.readyMs);
  for (let i = 1; i < 5; i++) {
    game.skip();
    game.next();
    if (i < 4) { assert.equal(game.phase, 'board'); game.next(); clock.advance(LIMITS.readyMs); }
  }
  assert.equal(game.phase, 'podium');
  assert.equal(game.hostView().podium[0].nick, 'Ana');
});

test('a player who drops or leaves mid-question does not hold up the round; their points stay', () => {
  const { game, clock } = setup();
  const [a, b, c] = joinN(game, ['Ana', 'Bo', 'Cy']);
  toQuestion(game, clock);
  game.answer({ token: a.token, q: 0, choice: correctOf(game, 0) });
  game.answer({ token: b.token, q: 0, choice: correctOf(game, 0) });
  assert.equal(game.phase, 'question');
  game.setConnected(c.token, false);          // phone lost connection: the round can end
  assert.equal(game.phase, 'reveal');
  game.next(); game.next(); clock.advance(LIMITS.readyMs);
  game.leave(a.token);
  const host = game.hostView();
  assert.equal(host.phase, 'question');
  assert.equal(host.of, 1);   // Ana left, Cy is away: only Bo counts
  assert.equal(game.find(a.token), null);
  // her score is still on the board, and she can come back with the same nickname
  assert.ok(game.hostView().players.find((p) => p.nick === 'Ana').left);
  const back = game.join({ nick: 'Ana' });
  assert.ok(back.rejoined);
});

test('Play again: same code and players, scores zero, new questions', () => {
  const { game, clock } = setup();
  const [a] = joinN(game, ['Ana']);
  toQuestion(game, clock);
  for (let i = 0; i < 5; i++) {
    game.answer({ token: a.token, q: i, choice: correctOf(game, i) });
    game.next();
    if (i < 4) { game.next(); clock.advance(LIMITS.readyMs); }
  }
  assert.equal(game.phase, 'podium');
  assert.ok(game.playerView(a.token).you.score > 0);
  assert.ok(game.again().ok);
  assert.equal(game.phase, 'lobby');
  assert.equal(game.playerView(a.token).you.nick, 'Ana');
  assert.equal(game.start().ok, true);
});

test('fixedOrder options stay in order, shuffled ones keep the right answer, tf has two options', () => {
  const { d } = setup();
  for (const seed of [0.1, 0.5, 0.9]) {
    const game = createGame({ ...d, config: { count: 20, seconds: 10 }, code: '1', random: () => seed });
    for (const r of game._rounds()) {
      const q = d.questions.find((x) => x.id === r.id);
      if (q.type === 'tf') { assert.deepEqual(r.options, ['True', 'False']); assert.equal(r.correct, q.answer ? 0 : 1); } else {
        assert.equal(r.options[r.correct], q.options[q.answer]);
        if (q.fixedOrder) assert.deepEqual(r.options, q.options);
      }
    }
  }
});

test('the two exams stay separate: a game only ever uses its own exam', () => {
  for (const id of ['lean-agile', 'outsourcing-governance']) {
    const { game, d } = setup({ exam: id, config: { count: 20 } });
    const ids = new Set(d.questions.map((q) => q.id));
    assert.ok(game._rounds().every((r) => ids.has(r.id) && r.id.startsWith(id === 'lean-agile' ? 'la-' : 'og-')));
    assert.equal(game.hostView().exam.id, id);
  }
});

test('a locked or lost phone keeps its seat in the lobby; only a seat nobody came back to for minutes is swept', () => {
  const { game, clock } = setup();
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  game.setConnected(a.token, false);                      // screen locked
  clock.advance(60 * 1000); game.sweep();
  assert.equal(game.hostView().players.length, 2, 'one minute later she is still there, shown as away');
  assert.ok(game.hostView().players.find((p) => p.nick === 'Ana').away);
  game.setConnected(a.token, true);                       // wakes up: same token, same seat
  assert.ok(!game.hostView().players.find((p) => p.nick === 'Ana').away);
  game.setConnected(b.token, false);
  clock.advance(LIMITS.keepMs + 1000); game.sweep();
  assert.deepEqual(game.hostView().players.map((p) => p.nick), ['Ana'], 'a closed tab is dropped after keepMs');
  assert.equal(game.find(b.token), null);
});

test('starting and Play again keep recently-seen away players, and drop the long gone ones', () => {
  const { game, clock } = setup();
  const [a, b, c] = joinN(game, ['Ana', 'Bo', 'Cy']);
  game.setConnected(b.token, false);
  assert.ok(game.start().ok);
  assert.ok(game.hostView().players.find((p) => p.nick === 'Bo'), 'Bo is away but still in the game');
  clock.advance(LIMITS.readyMs);
  for (let i = 0; i < 5; i++) {
    game.answer({ token: a.token, q: i, choice: correctOf(game, i) }); game.answer({ token: c.token, q: i, choice: correctOf(game, i) });
    game.next();
    if (i < 4) { game.next(); clock.advance(LIMITS.readyMs); }
  }
  assert.equal(game.phase, 'podium');
  game.setConnected(c.token, false);
  clock.advance(LIMITS.keepMs + 1000);
  assert.ok(game.again().ok);
  assert.deepEqual(game.hostView().players.map((p) => p.nick).sort(), ['Ana'], 'Bo and Cy were away for more than keepMs');
});

test('a player removed by the host between the reveal and the leaderboard does not break the views', () => {
  const { game, clock } = setup();
  const [a, b, c] = joinN(game, ['Ana', 'Bo', 'Cy']);
  toQuestion(game, clock);
  for (const p of [a, b, c]) game.answer({ token: p.token, q: 0, choice: correctOf(game, 0) });
  assert.equal(game.phase, 'reveal');
  const bo = game.hostView().players.find((p) => p.nick === 'Bo');
  game.next();                                            // leaderboard
  assert.ok(game.kick(bo.id));
  const host = game.hostView();
  assert.equal(host.phase, 'board');
  assert.ok(host.board.every((r) => r.nick !== 'Bo'));
  assert.equal(game.playerView(b.token), null, 'the removed phone is told it is gone');
  assert.ok(game.playerView(a.token).board.length >= 2);
  game.next(); clock.advance(LIMITS.readyMs);
  for (const p of [a, c]) game.answer({ token: p.token, q: 1, choice: correctOf(game, 1) });
  assert.equal(game.phase, 'reveal');
});

test('the host kicking during a question, a pause or a skip never leaves the game stuck', () => {
  const { game, clock } = setup();
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock);
  game.answer({ token: a.token, q: 0, choice: correctOf(game, 0) });
  assert.ok(game.pause().ok);
  game.kick(game.hostView().players.find((p) => p.nick === 'Bo').id);
  assert.ok(game.resume().ok);
  assert.equal(game.phase, 'reveal', 'Bo was the only one still thinking: with him gone, the round can end');
  assert.ok(game.next().ok && game.next().ok);
  assert.equal(game.phase, 'ready');
  assert.ok(game.skip().ok);
  assert.equal(game.phase, 'question');
  assert.ok(game.skip().ok);
  assert.equal(game.phase, 'reveal');
});
