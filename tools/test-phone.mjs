// "Study on your phone": the read-only phone copy of the app (server/phone.js) and its switch in server.js.
// Own servers on spare ports (3767 for the module, 3787/3788/3789 for a full copy of the app), LIVE_LAN=loopback so no firewall prompt appears.
// Run with: npm run test:live
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPhoneStudy } from '../server/phone.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
process.env.LIVE_LAN = 'loopback';

/** One request with full control of method, headers and the raw path. */
const req = (port, p, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  r.on('error', reject);
  r.end(body);
});
const refused = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); });

const fake = {
  app: APP, port: 3767,
  listExams: async () => [{ id: 'demo', title: 'Demo' }],
  loadExam: async (id) => { if (id !== 'demo') throw Object.assign(new Error('no'), { code: 'ENOENT' }); return { exam: { id }, questions: [] }; },
};

test('the phone server serves the app and the exam data, and nothing else', async () => {
  const phone = createPhoneStudy(fake);
  assert.equal(phone.status().on, false);
  assert.equal(await refused(3767), true, 'closed before it is switched on');
  const st = await phone.start();
  try {
    assert.equal(st.on, true);
    assert.equal(st.lan, false, 'LIVE_LAN=loopback binds to this computer only');
    const home = await req(3767, '/');
    assert.equal(home.status, 200); assert.match(home.headers['content-type'], /text\/html/); assert.match(home.body, /LearnAtHanze/);
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    const mani = await req(3767, '/manifest.webmanifest');
    assert.equal(mani.status, 200); assert.match(mani.headers['content-type'], /application\/manifest\+json/);
    const m = JSON.parse(mani.body);
    assert.equal(m.display, 'standalone');
    for (const icon of m.icons) assert.equal((await req(3767, '/' + icon.src)).status, 200, icon.src);
    assert.equal((await req(3767, '/apple-touch-icon.png')).status, 200);
    assert.equal((await req(3767, '/js/main.js')).status, 200);
    assert.deepEqual(JSON.parse((await req(3767, '/api/exams')).body), [{ id: 'demo', title: 'Demo' }]);
    assert.equal((await req(3767, '/api/exams/demo')).status, 200);
    assert.equal((await req(3767, '/api/exams/nope')).status, 404);
    // no host controls, no quit, no phone switch, no live game
    assert.deepEqual(JSON.parse((await req(3767, '/api/phone/status')).body), { onPhone: true }, 'how the app knows it is the phone copy');
    for (const p of ['/api/phone/start', '/api/quit', '/api/live/status', '/api/live/action', '/api/anything']) assert.equal((await req(3767, p)).status, 404, p);
    // read only
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await req(3767, '/api/exams', { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405, method);
    assert.equal((await req(3767, '/api/phone/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
    assert.equal((await req(3767, '/', { method: 'HEAD' })).status, 200);
    // the course files and the rest of the project are not reachable
    for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/package.json', '/js/../../server.js', '/content/lean-agile/questions.json', '/server/phone.js', '/exams%20studies/x', '/%00']) {
      const r = await req(3767, p);
      assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
      assert.doesNotMatch(r.body, /createPhoneStudy|"questions"/);
    }
  } finally { await phone.stop(); }
  assert.equal(await refused(3767), true, 'closed again after stop');
  assert.equal(phone.status().on, false);
  const again = await phone.start();                                     // can be switched on again
  assert.equal(again.on, true);
  assert.equal((await req(3767, '/')).status, 200);
  await phone.stop();
});

test('LIVE_LAN=off never opens the network and reports no address', async () => {
  const before = process.env.LIVE_LAN; process.env.LIVE_LAN = 'off';
  const phone = createPhoneStudy({ ...fake, port: 3768 });
  try {
    const s = await phone.start();
    assert.deepEqual(s.addresses, []); assert.equal(s.lan, false); assert.equal(s.forcedOff, true);
  } finally { await phone.stop(); process.env.LIVE_LAN = before; }
});

test('it switches itself off after a period without use', async () => {
  const phone = createPhoneStudy({ ...fake, port: 3769, idleMs: 200 });
  await phone.start();
  assert.equal((await req(3769, '/')).status, 200);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(phone.status().on, false); assert.equal(await refused(3769), true);
});

test('a second copy on the same port is a clear message, not a crash', async () => {
  const a = createPhoneStudy({ ...fake, port: 3770 }), b = createPhoneStudy({ ...fake, port: 3770 });
  await a.start();
  try {
    await assert.rejects(() => b.start(), (e) => e.status === 409 && /already in use/.test(e.message));
    assert.match(b.status().error, /PHONE_PORT/);
  } finally { await a.stop(); }
});

test('the app: the switch is only for this computer, and the phone copy is a different server', async () => {
  const env = { ...process.env, PORT: '3787', PLAY_PORT: '3788', PHONE_PORT: '3789', NO_OPEN: '1', LIVE_LAN: 'loopback', SYNC_FILE: path.join(os.tmpdir(), 'lah-test-phone-sync.json') };
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && (await refused(3787)); i++) await new Promise((r) => setTimeout(r, 100));
    const JSONH = { 'Content-Type': 'application/json', Host: 'localhost:3787' };
    const st = await req(3787, '/api/phone/status', { headers: { Host: 'localhost:3787' } });
    assert.equal(st.status, 200); assert.equal(JSON.parse(st.body).on, false);
    // other websites and other computers cannot switch it
    assert.equal((await req(3787, '/api/phone/start', { method: 'POST', headers: { ...JSONH, Origin: 'http://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await req(3787, '/api/phone/start', { method: 'POST', headers: { ...JSONH, Host: '192.168.1.20:3787' }, body: '{}' })).status, 403);
    assert.equal((await req(3787, '/api/phone/start', { method: 'POST', headers: { 'Content-Type': 'text/plain', Host: 'localhost:3787' }, body: '{}' })).status, 403);
    assert.equal((await req(3787, '/api/phone/status', { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal(await refused(3789), true, 'still closed');
    const on = await req(3787, '/api/phone/start', { method: 'POST', headers: JSONH, body: '{}' });
    assert.equal(on.status, 200); assert.equal(JSON.parse(on.body).on, true);
    // the real app data over the phone port
    const exams = JSON.parse((await req(3789, '/api/exams')).body);
    assert.deepEqual(exams.map((e) => e.id).sort(), ['lean-agile', 'outsourcing-governance']);
    const full = JSON.parse((await req(3789, '/api/exams/outsourcing-governance')).body);
    assert.ok(full.questions.length > 150 && full.lessons && full.exam.simulation.sets.length === 11);
    assert.deepEqual(JSON.parse((await req(3789, '/api/phone/status')).body), { onPhone: true }, 'the phone copy is told apart by this answer');
    assert.equal((await req(3789, '/api/live/status')).status, 404);
    assert.equal((await req(3789, '/api/quit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 405);
    const off = await req(3787, '/api/phone/stop', { method: 'POST', headers: JSONH, body: '{}' });
    assert.equal(JSON.parse(off.body).on, false);
    assert.equal(await refused(3789), true);
    // starting the app with two equal ports is refused
    const dup = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...env, PORT: '3797', PLAY_PORT: '3798', PHONE_PORT: '3798' }, stdio: 'ignore' });
    const code = await new Promise((r) => dup.on('exit', r));
    assert.equal(code, 1);
  } finally {
    await req(3787, '/api/quit', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost:3787' }, body: '{}' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode === null) child.kill();
  }
});

test('every file the phone copy and the home screen need exists', () => {
  const index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  assert.match(index, /viewport-fit=cover/); assert.match(index, /rel="manifest" href="manifest\.webmanifest"/); assert.match(index, /apple-touch-icon\.png/);
  for (const f of ['manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon.svg', 'vendor/qrcode.js', 'js/phone.js', 'js/qr.js']) assert.ok(fs.existsSync(path.join(APP, f)), f);
  const png = (f) => { const b = fs.readFileSync(path.join(APP, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(png('icon-192.png'), [192, 192]); assert.deepEqual(png('icon-512.png'), [512, 512]); assert.deepEqual(png('apple-touch-icon.png'), [180, 180]);
});
