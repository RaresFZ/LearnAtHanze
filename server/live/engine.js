// Live Quiz game engine: ONE game, pure logic, no HTTP. The server is authoritative: it keeps the clock,
// checks answers and computes scores. Time comes from an injected clock so tests can drive it.
//
// Phases: lobby -> ready -> question (-> paused) -> reveal -> board -> ready ... -> podium.
// The views (what a host screen or a phone may see) are built in ONE place, `view()`, and the correct answer,
// the explanation and the source are only put in them from the reveal on.
import crypto from 'node:crypto';

// keepMs: how long a player whose phone went away (screen locked, tab closed) keeps their seat in the lobby and for Play again.
export const LIMITS = { maxPlayers: 30, nickMax: 16, readyMs: 2000, graceMs: 300, awayMs: 8000, keepMs: 5 * 60 * 1000 };
// Correct answer: base + speed x (time left / time limit). Streak bonus: stepPerStreak for each correct answer in a row before this one, capped.
export const SCORING = { base: 500, speed: 500, streakStep: 50, streakCap: 250 };
export const COUNTS = [5, 10, 20];
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

export function createGame({ exam, topics = [], questions, config, code, clock = realClock, random = Math.random, onChange = () => {} }) {
  const cfg = {
    topicIds: Array.isArray(config.topicIds) ? config.topicIds : [],
    count: config.count,
    seconds: config.seconds,
    allowLate: !!config.allowLate,
    autoEnd: config.autoEnd !== false,
  };
  if (!COUNTS.includes(cfg.count)) throw new Error('Pick 5, 10 or 20 questions.');
  if (!SECONDS.includes(cfg.seconds)) throw new Error('Pick 10, 20 or 30 seconds.');
  const pool = eligibleQuestions(questions, cfg.topicIds);
  if (!pool.length) throw new Error('No multiple choice or true/false questions match these topics.');
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
  const pick = () => shuffled(pool).slice(0, cfg.count).map(prepare);

  let rounds = pick();
  let phase = 'lobby';
  let paused = false;
  let qIndex = -1;
  let deadline = 0, remaining = 0, readyUntil = 0;
  let cancelTimer = null;
  let rev = 0;
  let reveal = null;         // { counts, correct, ... } for the current question, set at the reveal
  let board = null;          // standings captured at the last reveal
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
      seen: -Infinity, lastSeen: clock.now(), score: 0, streak: 0, totalMs: 0, rank: null, prevRank: null, cur: null, last: null, joinedAt: clock.now(), ...extra };
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
    if (!on) maybeFinishEarly();
  }

  function leave(tok) {
    const p = find(tok);
    if (!p) return false;
    byToken.delete(p.token);
    if (phase === 'lobby') players.delete(p.id); else { p.left = true; p.connected = false; }
    changed();
    maybeFinishEarly();
    return true;
  }
  function kick(id) {
    const p = players.get(id);
    if (!p) return null;
    byToken.delete(p.token); players.delete(id);
    changed(); maybeFinishEarly();
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
    paused = false; reveal = null;
    for (const p of players.values()) p.cur = null;
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
      const { points, bonus } = scoreAnswer({ correct, timeLeftMs: c?.timeLeftMs ?? 0, limitMs, streakBefore: p.streak });
      if (c) counts[c.choice]++;
      if (correct) { p.score += points + bonus; p.streak++; p.totalMs += limitMs - c.timeLeftMs; } else p.streak = 0;
      p.last = { answered: !!c, choice: c ? c.choice : null, correct, points, bonus, streak: p.streak };
    }
    board = standings();
    for (const e of board) { const p = players.get(e.id); p.prevRank = p.rank; p.rank = e.rank; }
    reveal = { counts, correct: r.correct, explanation: r.explanation, source: r.source };
    phase = 'reveal';
    changed();
  }

  /** Ranks: score, then the less time spent on correct answers, then name. */
  function standings() {
    const list = [...players.values()].sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.nick.localeCompare(b.nick));
    return list.map((p, i) => ({ id: p.id, rank: i + 1, delta: p.rank == null ? 0 : p.rank - (i + 1) }));
  }

  /** Host: from the reveal to the leaderboard (or the podium after the last question), from the leaderboard to the next question. */
  function next() {
    if (phase === 'reveal') {
      if (qIndex >= rounds.length - 1) { phase = 'podium'; clear(); changed(); } else { phase = 'board'; changed(); }
    } else if (phase === 'board') nextQuestion();
    else return { error: 'phase' };
    return { ok: true };
  }
  /** Host: end the question now (the answers so far count), or jump past the "get ready" splash. */
  function skip() {
    if (phase === 'question') finishQuestion();
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
      Object.assign(p, { score: 0, streak: 0, totalMs: 0, rank: null, prevRank: null, cur: null, last: null });
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

  function questionBlock() {
    const r = round();
    return { index: qIndex, total: rounds.length, type: r.type, topic: r.topic, text: r.text, options: r.options, limitMs };
  }
  function boardRows(max) {
    return (board || []).filter((e) => players.has(e.id)).slice(0, max).map((e) => { const p = players.get(e.id); return { id: e.id, nick: p.nick, score: p.score, gain: p.last ? p.last.points + p.last.bonus : 0, rank: e.rank, delta: e.delta, away: !p.connected, left: p.left }; });
  }

  function base(extra) {
    return { rev, code, phase, paused, exam: examInfo, settings: { count: rounds.length, seconds: cfg.seconds, allowLate: cfg.allowLate }, ...extra };
  }

  /** What the big screen may show. */
  function hostView() {
    const v = base({ players: roster(), progress: progressInfo() });
    if (phase === 'ready') { v.readyMs = Math.max(0, readyUntil - clock.now()); v.q = { index: qIndex, total: rounds.length, topic: round().topic }; }
    if (phase === 'question') {
      v.q = questionBlock(); v.remainingMs = remainingMs();
      const l = live(); v.answered = l.filter((p) => p.cur).length; v.of = l.length;
    }
    if (phase === 'reveal') { v.q = questionBlock(); v.reveal = { ...reveal, answered: [...players.values()].filter((p) => p.last?.answered).length }; v.last = qIndex >= rounds.length - 1; }
    if (phase === 'board') v.board = boardRows(BOARD_SIZE);
    if (phase === 'podium') v.podium = boardRows(Infinity);
    return v;
  }

  /** What one phone may see. */
  function playerView(tok) {
    const p = find(tok);
    if (!p || !here(p)) return null;
    const v = base({ progress: progressInfo(), you: { id: p.id, nick: p.nick, isHost: p.isHost }, players: roster().filter((x) => !x.left).map((x) => ({ id: x.id, nick: x.nick, away: x.away })) });
    if (phase === 'ready') { v.readyMs = Math.max(0, readyUntil - clock.now()); v.q = { index: qIndex, total: rounds.length }; }
    if (phase === 'question') { v.q = questionBlock(); v.remainingMs = remainingMs(); v.choice = p.cur ? p.cur.choice : null; }
    if (phase === 'reveal') {
      v.q = questionBlock(); v.last = qIndex >= rounds.length - 1;
      v.reveal = { ...reveal, you: p.last ? { ...p.last, score: p.score, rank: p.rank, delta: p.rank == null || p.prevRank == null ? 0 : p.prevRank - p.rank, of: players.size } : null };
    }
    if (phase === 'board') v.board = boardRows(BOARD_SIZE);
    if (phase === 'board' || phase === 'podium') v.you = { ...v.you, score: p.score, rank: p.rank, of: players.size };
    if (phase === 'podium') v.podium = boardRows(3);
    return v;
  }

  return {
    code, config: cfg, join, setConnected, leave, kick, sweep, start, skip, next, pause, resume, again, answer, destroy,
    hostView, playerView, find, nameOf,
    get phase() { return phase; }, get rev() { return rev; },
    playerCount: () => [...players.values()].filter(here).length,
    // test hooks
    _rounds: () => rounds,
  };
}
