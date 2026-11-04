// Live Quiz game engine: ONE game, pure logic, no HTTP. The server is authoritative: it keeps the clock,
// checks answers and computes scores. Time comes from an injected clock so tests can drive it.
//
// Phases: lobby -> ready -> question (-> paused) -> reveal -> board -> ready ... -> podium.
// Study together: the rounds are lesson parts, each followed by a question about it (see study.js); phase 'lesson' comes before 'ready'.
// What moves the game on after a question: the host ('manual'), a timer ('auto') or every player saying they read it ('vote'). See arm().
// The views (what a host screen or a phone may see) are built in ONE place, `view()`, and the correct answer,
// the explanation and the source are only put in them from the reveal on.
import crypto from 'node:crypto';
import { studyParts } from './study.js';

// keepMs: how long a player whose phone went away (screen locked, tab closed) keeps their seat in the lobby and for Play again.
export const LIMITS = { maxPlayers: 30, nickMax: 16, readyMs: 2000, graceMs: 300, awayMs: 8000, keepMs: 5 * 60 * 1000 };
// Correct answer: base + speed x (time left / time limit). Streak bonus: stepPerStreak for each correct answer in a row before this one, capped.
export const SCORING = { base: 500, speed: 500, streakStep: 50, streakCap: 250 };
export const COUNTS = [5, 10, 20];
export const ADVANCE = ['manual', 'auto', 'vote'];
// Auto mode: how long the answer stays up (reading time grows with the explanation, within limits) and how long the leaderboard stays.
export const PACE = { boardMs: 6000, revealBaseMs: 6000, revealCharMs: 45, revealMinMs: 8000, revealMaxMs: 25000 };
// Study game: the reading time of a lesson part grows with its length.
export const lessonMs = (lesson) => Math.max(12000, Math.min(60000, 8000 + [lesson.title, ...lesson.points, lesson.remember || ''].join(' ').length * 45));
export const revealMs = (explanation = '') => Math.max(PACE.revealMinMs, Math.min(PACE.revealMaxMs, PACE.revealBaseMs + explanation.length * PACE.revealCharMs));
export const SECONDS = [10, 20, 30];
export const BOARD_SIZE = 5;

export function scoreAnswer({ correct, timeLeftMs, limitMs, streakBefore }) {
  if (!correct) return { points: 0, bonus: 0 };
  const frac = Math.max(0, Math.min(1, timeLeftMs / limitMs));
  const points = Math.round(SCORING.base + SCORING.speed * frac);
  const bonus = Math.min(Math.max(0, streakBefore) * SCORING.streakStep, SCORING.streakCap);
  return { points, bonus };
}

/** Questions a live game can use: multiple choice and true/false, never ones flagged "Check the source". */
export function eligibleQuestions(questions, topicIds = []) {
  const wanted = new Set(topicIds);
  return questions.filter((q) => (q.type === 'mc' || q.type === 'tf') && !q.flag && (wanted.size === 0 || wanted.has(q.topic)));
}

/** Nickname rules: trimmed, whitespace collapsed, 1 to 16 characters, no control characters. */
export function cleanNick(raw) {
  if (typeof raw !== 'string') return null;
  const nick = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!nick || [...nick].length > LIMITS.nickMax || /[\p{C}]/u.test(nick)) return null;
  return nick;
}
const nickKey = (nick) => nick.normalize('NFKC').toLocaleLowerCase('en');

const token = () => crypto.randomBytes(16).toString('hex');

export const realClock = {
  now: () => performance.now(),
  after: (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
};

export function createGame({ exam, topics = [], questions, lessons = null, config, code, clock = realClock, random = Math.random, onChange = () => {} }) {
  const cfg = {
    topicIds: Array.isArray(config.topicIds) ? config.topicIds : [],
    count: config.count,
    seconds: config.seconds,
    allowLate: !!config.allowLate,
    autoEnd: config.autoEnd !== false,
    advance: config.advance === undefined ? 'manual' : config.advance,
    study: !!config.study,
  };
  cfg.board = config.board === undefined ? !cfg.study : !!config.board;      // the leaderboard between rounds: on for a quiz, off by default for a study game
  if (!ADVANCE.includes(cfg.advance)) throw new Error('Pick manual, auto or vote.');
  if (!SECONDS.includes(cfg.seconds)) throw new Error('Pick 10, 20 or 30 seconds.');
  let pool = [], parts = [];
  if (cfg.study) {
    if (!lessons) throw new Error('This exam has no lessons to study together.');
    if (!cfg.topicIds.length) throw new Error('Pick at least one topic to study.');
    parts = studyParts({ lessons, topics, questions, topicIds: cfg.topicIds });
    if (!parts.length) throw new Error('No lesson parts with a usable question match these topics.');
    cfg.count = parts.length;
  } else {
    if (!COUNTS.includes(cfg.count)) throw new Error('Pick 5, 10 or 20 questions.');
    pool = eligibleQuestions(questions, cfg.topicIds);
    if (!pool.length) throw new Error('No multiple choice or true/false questions match these topics.');
  }
  const limitMs = cfg.seconds * 1000;
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;

  const shuffled = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  /** One question as the game uses it: option order is fixed here, once, for everybody. */
  const prepare = (q) => {
    let options, correct;
    if (q.type === 'tf') { options = ['True', 'False']; correct = q.answer ? 0 : 1; } else {
      const order = q.options.map((_, i) => i);
      const used = q.fixedOrder ? order : shuffled(order);
      options = used.map((i) => q.options[i]);
      correct = used.indexOf(q.answer);
    }
    const doc = exam.documents?.[q.src?.[0]];
    const source = doc ? `${doc.label}, ${q.src[1]}` : (q.src || []).join(', ');
    return { id: q.id, type: q.type, topic: topicTitle(q.topic), text: q.question, options, correct, explanation: q.explanation || '', source };
  };
  const pick = () => (cfg.study ? parts.map((p) => ({ ...prepare(p.q), lesson: p.lesson })) : shuffled(pool).slice(0, cfg.count).map(prepare));

  let rounds = pick();
  let phase = 'lobby';
  let paused = false;
  let qIndex = -1;
  let deadline = 0, remaining = 0, readyUntil = 0;
  let cancelTimer = null;
  let rev = 0;
  let reveal = null;         // { counts, correct, ... } for the current question, set at the reveal
  let board = null;          // standings captured at the last reveal
  let advanceAt = 0;         // auto mode: when the answer or the leaderboard moves on by itself (0 = not scheduled)
  let votes = new Set();     // vote mode: ids of the players who said they read the answer
  const players = new Map();       // id -> player
  const byToken = new Map();       // token -> id

  const changed = () => { rev++; onChange(); };
  const clear = () => { if (cancelTimer) { cancelTimer(); cancelTimer = null; } };
  const timer = (ms, fn) => { clear(); cancelTimer = clock.after(ms, () => { cancelTimer = null; fn(); }); };

  const round = () => rounds[qIndex];
  const remainingMs = () => (phase === 'question' ? (paused ? remaining : Math.max(0, deadline - clock.now())) : 0);
  const here = (p) => !p.left;
  const isLive = (p) => p.connected || clock.now() - p.seen < LIMITS.awayMs;
  const live = () => [...players.values()].filter((p) => here(p) && p.connected);

  // ------------------------------------------------------------ players
  function find(tok) { const id = byToken.get(tok); return id ? players.get(id) : null; }
  function newPlayer(nick, extra = {}) {
    const p = { id: crypto.randomBytes(4).toString('hex'), token: token(), nick, key: nickKey(nick), connected: false, left: false, isHost: false,
      seen: -Infinity, lastSeen: clock.now(), score: 0, streak: 0, totalMs: 0, rank: null, prevRank: null, cur: null, last: null, history: {}, joinedAt: clock.now(), ...extra };
    players.set(p.id, p); byToken.set(p.token, p.id);
    return p;
  }

  /** Join, or take a seat back. Returns { ok, player, rejoined } or { error, message }. */
  function join({ nick: raw, token: tok, isHost = false }) {
    if (tok) { const known = find(tok); if (known && here(known)) { known.seen = known.lastSeen = clock.now(); return { ok: true, player: known, rejoined: true }; } }
    const nick = cleanNick(raw);
    if (!nick) return { error: 'nick', message: `Pick a nickname of 1 to ${LIMITS.nickMax} characters.` };
    if (phase === 'podium') return { error: 'over', message: 'This game is over.' };
    const same = [...players.values()].find((p) => p.key === nickKey(nick));
    if (same && here(same) && isLive(same)) return { error: 'taken', message: 'That nickname is taken. Pick another one.' };
    if (same) {   // the seat is empty (disconnected, or the player left): the same nickname takes it back, with its points
      byToken.delete(same.token); same.token = token(); byToken.set(same.token, same.id);
      same.left = false; same.seen = same.lastSeen = clock.now(); changed();
      return { ok: true, player: same, rejoined: true };
    }
    if (phase !== 'lobby' && !cfg.allowLate) return { error: 'started', message: 'The game has already started.' };
    if (players.size >= LIMITS.maxPlayers) return { error: 'full', message: 'This game is full.' };
    const p = newPlayer(nick, { isHost });
    p.seen = isHost ? -Infinity : clock.now();
    changed();
    return { ok: true, player: p, rejoined: false };
  }

  /** A phone's stream opened (true) or went away (false). */
  function setConnected(tok, on) {
    const p = find(tok);
    if (!p || !here(p) || p.connected === on) { if (p && on) p.seen = p.lastSeen = clock.now(); return; }
    p.lastSeen = clock.now();
    p.connected = on; p.seen = on ? clock.now() : -Infinity;   // once the stream is gone the seat is free to take back
    changed();
    if (!on) { maybeFinishEarly(); maybeAdvanceByVote(); }
  }

  function leave(tok) {
    const p = find(tok);
    if (!p) return false;
    byToken.delete(p.token);
    if (phase === 'lobby') players.delete(p.id); else { p.left = true; p.connected = false; }
    changed();
    maybeFinishEarly();
    maybeAdvanceByVote();
    return true;
  }
  function kick(id) {
    const p = players.get(id);
    if (!p) return null;
    byToken.delete(p.token); players.delete(id);
    changed(); maybeFinishEarly(); maybeAdvanceByVote();
    return p;
  }
  /** A seat nobody has been in for a long time (a closed tab). A locked phone is NOT stale: it comes back within keepMs. */
  const stale = (p) => !p.isHost && !p.connected && clock.now() - p.lastSeen > LIMITS.keepMs;
  /** Lobby only: drop players who closed their tab and never came back. */
  function sweep() {
    if (phase !== 'lobby') return;
    let any = false;
    for (const p of [...players.values()]) if (stale(p)) { byToken.delete(p.token); players.delete(p.id); any = true; }
    if (any) changed();
  }

  // ------------------------------------------------------------ flow
  function start() {
    if (phase !== 'lobby') return { error: 'phase', message: 'The game has already started.' };
    sweep();
    if (!live().length) return { error: 'empty', message: 'Wait for at least one player to join.' };
    qIndex = -1;
    nextQuestion();
    return { ok: true };
  }

  function nextQuestion() {
    qIndex++;
    paused = false; reveal = null; advanceAt = 0; votes = new Set();
    for (const p of players.values()) p.cur = null;
    if (round().lesson) { phase = 'lesson'; arm(); changed(); } else beginReady();       // a study round starts with the lesson part
  }
  function beginReady() {
    phase = 'ready'; readyUntil = clock.now() + LIMITS.readyMs;
    timer(LIMITS.readyMs, openQuestion);
    changed();
  }
  function openQuestion() {
    phase = 'question'; paused = false;
    deadline = clock.now() + limitMs;
    timer(limitMs + LIMITS.graceMs, finishQuestion);
    changed();
  }

  function answer({ token: tok, q, choice }) {
    const p = find(tok);
    if (!p || !here(p)) return { error: 'player' };
    if (phase !== 'question' || paused) return { error: 'closed' };
    if (q !== qIndex) return { error: 'closed' };
    if (p.cur) return { error: 'dup' };
    if (!Number.isInteger(choice) || choice < 0 || choice >= round().options.length) return { error: 'choice' };
    const now = clock.now();
    if (now > deadline + LIMITS.graceMs) return { error: 'late' };
    p.cur = { choice, timeLeftMs: Math.max(0, deadline - now) };
    changed();
    maybeFinishEarly();
    return { ok: true };
  }

  function maybeFinishEarly() {
    if (phase !== 'question' || paused || !cfg.autoEnd) return;
    const l = live();
    if (l.length && l.every((p) => p.cur)) finishQuestion();
  }

  /** The question is over (time, everyone answered, or the host skipped): score it and show the answer. */
  function finishQuestion() {
    if (phase !== 'question') return;
    clear(); paused = false;
    const r = round();
    const counts = r.options.map(() => 0);
    for (const p of players.values()) {
      if (!here(p) && !p.cur) { p.last = null; continue; }
      const c = p.cur;
      const correct = !!c && c.choice === r.correct;
      p.history[qIndex] = correct ? 'right' : c ? 'wrong' : 'none';          // for the "parts to revisit" list of a study game
      const { points, bonus } = scoreAnswer({ correct, timeLeftMs: c?.timeLeftMs ?? 0, limitMs, streakBefore: p.streak });
      if (c) counts[c.choice]++;
      if (correct) { p.score += points + bonus; p.streak++; p.totalMs += limitMs - c.timeLeftMs; } else p.streak = 0;
      p.last = { answered: !!c, choice: c ? c.choice : null, correct, points, bonus, streak: p.streak };
    }
    board = standings();
    for (const e of board) { const p = players.get(e.id); p.prevRank = p.rank; p.rank = e.rank; }
    reveal = { counts, correct: r.correct, explanation: r.explanation, source: r.source };
    phase = 'reveal';
    arm();
    changed();
  }

  /** Ranks: score, then the less time spent on correct answers, then name. */
  function standings() {
    const list = [...players.values()].sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.nick.localeCompare(b.nick));
    return list.map((p, i) => ({ id: p.id, rank: i + 1, delta: p.rank == null ? 0 : p.rank - (i + 1) }));
  }

  /**
   * From the reveal to the leaderboard (or the podium after the last question), from the leaderboard to the next question.
   * The host can always press it, whatever the mode; auto mode calls it from a timer and vote mode when everybody is ready.
   */
  function next() {
    if (phase === 'lesson') { clear(); advanceAt = 0; beginReady(); }
    else if (phase === 'reveal') {
      if (qIndex >= rounds.length - 1) { phase = 'podium'; clear(); advanceAt = 0; changed(); }
      else if (cfg.board) { phase = 'board'; arm(); changed(); }
      else nextQuestion();                                  // no leaderboard between rounds: straight on
    } else if (phase === 'board') nextQuestion();
    else return { error: 'phase' };
    return { ok: true };
  }

  /**
   * Sets up what moves the game on from the reveal or the leaderboard, for the current mode.
   * manual: nothing, the host presses Next. auto: a timer (reading time from the explanation on the reveal, a fixed time on the leaderboard).
   * vote: the reveal waits until every connected player has said they read it; the leaderboard (nothing to read) moves on after a fixed time.
   */
  function arm() {
    if (phase !== 'reveal' && phase !== 'board' && phase !== 'lesson') return;
    clear(); advanceAt = 0; votes = new Set();                // every lesson part and every answer gets its own, fresh vote
    if (cfg.advance === 'manual') return;
    if ((phase === 'reveal' || phase === 'lesson') && cfg.advance === 'vote') { maybeAdvanceByVote(); return; }
    const ms = phase === 'lesson' ? lessonMs(round().lesson) : phase === 'reveal' ? revealMs(round().explanation) : PACE.boardMs;
    advanceAt = clock.now() + ms;
    timer(ms, next);
  }
  /** Vote mode, at the reveal: when every connected player is ready, move on. */
  function maybeAdvanceByVote() {
    if ((phase !== 'reveal' && phase !== 'lesson') || cfg.advance !== 'vote') return;
    const l = live();
    if (l.length && l.every((p) => votes.has(p.id))) next();
  }
  /** A player says they read the answer and the explanation (vote mode, at the reveal). */
  function ready(tok) {
    const p = find(tok);
    if (!p || !here(p)) return { error: 'player' };
    if ((phase !== 'reveal' && phase !== 'lesson') || cfg.advance !== 'vote') return { error: 'closed' };
    if (!votes.has(p.id)) { votes.add(p.id); changed(); }
    maybeAdvanceByVote();
    return { ok: true };
  }
  /** Host: change the mode, also in the middle of a game. Takes effect right away on the reveal or the leaderboard. */
  function setAdvance(mode) {
    if (!ADVANCE.includes(mode)) return { error: 'mode', message: 'Pick manual, auto or vote.' };
    cfg.advance = mode;
    if (phase === 'reveal' || phase === 'lesson') votes = new Set();
    arm();
    changed();
    return { ok: true };
  }
  /** Host: end the question now (the answers so far count), or jump past the "get ready" splash. */
  function skip() {
    if (phase === 'question') finishQuestion();
    else if (phase === 'lesson') return next();
    else if (phase === 'ready') { clear(); openQuestion(); } else return { error: 'phase' };
    return { ok: true };
  }
  function pause() {
    if (phase !== 'question' || paused) return { error: 'phase' };
    remaining = Math.max(0, deadline - clock.now()); paused = true; clear(); changed();
    return { ok: true };
  }
  function resume() {
    if (phase !== 'question' || !paused) return { error: 'phase' };
    paused = false; deadline = clock.now() + remaining;
    timer(remaining + LIMITS.graceMs, finishQuestion);
    changed();
    maybeFinishEarly();
    return { ok: true };
  }
  /** Host: new questions, same players and code, scores back to zero. */
  function again() {
    if (phase !== 'podium') return { error: 'phase' };
    clear();
    for (const p of [...players.values()]) {
      if (p.left || stale(p)) { byToken.delete(p.token); players.delete(p.id); continue; }
      Object.assign(p, { score: 0, streak: 0, totalMs: 0, rank: null, prevRank: null, cur: null, last: null, history: {} });
    }
    rounds = pick(); phase = 'lobby'; qIndex = -1; reveal = null; board = null; paused = false;
    changed();
    return { ok: true };
  }
  function destroy() { clear(); }

  // ------------------------------------------------------------ views
  const nameOf = (id) => players.get(id)?.nick;
  const examInfo = { id: exam.id, title: exam.title, shortTitle: exam.shortTitle || exam.title, accent: exam.accent };
  const progressInfo = () => ({ index: qIndex, total: rounds.length });
  const roster = () => [...players.values()].sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ id: p.id, nick: p.nick, connected: p.connected, away: here(p) && !p.connected, left: p.left, isHost: p.isHost }));

  /**
   * Study game, at the end: the lesson parts somebody missed, the worst first (the share of players who missed it, then lesson order).
   * Each has the question and its answer (the game is over, nothing is secret now). With a player given, 'you' says how that player did.
   */
  function revisitList(p) {
    if (!cfg.study) return undefined;
    const out = [];
    rounds.forEach((r, i) => {
      if (!r.lesson) return;
      const seen = [...players.values()].filter((x) => !x.left && x.history[i]);
      if (!seen.length) return;
      const right = seen.filter((x) => x.history[i] === 'right').length;
      if (right === seen.length) return;
      out.push({ index: i, topic: r.lesson.topic, title: r.lesson.title, part: r.lesson.part, parts: r.lesson.parts, right, of: seen.length,
        question: r.text, answer: r.options[r.correct], explanation: r.explanation, ...(p ? { you: p.history[i] || null } : {}) });
    });
    return out.sort((a, b) => (a.right / a.of) - (b.right / b.of) || a.index - b.index);
  }

  function questionBlock() {
    const r = round();
    return { index: qIndex, total: rounds.length, type: r.type, topic: r.topic, text: r.text, options: r.options, limitMs };
  }
  function boardRows(max) {
    return (board || []).filter((e) => players.has(e.id)).slice(0, max).map((e) => { const p = players.get(e.id); return { id: e.id, nick: p.nick, score: p.score, gain: p.last ? p.last.points + p.last.bonus : 0, rank: e.rank, delta: e.delta, away: !p.connected, left: p.left }; });
  }

  /** What moves the game on from the reveal and the leaderboard, for the screens (mode, time left, and in vote mode how many are ready). */
  function advanceInfo(p) {
    if (phase !== 'reveal' && phase !== 'board' && phase !== 'lesson') return undefined;
    const info = { mode: cfg.advance, remainingMs: advanceAt ? Math.max(0, advanceAt - clock.now()) : 0 };
    if (cfg.advance === 'vote' && (phase === 'reveal' || phase === 'lesson')) {
      const l = live();
      info.ready = l.filter((x) => votes.has(x.id)).length; info.of = l.length;
      if (p) info.you = votes.has(p.id);
    }
    return info;
  }

  function base(extra) {
    return { rev, code, phase, paused, exam: examInfo, settings: { count: rounds.length, seconds: cfg.seconds, allowLate: cfg.allowLate, advance: cfg.advance, study: cfg.study, board: cfg.board }, ...extra };
  }

  /** What the big screen may show. */
  function hostView() {
    const v = base({ players: roster(), progress: progressInfo() });
    if (phase === 'lesson') { v.q = { index: qIndex, total: rounds.length }; v.lesson = round().lesson; }
    if (phase === 'ready') { v.readyMs = Math.max(0, readyUntil - clock.now()); v.q = { index: qIndex, total: rounds.length, topic: round().topic }; }
    if (phase === 'question') {
      v.q = questionBlock(); v.remainingMs = remainingMs();
      const l = live(); v.answered = l.filter((p) => p.cur).length; v.of = l.length;
    }
    if (phase === 'reveal') { v.q = questionBlock(); v.reveal = { ...reveal, answered: [...players.values()].filter((p) => p.last?.answered).length }; v.last = qIndex >= rounds.length - 1; }
    if (phase === 'board') v.board = boardRows(BOARD_SIZE);
    if (phase === 'podium') { v.podium = boardRows(Infinity); const rv = revisitList(null); if (rv) v.revisit = rv; }
    const adv = advanceInfo(null); if (adv) v.advance = adv;
    return v;
  }

  /** What one phone may see. */
  function playerView(tok) {
    const p = find(tok);
    if (!p || !here(p)) return null;
    const v = base({ progress: progressInfo(), you: { id: p.id, nick: p.nick, isHost: p.isHost }, players: roster().filter((x) => !x.left).map((x) => ({ id: x.id, nick: x.nick, away: x.away })) });
    if (phase === 'lesson') { v.q = { index: qIndex, total: rounds.length }; v.lesson = round().lesson; }
    if (phase === 'ready') { v.readyMs = Math.max(0, readyUntil - clock.now()); v.q = { index: qIndex, total: rounds.length }; }
    if (phase === 'question') { v.q = questionBlock(); v.remainingMs = remainingMs(); v.choice = p.cur ? p.cur.choice : null; }
    if (phase === 'reveal') {
      v.q = questionBlock(); v.last = qIndex >= rounds.length - 1;
      v.reveal = { ...reveal, you: p.last ? { ...p.last, score: p.score, rank: p.rank, delta: p.rank == null || p.prevRank == null ? 0 : p.prevRank - p.rank, of: players.size } : null };
    }
    if (phase === 'board') v.board = boardRows(BOARD_SIZE);
    if (phase === 'board' || phase === 'podium') v.you = { ...v.you, score: p.score, rank: p.rank, of: players.size };
    if (phase === 'podium') { v.podium = boardRows(3); const rv = revisitList(p); if (rv) v.revisit = rv; }
    const adv = advanceInfo(p); if (adv) v.advance = adv;
    return v;
  }

  return {
    code, config: cfg, join, setConnected, leave, kick, sweep, start, skip, next, ready, setAdvance, pause, resume, again, answer, destroy,
    hostView, playerView, find, nameOf,
    get phase() { return phase; }, get rev() { return rev; },
    playerCount: () => [...players.values()].filter(here).length,
    // test hooks
    _rounds: () => rounds,
  };
}
