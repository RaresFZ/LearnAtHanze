// Progress on several devices, the server side and all of it end to end:
//   - server/sync.js (the stored parts, the pairing key, resets, what is refused),
//   - the two doors into it (the computer's own page without a key, the phone with the key) over real HTTP,
//   - two devices (their own localStorage) that really sync through a real copy of the app: sums, no double counting, reset.
// Own copy of the app on 3807/3808/3809 with its own sync file in the temp folder (never the real .lah-sync.json). Run with: npm run test:live
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSyncStore, SyncError, MAX_BODY } from '../server/sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lah-sync-'));
const KEY = '0123456789abcdef0123';
const E = 'lean-agile';
const T = Date.now() - 60000;        // a minute ago: the store drops parts untouched for 120 days, so the tests use real times
const part = (over = {}) => ({ v: 1, exam: E, questions: {}, cards: {}, games: {}, learn: {}, calc: {}, confuse: {}, plan: {}, study: {}, sessions: [], bestStreak: 0, streak: 0, ts: 0, ...over });

// ------------------------------------------------------------------ the store
test('the store keeps the parts of the devices, survives a restart and keeps the key', async () => {
  const file = path.join(tmp, 'a.json');
  const mk = () => createSyncStore({ file, knownExams: async () => [E, 'outsourcing-governance'] });
  let s = mk();
  const key = await s.key();
  assert.match(key, /^[a-f0-9]{20}$/);
  assert.deepEqual(await s.pull(E), { resetAt: 0, devices: {} });
  assert.deepEqual(await s.push(E, 'aaaaaaaaaaaaaaaa', { ts: T + 100, resetAt: 0, data: part({ ts: T + 100, questions: { q1: { n: 1, score: 1, last: T + 100, lastScore: 1, streak: 1 } } }) }), { resetAt: 0, stored: true });
  await s.push(E, 'bbbbbbbbbbbbbbbb', { ts: T + 120, resetAt: 0, data: part({ ts: T + 120 }) });
  await new Promise((r) => setTimeout(r, 100));                     // the file is written in the background
  s = mk();                                                          // a restart
  assert.equal(await s.key(), key, 'the key is kept in the file, so phones stay paired');
  const pull = await s.pull(E);
  assert.deepEqual(Object.keys(pull.devices).sort(), ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  assert.equal(pull.devices.aaaaaaaaaaaaaaaa.data.questions.q1.n, 1);
  assert.deepEqual((await s.pull('outsourcing-governance')).devices, {}, 'the exams stay apart');
  // an older part arriving late does not replace a newer one
  assert.equal((await s.push(E, 'aaaaaaaaaaaaaaaa', { ts: T + 50, resetAt: 0, data: part({ ts: T + 50 }) })).stored, false);
  assert.equal((await s.pull(E)).devices.aaaaaaaaaaaaaaaa.ts, T + 100);
  const k2 = await s.rotateKey();
  assert.notEqual(k2, key); assert.equal(await s.checkKey(key), false); assert.equal(await s.checkKey(k2), true); assert.equal(await s.checkKey(''), false); assert.equal(await s.checkKey(undefined), false);
});

test('a reset removes the older parts of every device, and a device that missed it is told', async () => {
  const s = createSyncStore({ file: path.join(tmp, 'b.json'), knownExams: async () => [E] });
  await s.push(E, 'aaaaaaaaaaaaaaaa', { ts: T + 100, resetAt: 0, data: part({ ts: T + 100 }) });
  await s.push(E, 'bbbbbbbbbbbbbbbb', { ts: T + 200, resetAt: 0, data: part({ ts: T + 200 }) });
  const r = await s.push(E, 'aaaaaaaaaaaaaaaa', { ts: T + 1000, resetAt: T + 1000, data: part({ ts: T + 1000 }) });   // a resets
  assert.equal(r.resetAt, T + 1000);
  assert.deepEqual(Object.keys((await s.pull(E)).devices), ['aaaaaaaaaaaaaaaa']);
  await assert.rejects(() => s.push(E, 'bbbbbbbbbbbbbbbb', { ts: T + 300, resetAt: 0, data: part({ ts: T + 300 }) }), (e) => e instanceof SyncError && e.status === 409 && e.extra.resetAt === T + 1000);
  assert.equal((await s.push(E, 'cccccccccccccccc', { ts: T + 500, resetAt: T + 1000, data: part({ ts: T + 500 }) })).stored, false, 'a part older than the reset is not kept');
  assert.equal((await s.push(E, 'bbbbbbbbbbbbbbbb', { ts: T + 1500, resetAt: T + 1000, data: part({ ts: T + 1500 }) })).stored, true, 'once it knows, it may write again');
});

test('the store refuses what does not belong in it', async () => {
  const s = createSyncStore({ file: path.join(tmp, 'c.json'), knownExams: async () => [E] });
  const ok = { ts: T + 100, resetAt: 0, data: part({ ts: T + 100 }) };
  const bad = async (status, id, device, body) => assert.rejects(() => s.push(id, device, body), (e) => e instanceof SyncError && e.status === status);
  await bad(404, 'nope', 'aaaaaaaaaaaaaaaa', ok);
  await bad(404, '../x', 'aaaaaaaaaaaaaaaa', ok);
  await bad(400, E, 'not-a-device', ok);
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, ts: 'now' });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, ts: Date.now() + 10 * 24 * 3600 * 1000 });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, data: part({ exam: 'outsourcing-governance' }) });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, data: { ...part(), v: 2 } });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, data: { ...part(), questions: [] } });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, data: { ...part(), questions: { q: 5 } } });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', { ...ok, data: { ...part(), sessions: 'x' } });
  await bad(400, E, 'aaaaaaaaaaaaaaaa', null);
  await assert.rejects(() => s.pull('nope'), (e) => e.status === 404);
  for (let i = 0; i < 12; i++) await s.push(E, String(i).padStart(16, 'a'), { ts: T + 100 + i, resetAt: 0, data: part({ ts: T + 100 + i }) });
  await bad(409, E, 'ffffffffffffffff', ok);                        // a 13th device
});

// ------------------------------------------------------------------ over HTTP, with a real copy of the app
// (this part uses Exam B's data so the two-device test below starts from an empty Exam A)
const OB = 'outsourcing-governance';
const partB = (over = {}) => part({ exam: OB, ...over });
const req = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => {
    const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(c).toString('utf8') }));
  });
  r.on('error', reject); r.end(body);
});
const refused = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); });
const JSONH = { 'Content-Type': 'application/json', Host: 'localhost:3807' };
const PC = { Host: 'localhost:3807' };

const syncFile = path.join(tmp, 'live.json');
fs.writeFileSync(syncFile, JSON.stringify({ key: KEY, exams: {} }));
const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: '3807', PLAY_PORT: '3808', PHONE_PORT: '3809', NO_OPEN: '1', LIVE_LAN: 'loopback', SYNC_FILE: syncFile } });
for (let i = 0; i < 60 && (await refused(3807)); i++) await new Promise((r) => setTimeout(r, 100));
test.after(async () => {
  await req(3807, '/api/quit', { method: 'POST', headers: JSONH, body: '{}' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  if (child.exitCode === null) child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the computer\'s own page needs no key, but nobody else gets in; the phone needs the key', async () => {
  assert.equal((await req(3807, '/api/phone/start', { method: 'POST', headers: JSONH, body: '{}' })).status, 200);
  // the computer's door: only this computer's own page
  assert.equal((await req(3807, '/api/sync/' + OB, { headers: PC })).status, 200);
  assert.equal((await req(3807, '/api/sync/' + OB, { headers: { Host: '192.168.0.9:3807' } })).status, 401, 'another computer cannot use the app address');
  assert.equal((await req(3807, '/api/sync/' + OB, { headers: { Host: 'evil.example' } })).status, 401);
  const put = (headers, body = JSON.stringify({ ts: T + 100, resetAt: 0, data: partB({ ts: T + 100 }) })) => req(3807, '/api/sync/' + OB + '/aaaaaaaaaaaaaaaa', { method: 'PUT', headers, body });
  assert.equal((await put({ 'Content-Type': 'text/plain', Host: 'localhost:3807' })).status, 401, 'a plain form post is not accepted');
  assert.equal((await put({ ...JSONH, Origin: 'http://evil.example' })).status, 401, 'nor another website');
  assert.equal((await put(JSONH)).status, 200);
  assert.equal((await req(3807, '/api/sync/nope', { headers: PC })).status, 404);
  assert.equal((await req(3807, '/api/sync/' + OB + '/aaaaaaaaaaaaaaaa', { method: 'PATCH', headers: JSONH, body: '{}' })).status, 405);
  assert.equal((await req(3807, '/api/sync/' + OB + '/aaaaaaaaaaaaaaaa', { method: 'PATCH', headers: PC })).status, 401);
  // the phone's door: the key
  const ph = (key, extra = {}) => ({ headers: { ...(key ? { 'X-Sync-Key': key } : {}), ...extra } });
  assert.equal((await req(3809, '/api/sync/' + OB, ph(null))).status, 401, 'no key');
  assert.equal((await req(3809, '/api/sync/' + OB, ph('wrong'))).status, 401);
  assert.equal((await req(3809, '/api/sync/' + OB, ph('0123456789abcdef0124'))).status, 401);
  const got = await req(3809, '/api/sync/' + OB, ph(KEY));
  assert.equal(got.status, 200); assert.deepEqual(Object.keys(JSON.parse(got.text).devices), ['aaaaaaaaaaaaaaaa'], 'what the computer stored is visible to the paired phone');
  const phonePut = await req(3809, '/api/sync/' + OB + '/bbbbbbbbbbbbbbbb', { method: 'PUT', headers: { 'X-Sync-Key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ ts: T + 200, resetAt: 0, data: partB({ ts: T + 200 }) }) });
  assert.equal(phonePut.status, 200);
  assert.equal((await req(3809, '/api/sync/' + OB + '/cccccccccccccccc', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'a write without the key');
  // too large
  const big = JSON.stringify({ ts: T + 300, resetAt: 0, data: partB({ ts: T + 300, sessions: [{ x: 'y'.repeat(MAX_BODY) }] }) });
  const r = await req(3809, '/api/sync/' + OB + '/dddddddddddddddd', { method: 'PUT', headers: { 'X-Sync-Key': KEY, 'Content-Type': 'application/json' }, body: big }).catch((e) => ({ status: e.code }));
  assert.ok([413, 'ECONNRESET', 'EPIPE'].includes(r.status), `an oversized part is refused (${r.status})`);
  // the rest of the phone copy is as before: no other write
  assert.equal((await req(3809, '/api/exams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
  assert.equal((await req(3809, '/api/phone/rotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405, 'a phone cannot change the key');
  // a new key pairs new phones and unpairs the old ones
  assert.equal((await req(3807, '/api/phone/rotate', { method: 'POST', headers: { ...JSONH, Origin: 'http://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await req(3807, '/api/phone/rotate', { method: 'POST', headers: JSONH, body: '{}' })).status, 200);
  assert.equal((await req(3809, '/api/sync/' + OB, ph(KEY))).status, 401, 'the old key is dead');
  const fresh = JSON.parse(fs.readFileSync(syncFile, 'utf8')).key;
  assert.notEqual(fresh, KEY);
  assert.equal((await req(3809, '/api/sync/' + OB, ph(fresh))).status, 200);
  fs.writeFileSync(path.join(tmp, 'key.txt'), fresh);
});

// ------------------------------------------------------------------ two devices, for real
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('two devices share their progress: sums, nothing counted twice, a reset reaches both', async () => {
  const key = fs.readFileSync(path.join(tmp, 'key.txt'), 'utf8');
  const pc = memory(), phone = memory();
  phone.setItem('learnathanze:synckey', key);
  const store = await import('../app/js/store.js');
  const sync = await import('../app/js/sync.js');
  const as = (dev, fn) => { globalThis.localStorage = dev === 'pc' ? pc : phone; sync.configureSync(dev === 'pc' ? { base: 'http://127.0.0.1:3807', onPhone: false } : { base: 'http://127.0.0.1:3809', onPhone: true }); return fn(); };
  const n = (dev, q, ex = E) => as(dev, () => store.loadProgress(ex).questions[q]?.n ?? 0);
  const syncOn = (dev, ex = E) => as(dev, () => sync.syncExam(ex));

  // the computer was used before (progress that existed already), the phone is new
  as('pc', () => { store.recordAnswer(E, 'q1', 1); store.recordAnswer(E, 'q1', 0); store.recordStudy(E, 10); });
  assert.equal(await syncOn('pc'), false, 'nothing from other devices yet');
  as('phone', () => { store.recordAnswer(E, 'q1', 1); store.recordAnswer(E, 'q2', 1); });
  assert.equal(await syncOn('phone'), true, 'the phone received the computer\'s part');
  assert.equal(n('phone', 'q1'), 3); assert.equal(n('phone', 'q2'), 1);
  assert.equal(await syncOn('pc'), true);
  assert.equal(n('pc', 'q1'), 3); assert.equal(n('pc', 'q2'), 1);
  // the same sync over and over changes nothing (no counting twice)
  for (let i = 0; i < 3; i++) { await syncOn('pc'); await syncOn('phone'); }
  assert.equal(n('pc', 'q1'), 3); assert.equal(n('phone', 'q1'), 3); assert.equal(n('pc', 'q2'), 1);
  assert.equal(as('pc', () => store.loadOwn(E).questions.q1.n), 2, 'each device still writes only its own part');
  assert.equal(as('phone', () => store.loadProgress(E).study[Object.keys(store.loadProgress(E).study)[0]]), 10, 'study minutes arrive too');
  // both keep working, in the other order too
  as('pc', () => store.recordAnswer(E, 'q2', 0)); as('phone', () => store.recordAnswer(E, 'q2', 1));
  await syncOn('phone'); await syncOn('pc'); await syncOn('phone');
  assert.equal(n('pc', 'q2'), 3); assert.equal(n('phone', 'q2'), 3);
  assert.equal(as('pc', () => store.loadProgress(E).questions.q2.score), 2);
  // the other exam is not touched
  assert.equal(n('pc', 'q1', 'outsourcing-governance'), 0);
  // a reset on the phone reaches the computer, and the computer's old part does not come back
  as('phone', () => store.resetProgress(E));
  await syncOn('phone');
  assert.equal(n('phone', 'q1'), 0);
  assert.equal(await syncOn('pc'), true);
  assert.equal(n('pc', 'q1'), 0, 'the computer followed the reset'); assert.equal(n('pc', 'q2'), 0);
  as('phone', () => store.recordAnswer(E, 'q3', 1));
  await syncOn('phone'); await syncOn('pc');
  assert.equal(n('pc', 'q3'), 1); assert.equal(n('pc', 'q1'), 0, 'nothing from before the reset came back');
  // an import on the computer replaces everything on both
  const backup = as('pc', () => store.exportProgress(E));
  as('pc', () => store.recordAnswer(E, 'q4', 1));
  as('pc', () => store.importProgress(E, backup));
  await syncOn('pc'); await syncOn('phone');
  assert.equal(n('phone', 'q4'), 0); assert.equal(n('phone', 'q3'), 1); assert.equal(n('pc', 'q3'), 1);
});

test('a phone without the key, or with an old one, keeps its own progress and says why', async () => {
  const sync = await import('../app/js/sync.js');
  const store = await import('../app/js/store.js');
  const dev = memory(); globalThis.localStorage = dev;
  sync.configureSync({ base: 'http://127.0.0.1:3809', onPhone: true });
  assert.equal(sync.syncState.status, 'unpaired'); assert.equal(sync.paired(), false);
  store.recordAnswer(E, 'x1', 1);
  assert.equal(await sync.syncExam(E), false);
  assert.equal(store.loadProgress(E).questions.x1.n, 1, 'its own progress is safe');
  assert.equal(sync.takeKeyFromUrl('?k=0123456789abcdef0123&x=1'), true);
  assert.equal(sync.takeKeyFromUrl('?k=nonsense'), false);
  assert.equal(await sync.syncExam(E), false);                       // that key is not the current one
  assert.equal(sync.syncState.status, 'unpaired'); assert.match(sync.syncState.error, /pairing code/i);
  // the computer cannot be reached: offline, nothing lost
  sync.configureSync({ base: 'http://127.0.0.1:3899', onPhone: true });
  await sync.syncExam(E);
  assert.equal(sync.syncState.status, 'offline'); assert.equal(store.loadProgress(E).questions.x1.n, 1);
});
