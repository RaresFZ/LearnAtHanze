// Live Quiz hub: owns the one game, the two kinds of live streams (host screen, phones) and the PLAY SERVER.
//
// Two separate servers on purpose:
//   - the host server (server.js, 127.0.0.1:3737) has the whole app, the content and the host controls;
//   - the play server (this file, port 3738) listens on the local network only while a game is hosted and serves a short
//     allow-list of files plus /live/*. Phones cannot even connect to 3737, so they can never fetch course content,
//     the solo app's data or the sources folder, whatever path they ask for.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGame, cleanNick } from './engine.js';
import { lanAddresses } from './lan.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const T = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', json: 'application/json; charset=utf-8' };

// The ONLY files a phone can fetch (besides /live/*). Everything else is a 404.
const PLAY_FILES = {
  '/': ['play/index.html', T.html, false],
  '/play.js': ['play/play.js', T.js, false],
  '/theme.js': ['play/theme.js', T.js, false],
  '/rounds.js': ['play/rounds.js', T.js, false],
  '/css/style.css': ['css/style.css', T.css, false],
  '/css/live.css': ['css/live.css', T.css, false],
  '/js/fx.js': ['js/fx.js', T.js, false],
  '/js/icons.js': ['js/icons.js', T.js, false],
  '/js/util.js': ['js/util.js', T.js, false],
  '/js/live-shared.js': ['js/live-shared.js', T.js, false],
  '/vendor/motion.js': ['vendor/motion.js', T.js, true],
  '/fonts/bricolage.woff2': ['fonts/bricolage.woff2', T.woff2, true],
  '/fonts/geist.woff2': ['fonts/geist.woff2', T.woff2, true],
  '/fonts/geist-mono.woff2': ['fonts/geist-mono.woff2', T.woff2, true],
};
export const PLAY_ALLOWLIST = Object.keys(PLAY_FILES);

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY, ...extra });
  res.end(body);
};
const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), T.json);

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

function readJson(req, max = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); resolve(v && typeof v === 'object' ? v : {}); } catch { reject(new HttpError(400, 'Bad JSON')); } });
    req.on('error', reject);
  });
}

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SECURITY,
  });
  res.socket?.setNoDelay(true);
  res.write('retry: 2000\n\n');
}
const push = (res, data) => { try { res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`); } catch { /* the stream is closing */ } };

const IDLE_END_MS = 3 * 60 * 60 * 1000;
const DROP_AFTER_MS = 4000;     // a phone whose stream vanished is shown as "away" after this (a page refresh reconnects well before)
const HEARTBEAT_MS = Number(process.env.LIVE_HEARTBEAT_MS) || 10000;   // keeps streams alive through proxies and lets clients notice a dead one
const POLL_HOLD_MS = Number(process.env.LIVE_POLL_HOLD_MS) || 20000;   // how long a long-poll request waits for news
const HOST_AWAY_MS = Number(process.env.LIVE_HOST_AWAY_MS) || 6000;      // phones are told "the host is away" after the host screen has been gone this long
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

export function createHub({ loadExam, hostPort, playPort }) {
  let game = null, examId = null;
  let server = null, listenError = null;
  const lan = { enabled: true };
  let hostSeat = null;                 // { token, nick } when the host plays too
  const hostStreams = new Set();
  const playerStreams = new Map();     // token -> Set<res>
  const pollers = new Map();           // token -> Set<{ res, timer }>: phones on the long-poll fallback (streams do not survive some tunnels and proxies)
  const kicked = new Set();            // tokens of players the host removed (so the phone can say so)
  const dropTimers = new Map();        // token -> timer
  let publicUrl = null;                // https address of a tunnel the host typed in: used for the QR code and the address
  let hostGoneAt = 0, addrSig = '', heartbeat = null;
  let flushTimer = null, sweeper = null, lastActivity = Date.now();
  const hits = new Map();              // ip -> { n, reset } join attempts

  // ------------------------------------------------------------ output
  const net = () => {
    const addrs = lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${playPort}`, joinUrl: `http://${a.address}:${playPort}/?c=${game?.code}` }));
    return {
      port: playPort, lan: lan.enabled, listening: !!server?.listening, error: listenError, addresses: lan.enabled ? addrs : [], localUrl: `http://localhost:${playPort}`, lanForcedOff: process.env.LIVE_LAN === 'off',
      publicUrl, publicJoinUrl: publicUrl && game ? `${publicUrl}/?c=${game.code}` : null,
    };
  };
  const hostAway = () => !!game && hostStreams.size === 0 && Date.now() - hostGoneAt > HOST_AWAY_MS;
  /** What one phone is sent: its own view plus "the host screen is gone" and a tag the long-poll fallback compares. */
  function viewFor(tok) {
    const v = game.playerView(tok);
    if (!v) return null;
    const away = hostAway();
    return { ...v, hostAway: away, tag: `${v.rev}.${away ? 1 : 0}` };
  }
  /** Why a phone's token does not work (or null when it does). Same wording for streams and polls. */
  function goneMessage(tok, code) {
    if (!game) return { gone: true, noGame: true, message: 'There is no game running any more. If the host restarted the app, ask them for the new code.' };
    if (code && code !== game.code) return { gone: true, noGame: true, message: 'That game has ended. If the host started a new one, type its new code.' };
    if (!game.find(tok)) return { gone: true, message: kicked.has(tok) ? 'The host removed you from this game.' : 'You are no longer in this game. Join again with your nickname.' };
    return null;
  }
  const hasConn = (tok) => (playerStreams.get(tok)?.size || 0) + (pollers.get(tok)?.size || 0) > 0;
  function connected(tok) { clearTimeout(dropTimers.get(tok)); dropTimers.delete(tok); game?.setConnected(tok, true); }
  /** A stream or poll of this phone ended. If it has none left, it counts as away after a short grace (a refresh reconnects before that). */
  function released(tok) {
    if (!game || hasConn(tok)) return;
    clearTimeout(dropTimers.get(tok));
    dropTimers.set(tok, setTimeout(() => { dropTimers.delete(tok); if (!hasConn(tok)) game?.setConnected(tok, false); }, DROP_AFTER_MS));
  }
  const hostPayload = () => ({
    ...game.hostView(), net: net(),
    seat: hostSeat ? { nick: hostSeat.nick, url: `http://localhost:${playPort}/#c=${game.code}&t=${hostSeat.token}` } : null,
  });
  const scheduleFlush = () => { lastActivity = Date.now(); if (!flushTimer) flushTimer = setTimeout(flush, 30); };
  function flush() {
    flushTimer = null;
    if (!game) return;
    const hs = JSON.stringify(hostPayload());
    for (const res of hostStreams) push(res, hs);
    for (const [tok, set] of playerStreams) {
      const v = viewFor(tok);
      for (const res of set) {
        if (v) push(res, v); else { push(res, goneMessage(tok, '') || { gone: true, message: 'You are no longer in this game.' }); res.end(); }
      }
      if (!v) playerStreams.delete(tok);
    }
    for (const [tok, set] of [...pollers]) {
      const m = viewFor(tok) || goneMessage(tok, '');
      for (const e of [...set]) endPoll(tok, e, m);
    }
  }
  function endPoll(tok, entry, data) {
    clearTimeout(entry.timer);
    const set = pollers.get(tok);
    if (set) { set.delete(entry); if (!set.size) pollers.delete(tok); }
    if (!entry.res.writableEnded) sendJson(entry.res, 200, data);
    released(tok);
  }

  // ------------------------------------------------------------ the play server
  async function listen() {
    // LIVE_LAN=off: never open the network (loopback only). LIVE_LAN=loopback: test mode, loopback only but still reports the LAN address (for screenshots and QR tests).
    const mode = process.env.LIVE_LAN;
    const host = lan.enabled && mode !== 'off' && mode !== 'loopback' ? '0.0.0.0' : '127.0.0.1';
    if (mode !== 'loopback') lan.enabled = host === '0.0.0.0';
    server = http.createServer((req, res) => handlePlay(req, res).catch((e) => {
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.code || 'error', message: e.status ? e.message : 'Something went wrong.' }); else res.end();
    }));
    server.on('connection', (s) => s.setKeepAlive(true, 10000));
    listenError = null;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(playPort, host, () => { server.off('error', reject); resolve(); }); });
    } catch (e) {
      server = null;
      listenError = e.code === 'EADDRINUSE'
        ? `Port ${playPort} is already in use, probably by a second copy of this app or a game you left running. Close it and try again, or start the app with another play port (PLAY_PORT=${playPort + 10}).`
        : e.message;
      throw new HttpError(409, listenError, 'port');
    }
    server.on('error', (e) => console.error('Live Quiz play server:', e.message));
  }
  async function stopListening() {
    const s = server; server = null;
    if (!s) return;
    s.closeAllConnections?.();
    await new Promise((r) => s.close(() => r()));
  }

  /** Who is asking. A tunnel connects from this computer, so for connections from here we trust the address the tunnel reports. */
  function clientIp(req) {
    const ip = req.socket.remoteAddress || '';
    if (!isLoopback(ip)) return ip;
    const fwd = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd ? String(fwd).slice(0, 64) : ip;
  }
  const limited = (req) => {
    const ip = clientIp(req);
    if (isLoopback(ip)) return false;   // the laptop itself (and the tests)
    const now = Date.now(); const h = hits.get(ip);
    if (!h || now > h.reset) { hits.set(ip, { n: 1, reset: now + 60000 }); return false; }
    return ++h.n > 30;
  };

  async function handlePlay(req, res) {
    const url = new URL(req.url, 'http://play');
    const p = url.pathname;
    if (req.method === 'GET' && PLAY_FILES[p]) {
      const [file, type, cache] = PLAY_FILES[p];
      return send(res, 200, await fs.readFile(path.join(APP, file)), type, cache ? { 'Cache-Control': 'public, max-age=3600' } : {});
    }
    if (req.method === 'GET' && p === '/live/events') return playerStream(req, res, url.searchParams.get('t') || '', url.searchParams.get('c') || '');
    if (req.method === 'GET' && p === '/live/state') return playerPoll(req, res, url);
    if (req.method === 'POST' && (p === '/live/join' || p === '/live/answer' || p === '/live/leave')) {
      const body = await readJson(req);
      if (p === '/live/join') return sendJson(res, 200, join(req, body));
      if (p === '/live/answer') return sendJson(res, 200, answer(body));
      return sendJson(res, 200, { ok: !!game?.leave(String(body.t || '')) });
    }
    send(res, 404, 'Not found');
  }

  function join(req, body) {
    if (limited(req)) throw new HttpError(429, 'Too many tries. Wait a minute.', 'slow');
    if (!game) throw new HttpError(404, 'There is no game running right now.', 'nogame');
    if (String(body.code || '').trim() !== game.code) throw new HttpError(404, 'No game with that code. Check the number on the big screen.', 'code');
    const r = game.join({ nick: body.nick, token: typeof body.token === 'string' ? body.token : undefined });
    if (r.error) throw new HttpError(r.error === 'nick' ? 400 : 409, r.message, r.error);
    return { token: r.player.token, nick: r.player.nick, rejoined: r.rejoined };
  }
  function answer(body) {
    if (!game) throw new HttpError(404, 'No game.', 'nogame');
    const r = game.answer({ token: String(body.t || ''), q: body.q, choice: body.choice });
    if (r.error) throw new HttpError(409, 'Not accepted.', r.error);
    return { ok: true };
  }

  function playerStream(req, res, tok, code) {
    openStream(res);
    if (process.env.LIVE_SSE === 'off') return;   // test hook: behave like a proxy that swallows event streams
    const gone = goneMessage(tok, code);
    if (gone) { push(res, gone); return res.end(); }
    let set = playerStreams.get(tok);
    if (!set) playerStreams.set(tok, (set = new Set()));
    set.add(res);
    connected(tok);
    push(res, viewFor(tok));
    req.on('close', () => {
      set.delete(res);
      if (!set.size && playerStreams.get(tok) === set) playerStreams.delete(tok);
      released(tok);
    });
  }

  /** Long-poll fallback for networks where event streams do not arrive: answers at once when the phone's tag is out of date, else waits for news. */
  function playerPoll(req, res, url) {
    const tok = url.searchParams.get('t') || '', tag = url.searchParams.get('tag') || '';
    const gone = goneMessage(tok, url.searchParams.get('c') || '');
    if (gone) return sendJson(res, 200, gone);
    connected(tok);
    const v = viewFor(tok);
    if (v.tag !== tag) { sendJson(res, 200, v); return released(tok); }
    const entry = { res, timer: null };
    entry.timer = setTimeout(() => endPoll(tok, entry, { ping: true, tag }), POLL_HOLD_MS);
    let set = pollers.get(tok);
    if (!set) pollers.set(tok, (set = new Set()));
    set.add(entry);
    req.on('close', () => { clearTimeout(entry.timer); set.delete(entry); if (!set.size && pollers.get(tok) === set) pollers.delete(tok); released(tok); });
  }

  // ------------------------------------------------------------ the host
  async function create(cfg) {
    if (game) throw new HttpError(409, 'A live game is already running. End it first.', 'busy');
    if (typeof cfg.examId !== 'string' || !/^[a-z0-9-]+$/.test(cfg.examId)) throw new HttpError(400, 'Unknown exam.');
    let data;
    try { data = await loadExam(cfg.examId); } catch (e) { throw new HttpError(e.code === 'ENOENT' ? 404 : 500, e.code === 'ENOENT' ? 'Unknown exam.' : e.message); }
    const code = String(crypto.randomInt(10000, 100000));
    let g;
    try {
      g = createGame({
        exam: data.exam, topics: data.topics, questions: data.questions, code, onChange: scheduleFlush,
        config: { topicIds: cfg.topicIds, count: cfg.count, seconds: cfg.seconds, allowLate: cfg.allowLate },
      });
    } catch (e) { throw new HttpError(400, e.message); }
    if (cfg.hostPlays) {
      if (!cleanNick(cfg.hostNick)) { g.destroy(); throw new HttpError(400, 'Pick a nickname for yourself (1 to 16 characters).', 'nick'); }
      const r = g.join({ nick: cfg.hostNick, isHost: true });
      hostSeat = { token: r.player.token, nick: r.player.nick };
    }
    game = g; examId = cfg.examId; lan.enabled = true; lastActivity = Date.now();
    publicUrl = null; kicked.clear(); hostGoneAt = Date.now(); addrSig = JSON.stringify(lanAddresses());
    try { await listen(); } catch (e) { game.destroy(); game = null; examId = null; hostSeat = null; throw e; }
    heartbeat = setInterval(() => {
      for (const res of [...hostStreams, ...[...playerStreams.values()].flatMap((x) => [...x])]) { try { res.write('event: ping\ndata: 1\n\n'); } catch { /* closing */ } }
    }, HEARTBEAT_MS);
    sweeper = setInterval(() => {
      game?.sweep();
      for (const [ip, h] of hits) if (Date.now() > h.reset) hits.delete(ip);
      const sig = JSON.stringify(lanAddresses());      // the laptop joined another Wi-Fi or a hotspot: show the new address
      if (game && sig !== addrSig) { addrSig = sig; scheduleFlush(); }
      if (game && Date.now() - lastActivity > IDLE_END_MS && !hostStreams.size) end();
    }, 5000);
    console.log(`Live Quiz hosted (${data.exam.title}), code ${code}. ${lan.enabled ? 'Phones can join at ' + (net().addresses.map((a) => a.url).join(' or ') || 'this computer only (no network address found)') : 'Listening on this computer only.'}`);
    return hostPayload();
  }

  async function end() {
    if (!game) return;
    for (const res of [...hostStreams, ...[...playerStreams.values()].flatMap((s) => [...s])]) { push(res, { ended: true }); res.end(); }
    for (const set of pollers.values()) for (const e of set) { clearTimeout(e.timer); if (!e.res.writableEnded) sendJson(e.res, 200, { ended: true }); }
    hostStreams.clear(); playerStreams.clear(); pollers.clear(); kicked.clear();
    for (const t of dropTimers.values()) clearTimeout(t);
    dropTimers.clear(); clearTimeout(flushTimer); flushTimer = null; clearInterval(sweeper); clearInterval(heartbeat);
    game.destroy(); game = null; examId = null; hostSeat = null; publicUrl = null;
    await stopListening();
    console.log('Live Quiz ended. The play port is closed.');
  }

  async function setLan(on) {
    if (!game) throw new HttpError(404, 'No game running.');
    lan.enabled = !!on;
    await stopListening();
    try { await listen(); } catch { /* listenError is set and shown on the host screen */ }
    console.log(on ? 'Live Quiz: phones can join again.' : 'Live Quiz: phones blocked. Only this computer can reach the game.');
    scheduleFlush();
  }

  /** The address of a tunnel the host typed in: only the origin is kept (no path, no login, no query). */
  function cleanPublicUrl(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    let text = String(raw).trim().slice(0, 300);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
    const bad = new HttpError(400, 'That is not a web address. Paste it like https://something.example.com', 'url');
    let u;
    try { u = new URL(text); } catch { throw bad; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || !u.hostname.includes('.')) throw bad;
    return u.origin;
  }

  async function action({ action: a, id, on, url }) {
    if (!game) throw new HttpError(404, 'No game running.', 'nogame');
    lastActivity = Date.now();
    let r = { ok: true };
    switch (a) {
      case 'start': r = game.start(); break;
      case 'pause': r = game.pause(); break;
      case 'resume': r = game.resume(); break;
      case 'skip': r = game.skip(); break;
      case 'next': r = game.next(); break;
      case 'again': r = game.again(); break;
      case 'kick': { const p = game.kick(String(id || '')); if (p) kicked.add(p.token); r = p ? { ok: true } : { error: 'player' }; break; }
      case 'lan': await setLan(on); break;
      case 'public': publicUrl = cleanPublicUrl(url); scheduleFlush(); break;
      case 'end': await end(); break;
      default: throw new HttpError(400, 'Unknown action.');
    }
    if (r.error) throw new HttpError(409, r.message || 'Not possible right now.', r.error);
    return { ok: true };
  }

  function hostStream(req, res) {
    openStream(res);
    if (!game) { push(res, { ended: true }); return res.end(); }
    hostStreams.add(res);
    push(res, hostPayload());
    scheduleFlush();                                   // phones: the host is back
    req.on('close', () => {
      hostStreams.delete(res);
      if (!hostStreams.size) { hostGoneAt = Date.now(); setTimeout(scheduleFlush, HOST_AWAY_MS + 100); }
    });
  }

  /** The host API under /api/live/ (called by server.js, which is bound to this computer only). */
  async function handleHost(req, res, pathname) {
    const okHost = [`localhost:${hostPort}`, `127.0.0.1:${hostPort}`];
    if (!okHost.includes(req.headers.host || '')) return sendJson(res, 403, { error: 'Forbidden' });
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && !okHost.some((h) => origin === `http://${h}`)) return sendJson(res, 403, { error: 'Forbidden' });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'Send JSON.' });
    }
    try {
      if (req.method === 'GET' && pathname === '/api/live/status') return sendJson(res, 200, game ? { active: true, examId, title: game.hostView().exam.title, phase: game.phase } : { active: false });
      if (req.method === 'GET' && pathname === '/api/live/events') return hostStream(req, res);
      if (req.method === 'POST' && pathname === '/api/live/create') return sendJson(res, 200, await create(await readJson(req, 4096)));
      if (req.method === 'POST' && pathname === '/api/live/action') return sendJson(res, 200, await action(await readJson(req)));
      return sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message, code: e.code });
    }
  }

  return { handleHost, end, status: () => ({ active: !!game }) };
}
