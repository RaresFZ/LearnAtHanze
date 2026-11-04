// Live Quiz: what moves the game on after each answer (manual, auto, vote). Engine only, fake clock. Run with: npm run test:live
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGame, LIMITS, ADVANCE, PACE, revealMs } from '../server/live/engine.js';

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
function setup(config = {}) {
  const clock = fakeClock();
  const game = createGame({ ...load('lean-agile'), config: { count: 5, seconds: 20, ...config }, code: '12345', clock, random: () => 0.42 });
  return { game, clock };
}
const joinN = (game, names) => names.map((n) => { const r = game.join({ nick: n }); game.setConnected(r.player.token, true); return r.player; });
const toQuestion = (game, clock) => { game.start(); clock.advance(LIMITS.readyMs); };
const correctOf = (game, i) => game._rounds()[i].correct;
/** Everybody answers question i (right), so the round ends at once and the reveal is up. */
const answerAll = (game, players, i) => { for (const p of players) game.answer({ token: p.token, q: i, choice: correctOf(game, i) }); };

test('manual is the default and nothing moves on by itself', () => {
  const { game, clock } = setup();
  assert.equal(game.config.advance, 'manual');
  const ps = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock); answerAll(game, ps, 0);
  assert.equal(game.phase, 'reveal');
  clock.advance(10 * 60 * 1000);
  assert.equal(game.phase, 'reveal', 'still waiting for the host');
  assert.equal(game.hostView().advance.mode, 'manual');
  assert.equal(game.hostView().advance.remainingMs, 0);
});

test('the modes are manual, auto and vote; anything else is refused', () => {
  assert.deepEqual(ADVANCE, ['manual', 'auto', 'vote']);
  assert.throws(() => setup({ advance: 'robot' }), /manual, auto or vote/);
  const { game } = setup();
  assert.equal(game.setAdvance('nope').error, 'mode');
});

test('auto: the answer stays up for a reading time that grows with the explanation, then the leaderboard, then the next question', () => {
  const { game, clock } = setup({ advance: 'auto' });
  const ps = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock); answerAll(game, ps, 0);
  assert.equal(game.phase, 'reveal');
  const wait = revealMs(game._rounds()[0].explanation);
  assert.ok(wait >= PACE.revealMinMs && wait <= PACE.revealMaxMs);
  assert.equal(game.hostView().advance.remainingMs, wait);
  clock.advance(wait - 1); assert.equal(game.phase, 'reveal');
  clock.advance(1); assert.equal(game.phase, 'board');
  assert.equal(game.hostView().advance.remainingMs, PACE.boardMs);
  clock.advance(PACE.boardMs); assert.equal(game.phase, 'ready');
  assert.equal(game.hostView().q.index, 1);
});

test('auto: the reading time is clamped (a short or missing explanation, a very long one)', () => {
  assert.equal(revealMs(''), PACE.revealMinMs);
  assert.equal(revealMs('x'.repeat(10)), PACE.revealMinMs);
  assert.equal(revealMs('x'.repeat(100)), PACE.revealBaseMs + 100 * PACE.revealCharMs);
  assert.equal(revealMs('x'.repeat(5000)), PACE.revealMaxMs);
});

test('auto: the last question goes from the answer straight to the podium, and the host can still skip ahead', () => {
  const { game, clock } = setup({ advance: 'auto' });
  const ps = joinN(game, ['Ana']);
  toQuestion(game, clock);
  for (let i = 0; i < 5; i++) {
    answerAll(game, ps, i);
    assert.equal(game.phase, 'reveal');
    if (i < 4) { game.next(); assert.equal(game.phase, 'board', 'host pressed Next: no need to wait'); game.next(); clock.advance(LIMITS.readyMs); }
  }
  clock.advance(revealMs(game._rounds()[4].explanation));
  assert.equal(game.phase, 'podium');
  clock.advance(10 * 60 * 1000); assert.equal(game.phase, 'podium', 'nothing is scheduled after the podium');
  assert.equal(game.hostView().advance, undefined);
});

test('vote: it waits until every connected player says they read it', () => {
  const { game, clock } = setup({ advance: 'vote' });
  const [a, b, c] = joinN(game, ['Ana', 'Bo', 'Cy']);
  toQuestion(game, clock); answerAll(game, [a, b, c], 0);
  assert.equal(game.phase, 'reveal');
  assert.deepEqual([game.hostView().advance.ready, game.hostView().advance.of], [0, 3]);
  assert.ok(game.ready(a.token).ok);
  assert.ok(game.ready(a.token).ok, 'a second tap changes nothing');
  assert.equal(game.hostView().advance.ready, 1);
  assert.equal(game.playerView(a.token).advance.you, true);
  assert.equal(game.playerView(b.token).advance.you, false);
  clock.advance(5 * 60 * 1000); assert.equal(game.phase, 'reveal', 'no timer in vote mode: it waits for the last player');
  game.ready(b.token); assert.equal(game.phase, 'reveal');
  game.ready(c.token); assert.equal(game.phase, 'board', 'the last vote moves it on');
  clock.advance(PACE.boardMs); assert.equal(game.phase, 'ready', 'the leaderboard has nothing to read: it moves on by itself');
});

test('vote: a player who drops, leaves or is removed does not hold up the others; the host can always move on', () => {
  const { game, clock } = setup({ advance: 'vote' });
  const [a, b, c, d] = joinN(game, ['Ana', 'Bo', 'Cy', 'Di']);
  toQuestion(game, clock); answerAll(game, [a, b, c, d], 0);
  game.ready(a.token); game.ready(b.token);
  game.setConnected(c.token, false);                       // Cy's phone is gone
  assert.equal(game.phase, 'reveal');
  game.leave(d.token);                                     // Di leaves: nobody left who has not voted
  assert.equal(game.phase, 'board');
  game.next(); clock.advance(LIMITS.readyMs);
  answerAll(game, [a, b], 1);
  assert.equal(game.phase, 'reveal');
  game.ready(a.token);
  assert.ok(game.next().ok, 'the host pressing Next works in vote mode too');
  assert.equal(game.phase, 'board');
});

test('vote: a player the host removes does not hold up the vote either', () => {
  const { game, clock } = setup({ advance: 'vote' });
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock); answerAll(game, [a, b], 0);
  game.ready(a.token);
  game.kick(game.hostView().players.find((p) => p.nick === 'Bo').id);
  assert.equal(game.phase, 'board');
});

test('vote: voting is refused outside the reveal and in other modes', () => {
  const v = setup({ advance: 'vote' });
  const [a] = joinN(v.game, ['Ana']);
  assert.equal(v.game.ready(a.token).error, 'closed', 'lobby');
  toQuestion(v.game, v.clock);
  assert.equal(v.game.ready(a.token).error, 'closed', 'during the question');
  assert.equal(v.game.ready('nope').error, 'player');
  const m = setup();
  const [b] = joinN(m.game, ['Bo']);
  toQuestion(m.game, m.clock); answerAll(m.game, [b], 0);
  assert.equal(m.game.ready(b.token).error, 'closed', 'manual mode has no vote');
});

test('switching the mode in the middle of a game takes effect right away', () => {
  const { game, clock } = setup();
  const [a, b] = joinN(game, ['Ana', 'Bo']);
  toQuestion(game, clock); answerAll(game, [a, b], 0);
  assert.equal(game.phase, 'reveal');
  assert.ok(game.setAdvance('auto').ok);
  assert.equal(game.hostView().settings.advance, 'auto');
  assert.ok(game.hostView().advance.remainingMs > 0);
  assert.ok(game.setAdvance('vote').ok);
  assert.equal(game.hostView().advance.remainingMs, 0, 'the timer is cancelled');
  assert.equal(game.hostView().advance.ready, 0);
  clock.advance(5 * 60 * 1000); assert.equal(game.phase, 'reveal');
  game.ready(a.token); game.ready(b.token); assert.equal(game.phase, 'board');
  assert.ok(game.setAdvance('manual').ok);
  clock.advance(5 * 60 * 1000); assert.equal(game.phase, 'board', 'manual again: no timer');
});

test('the new fields never leak the answer early, and Play again keeps the mode', () => {
  const { game, clock } = setup({ advance: 'vote' });
  const [a] = joinN(game, ['Ana']);
  toQuestion(game, clock);
  for (const v of [game.hostView(), game.playerView(a.token)]) assert.equal(v.advance, undefined, 'no advance info during the question');
  for (let i = 0; i < 5; i++) {
    answerAll(game, [a], i);
    assert.equal(game.phase, 'reveal');
    game.ready(a.token);
    if (i < 4) { assert.equal(game.phase, 'board'); clock.advance(PACE.boardMs); clock.advance(LIMITS.readyMs); }
  }
  assert.equal(game.phase, 'podium');
  game.again();
  assert.equal(game.hostView().settings.advance, 'vote');
});
