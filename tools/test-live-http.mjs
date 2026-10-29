// Live Quiz over real HTTP: isolation of the play server, no answer leaks before the reveal, 15 simulated phones playing a full game,
// reconnection and rejoin, the long-poll fallback, a restarted server, a busy port. Starts its own server on spare ports with the LAN listener off (loopback only, so no firewall prompt).
// Run with: npm run test:live:http
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const HOST = 3757, PLAY = 3758;
const H = `http://127.0.0.1:${HOST}`, P = `http://127.0.0.1:${PLAY}`;     // not "localhost": on some machines it tries ::1 first and the servers listen on IPv4 only
let child;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, body, headers = {}) {
  const res = await fetch(url, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const act = (action, extra = {}) => json(`${H}/api/live/action`, { action, ...extra });

/** A server-sent-events client that keeps every message it ever received. */
class Stream {
  constructor(url) {
    this.url = url; this.msgs = []; this.pings = 0; this.ac = new AbortController(); this.closed = false;
    this.done = this.run();
  }
  async run() {
    try {
      const res = await fetch(this.url, { signal: this.ac.signal });
      const dec = new TextDecoder(); let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          if (block.startsWith('event: ping')) { this.pings++; continue; }     // heartbeat, not a game message
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (line) this.msgs.push(JSON.parse(line.slice(6)));
        }
      }
    } catch { /* aborted */ }
    this.closed = true;
  }
  get last() { return this.msgs.at(-1); }
  async until(fn, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.msgs.findLast(fn); if (m) return m; await sleep(20); }
    throw new Error(`timed out; last message: ${JSON.stringify(this.last)?.slice(0, 300)}`);
  }
  close() { this.ac.abort(); }
}

class Phone {
  constructor(nick) { this.nick = nick; }
  async join(code) { const r = await json(`${P}/live/join`, { code, nick: this.nick }); if (r.status === 200) { this.token = r.data.token; this.open(); } return r; }
  open() { this.stream = new Stream(`${P}/live/events?t=${this.token}`); }
  answer(q, choice) { return json(`${P}/live/answer`, { t: this.token, q, choice }); }
  phase(p) { return this.stream.until((m) => m.phase === p && !m.paused); }
}

// short timers so the heartbeat, the long-poll hold and the "host is away" notice can be tested in a second or two
async function boot() {
  child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(HOST), PLAY_PORT: String(PLAY), NO_OPEN: '1', LIVE_LAN: 'off', LIVE_HEARTBEAT_MS: '300', LIVE_POLL_HOLD_MS: '700', LIVE_HOST_AWAY_MS: '400' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 50; i++) { try { await fetch(`${H}/api/live/status`); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
}
before(boot);
after(async () => { await act('end').catch(() => {}); child.kill(); });

test('no play port while there is no game; host API refuses foreign pages', async () => {
  await assert.rejects(fetch(`${P}/`), /fetch failed/);
  const body = JSON.stringify({ action: 'end' });
  const raw = (headers, method = 'POST', path = '/api/live/action') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: HOST, path, method, headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(method === 'POST' ? body : undefined);
  });
  assert.equal(await raw({ Host: 'evil.example:3757', 'Content-Type': 'application/json' }), 403, 'DNS rebinding');
  assert.equal(await raw({ Host: `localhost:${HOST}`, Origin: 'http://evil.example', 'Content-Type': 'application/json' }), 403, 'cross-site page');
  assert.equal(await raw({ Host: `localhost:${HOST}`, 'Content-Type': 'text/plain' }), 415, 'no simple form posts');
});

test('a full game with 15 simulated phones', async () => {
  const create = await json(`${H}/api/live/create`, { examId: 'outsourcing-governance', topicIds: [], count: 5, seconds: 10, hostPlays: true, hostNick: 'Host' });
  assert.equal(create.status, 200, JSON.stringify(create.data));
  const code = create.data.code;
  assert.match(code, /^\d{5}$/);
  const hostStream = new Stream(`${H}/api/live/events`);
  const hostSeen = () => hostStream.msgs;

  // --- isolation: a phone can fetch only the play page's own files and /live/*
  for (const p of ['/api/exams', '/api/exams/lean-agile', '/api/live/status', '/content/lean-agile/questions.json', '/content/outsourcing-governance/sources/x.md',
    '/index.html', '/js/main.js', '/js/store.js', '/js/live.js', '/vendor/qrcode.js', '/server.js', '/package.json', '/HANDOFF.md', '/exams studies/', '/..%2fserver.js',
    '/%2e%2e/server.js', '/css/../js/main.js', '/play/play.js', '/play/rounds.js', '/js/live-rounds.js', '/js/live.js', '/fonts/../js/main.js', '/live/', '/live/status', '/live/stat', '/live/events/x', '//etc/passwd', '/.git/config']) {
    const res = await fetch(`${P}${p}`).catch(() => ({ status: 0 }));
    assert.equal(res.status, 404, `${p} must not be served to phones (got ${res.status})`);
  }
  for (const p of ['/', '/play.js', '/rounds.js', '/theme.js', '/js/live-shared.js', '/css/style.css', '/css/live.css', '/js/fx.js', '/vendor/motion.js', '/fonts/geist.woff2']) assert.equal((await fetch(`${P}${p}`)).status, 200, p);
  assert.equal((await json(`${P}/api/live/action`, { action: 'end' })).status, 404, 'host controls are not on the play server');
  assert.equal((await json(`${P}/api/live/create`, { examId: 'lean-agile' })).status, 404);
  const csp = (await fetch(`${P}/`)).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);

  // --- join rules
  assert.equal((await json(`${P}/live/join`, { code: '00000', nick: 'X' })).data.error, 'code');
  const phones = Array.from({ length: 14 }, (_, i) => new Phone(`Player ${i + 1}`));
  for (const p of phones) assert.equal((await p.join(code)).status, 200);
  assert.equal((await json(`${P}/live/join`, { code, nick: 'player 1' })).data.error, 'taken');
  assert.equal((await json(`${P}/live/join`, { code, nick: '   ' })).data.error, 'nick');
  const lobby = await phones[0].stream.until((m) => m.phase === 'lobby' && m.players.length === 15);
  assert.equal(lobby.players.length, 15, '14 phones + the host seat');
  assert.ok(lobby.players.some((p) => p.nick === 'Host'));

  // the host plays too, from the "player screen" link (token in the URL fragment)
  const seatToken = new URL(create.data.seat.url.replace('#', '?')).searchParams.get('t');
  const hostPhone = new Phone('Host'); hostPhone.token = seatToken; hostPhone.open();
  await hostStream.until((m) => m.phase === 'lobby' && m.players.filter((p) => !p.away).length === 15);

  // a phone refreshes in the lobby: same token, stream reopens, still one seat
  phones[2].stream.close(); await sleep(100); phones[2].open();
  await phones[2].stream.until((m) => m.players.length === 15);

  assert.equal((await act('start')).status, 200);
  assert.equal((await json(`${P}/live/join`, { code, nick: 'Latecomer' })).data.error, 'started');

  const everyone = [...phones, hostPhone];
  const rounds = [];
  for (let qi = 0; qi < 5; qi++) {
    const q = await phones[0].stream.until((m) => m.phase === 'question' && m.q.index === qi);
    // nothing correct-looking before the reveal, on any phone or the host screen
    for (const ph of everyone) for (const m of ph.stream.msgs.filter((x) => x.phase === 'ready' || x.phase === 'question')) {
      assert.ok(!('reveal' in m) && !/"(explanation|correct|source)":/.test(JSON.stringify(m)), 'phone payload leaked before the reveal');
    }
    for (const m of hostSeen().filter((x) => x.phase === 'ready' || x.phase === 'question')) assert.ok(!/"(explanation|correct|source)":|reveal/.test(JSON.stringify(m)), 'host payload leaked');
    assert.equal(q.q.options.length, q.q.type === 'tf' ? 2 : 4);
    // everybody answers, option 0 for the even phones, option 1 for the odd, nobody answers twice
    await Promise.all(phones.map((ph, i) => ph.answer(qi, i % 2)));
    assert.equal((await phones[0].answer(qi, 1)).data.error, 'dup');
    await hostStream.until((m) => m.phase === 'question' && m.q.index === qi && m.answered === 14);
    await hostPhone.answer(qi, 14 % 2);                  // the host answers last: now everybody has
    const rv = await phones[0].stream.until((m) => m.phase === 'reveal' && m.q.index === qi);   // everybody answered: the round ended early
    rounds.push(rv.reveal);
    assert.ok(Number.isInteger(rv.reveal.correct) && rv.reveal.explanation && rv.reveal.source);
    assert.equal(rv.reveal.counts.reduce((s, x) => s + x, 0), 15);
    assert.equal((await phones[0].answer(qi, 0)).data.error, 'closed');
    await act('next');                                   // reveal -> leaderboard (or podium after the last)
    if (qi < 4) { await phones[0].stream.until((m) => m.phase === 'board'); await act('next'); }
  }
  const podium = await phones[0].stream.until((m) => m.phase === 'podium');
  assert.equal(podium.podium.length, 3);
  const all = await hostStream.until((m) => m.phase === 'podium');
  assert.equal(all.podium.length, 15);
  // scoring: only correct answers earn points and the order is by score
  assert.ok(all.podium.every((p, i, a) => i === 0 || a[i - 1].score >= p.score));
  everyone.forEach((ph, i) => {                              // even phones always pick option 0, odd phones option 1
    const right = rounds.filter((r) => r.correct === i % 2).length;
    const row = all.podium.find((p) => p.nick === ph.nick);
    assert.ok(row.score >= 500 * right && row.score <= 1250 * right, `${ph.nick}: ${right} right answers, score ${row.score}`);
    if (!right) assert.equal(row.score, 0);
  });

  // --- play again, then a rejoin by nickname after a "lost" phone, then end
  assert.equal((await act('again')).status, 200);
  await phones[0].stream.until((m) => m.phase === 'lobby');
  phones[5].stream.close();
  await sleep(4600);                                        // the server notices after its short grace period
  const away = await phones[0].stream.until((m) => m.players.find((p) => p.nick === 'Player 6')?.away);
  assert.ok(away);
  const back = await json(`${P}/live/join`, { code, nick: 'player 6' });
  assert.equal(back.status, 200); assert.equal(back.data.rejoined, true);
  const stale = new Stream(`${P}/live/events?t=${phones[5].token}`);          // the old token no longer works
  await stale.until((m) => m.gone);
  assert.equal((await act('kick', { id: lobby.players.find((p) => p.nick === 'Player 7').id })).status, 200);
  await phones[6].stream.until((m) => m.gone);

  for (const ph of everyone) ph.stream?.close();
  assert.equal((await act('end')).status, 200);
  await sleep(200);
  await assert.rejects(fetch(`${P}/`), /fetch failed/, 'the play port closes when the game ends');
  hostStream.close();
});

// ---------------------------------------------------------------- step 3: robustness
const poll = (ph, code, tag = '') => json(`${P}/live/state?t=${ph.token}&c=${code}&tag=${encodeURIComponent(tag)}`);
const newGame = async (over = {}) => {
  await act('end').catch(() => {});
  const c = await json(`${H}/api/live/create`, { examId: 'lean-agile', topicIds: [], count: 5, seconds: 10, ...over });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  return c.data;
};

test('streams get a heartbeat; the long-poll fallback gives the same views, holds for news, and leaks nothing', async () => {
  const { code } = await newGame();
  const host = new Stream(`${H}/api/live/events`);
  const a = new Phone('Ana'), b = new Phone('Bo');
  await a.join(code); await b.join(code);
  await sleep(1000);
  assert.ok(a.stream.pings >= 2 && host.pings >= 2, 'ping events arrive on phone and host streams');
  assert.ok(a.stream.msgs.every((m) => m.phase), 'pings are not game messages');

  // Bo is on the fallback: his stream is closed and he polls
  b.stream.close();
  const first = await poll(b, code);
  assert.equal(first.status, 200);
  assert.equal(first.data.phase, 'lobby');
  assert.ok(first.data.tag && first.data.you.nick === 'Bo');
  assert.equal(first.data.hostAway, false);
  const t0 = Date.now();
  const idle = await poll(b, code, first.data.tag);           // nothing changes: the server answers after the hold time with a ping
  assert.equal(idle.data.ping, true);
  assert.ok(Date.now() - t0 >= 600, 'it waited');

  let released = null;
  const held = poll(b, code, first.data.tag).then((r) => { released = r; return r; });
  await sleep(100);
  assert.equal(released, null, 'the poll is still waiting');
  assert.equal((await act('start')).status, 200);
  assert.equal((await held).data.phase, 'ready', 'a change releases the waiting poll');

  const q = await a.stream.until((m) => m.phase === 'question');
  const pq = await poll(b, code);
  assert.equal(pq.data.phase, 'question');
  assert.equal(pq.data.q.text, q.q.text);
  assert.ok(!/"(explanation|correct|source)":|reveal/.test(JSON.stringify(pq.data)), 'a polled payload leaks nothing before the reveal');
  // Bo answers through the fallback, Ana through her stream: the round ends early, the reveal reaches both
  assert.equal((await b.answer(0, 1)).status, 200);
  assert.equal((await b.answer(0, 0)).data.error, 'dup');
  await a.answer(0, 0);
  const rv = await poll(b, code, pq.data.tag);
  assert.equal(rv.data.phase, 'reveal');
  assert.equal(rv.data.reveal.you.answered, true);
  a.stream.close(); host.close();
  await act('end');
});

test('clear messages when a phone cannot get back in: no game, another game, removed, and the old token after a restart', async () => {
  const { code } = await newGame();
  const a = new Phone('Ana'), b = new Phone('Bo');
  await a.join(code); await b.join(code);
  const lobby = await a.stream.until((m) => m.players.length === 2);

  const bogus = await json(`${P}/live/state?t=nope&c=${code}&tag=`);
  assert.equal(bogus.data.gone, true); assert.match(bogus.data.message, /no longer in this game/); assert.ok(!bogus.data.noGame);
  const other = await json(`${P}/live/state?t=${a.token}&c=00000&tag=`);
  assert.equal(other.data.noGame, true); assert.match(other.data.message, /new code/);
  const s2 = new Stream(`${P}/live/events?t=${a.token}&c=00000`);
  assert.equal((await s2.until((m) => m.gone)).noGame, true);

  assert.equal((await act('kick', { id: lobby.players.find((p) => p.nick === 'Bo').id })).status, 200);
  const removed = await b.stream.until((m) => m.gone);
  assert.match(removed.message, /host removed you/);
  assert.match((await poll(b, code)).data.message, /host removed you/);

  // the server restarts mid-game: the game lives in memory only
  child.kill();
  await new Promise((r) => child.once('exit', r));
  await boot();
  await assert.rejects(poll(a, code), /fetch failed/, 'the play port is closed: phones cannot connect until the host hosts again');
  assert.equal((await json(`${H}/api/live/status`)).data.active, false);
  const hostAfter = new Stream(`${H}/api/live/events`);
  await hostAfter.until((m) => m.ended);                    // the host screen is told there is no game
  // the host starts a new game: a phone still holding the old token and code is told so, and is not let in
  await newGame();
  const stale = await poll(a, code);
  assert.equal(stale.data.noGame, true);
  assert.match(stale.data.message, /new code/);
  const staleStream = new Stream(`${P}/live/events?t=${a.token}&c=${code}`);
  assert.equal((await staleStream.until((m) => m.gone)).noGame, true);
  staleStream.close(); hostAfter.close();
  await act('end');
  s2.close();
});

test('phones are told when the host screen is gone and when it is back; the host can enter a tunnel address', async () => {
  const { code } = await newGame();
  let host = new Stream(`${H}/api/live/events`);
  const a = new Phone('Ana');
  await a.join(code);
  await host.until((m) => m.players?.length === 1);
  assert.equal((await a.stream.until((m) => m.phase === 'lobby')).hostAway, false);
  host.close();
  const away = await a.stream.until((m) => m.hostAway === true, 3000);
  assert.ok(away, 'the phone is told the host is away');
  host = new Stream(`${H}/api/live/events`);
  await a.stream.until((m) => m.hostAway === false && m.rev >= away.rev, 3000);

  // tunnel address: only the origin is kept, anything that is not a plain web address is refused
  assert.equal((await act('public', { url: 'abc-def.trycloudflare.com/some/path?x=1' })).status, 200);
  const withPub = await host.until((m) => m.net?.publicUrl);
  assert.equal(withPub.net.publicUrl, 'https://abc-def.trycloudflare.com');
  assert.equal(withPub.net.publicJoinUrl, `https://abc-def.trycloudflare.com/?c=${code}`);
  for (const bad of ['javascript:alert(1)', 'ftp://x.example.com', 'https://user:pw@evil.example.com', 'localhost', 'not a url at all']) {
    assert.equal((await act('public', { url: bad })).status, 400, bad);
  }
  assert.equal((await act('public', { url: '' })).status, 200);
  assert.equal((await host.until((m) => m.net && m.net.publicUrl === null)).net.publicJoinUrl, null);
  // the tunnel adds its own client address header: the join limiter counts that address, not the tunnel's loopback connection
  let blocked = 0;
  for (let i = 0; i < 35; i++) {
    const r = await json(`${P}/live/join`, { code: '00000', nick: 'x' }, { 'CF-Connecting-IP': '203.0.113.9' });
    if (r.status === 429) blocked++;
  }
  assert.ok(blocked >= 4, 'a tunnel visitor who keeps guessing is slowed down (' + blocked + ' refused)');
  a.stream.close(); host.close();
  await act('end');
});

test('a busy play port is reported clearly, and the game can be hosted once it is free', async () => {
  const blocker = http.createServer((q, r) => r.end('x'));
  await new Promise((r) => blocker.listen(PLAY, '127.0.0.1', r));
  const busy = await json(`${H}/api/live/create`, { examId: 'lean-agile', topicIds: [], count: 5, seconds: 10 });
  assert.equal(busy.status, 409);
  assert.equal(busy.data.code, 'port');
  assert.match(busy.data.error, /already in use/);
  assert.match(busy.data.error, /PLAY_PORT/);
  assert.equal((await json(`${H}/api/live/status`)).data.active, false, 'nothing is left half-created');
  await new Promise((r) => blocker.close(r));
  await newGame();
  await act('end');
});
