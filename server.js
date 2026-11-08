// LearnAtHanze local server: serves the app and the editable content files. No dependencies.
// Start with `npm start` (or `node server.js`), then open http://localhost:3737
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHub } from './server/live/hub.js';
import { createPhoneStudy } from './server/phone.js';
import { createSyncStore, handleSync } from './server/sync.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const CONTENT = path.join(ROOT, 'content');
// Progress lives in the browser's localStorage, which is tied to the address (including the port).
// Keep the port fixed so your progress is always found.
const PORT = Number(process.env.PORT) || 3737;
// Live Quiz: the play server phones connect to. It only listens while a live game is hosted (see server/live/hub.js).
const PLAY_PORT = Number(process.env.PLAY_PORT) || 3738;
// Study on your phone: a read-only copy of the app for your own phone, on the local network only while you switch it on (see server/phone.js).
const PHONE_PORT = Number(process.env.PHONE_PORT) || 3739;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
};

const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};
const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), TYPES['.json']);

async function readJson(file, fallback) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
  try { return JSON.parse(text); } catch (e) {
    throw new Error(`${path.relative(ROOT, file)} is not valid JSON: ${e.message}`);
  }
}

async function listExams() {
  const dirs = await fs.readdir(CONTENT, { withFileTypes: true });
  const exams = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const exam = await readJson(path.join(CONTENT, d.name, 'exam.json'), null);
    if (!exam) continue;
    const questions = await readJson(path.join(CONTENT, d.name, 'questions.json'), []);
    exams.push({ ...exam, id: d.name, questionCount: questions.length });
  }
  return exams.sort((a, b) => a.title.localeCompare(b.title));
}

async function loadExam(id) {
  const dir = path.join(CONTENT, id);
  const exam = await readJson(path.join(dir, 'exam.json'));
  return {
    exam: { ...exam, id },
    topics: await readJson(path.join(dir, 'topics.json'), []),
    questions: await readJson(path.join(dir, 'questions.json'), []),
    flashcards: await readJson(path.join(dir, 'flashcards.json'), { include: [], exclude: [] }),
    games: await readJson(path.join(dir, 'games.json'), { pairs: [] }),
    confusions: await readJson(path.join(dir, 'confusions.json'), null),   // optional: groups of easily confused terms for the drills
    lessons: await readJson(path.join(dir, 'lessons.json'), null),      // optional: the Learn mode (guided lessons, plan, cheat sheet)
  };
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(APP, rel);
  if (file !== APP && !file.startsWith(APP + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.readFile(file);
    send(res, 200, data, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found');
  }
}

if (new Set([PORT, PLAY_PORT, PHONE_PORT]).size < 3) {
  console.error(`PORT (${PORT}), PLAY_PORT (${PLAY_PORT}) and PHONE_PORT (${PHONE_PORT}) must be three different ports (defaults 3737, 3738 and 3739).`);
  process.exit(1);
}

const live = createHub({ loadExam, hostPort: PORT, playPort: PLAY_PORT });
// Your progress on every device: the computer's browser and the phone's browser each send their own part here (server/sync.js, app/js/sync.js).
// The file is .lah-sync.json (git ignores it, the launcher update leaves it alone). The phone proves itself with a key that is in the QR code.
const sync = createSyncStore({ file: process.env.SYNC_FILE || path.join(ROOT, '.lah-sync.json'), knownExams: async () => (await listExams()).map((e) => e.id) });
let pairKey = await sync.key();
const fails = new Map();    // phone address -> { n, reset }: wrong keys in the last minute
const phoneSync = (req, res, pathname, send) => handleSync(req, res, pathname, {
  store: sync, send,
  authorize: async (r) => {
    const ip = r.socket.remoteAddress || '', now = Date.now(), f = fails.get(ip);
    if (f && now < f.reset && f.n >= 30) return false;
    if (await sync.checkKey(r.headers['x-sync-key'])) return true;
    fails.set(ip, f && now < f.reset ? { n: f.n + 1, reset: f.reset } : { n: 1, reset: now + 60000 });
    return false;
  },
});
const phone = createPhoneStudy({ app: APP, listExams, loadExam, port: PHONE_PORT, syncApi: phoneSync, getKey: () => pairKey });

// Stopping: ends a live game and closes the phone port first, then exits. Used by Ctrl+C and by the "Stop LearnAtHanze" script (POST /api/quit).
let stopping = false;
function shutdown(why) {
  if (stopping) return;
  stopping = true;
  console.log(`LearnAtHanze is stopping (${why}).`);
  Promise.allSettled([live.end(), phone.stop()]).finally(() => process.exit(0));
}
/** Same checks as the Live Quiz host API: only this computer's own page or script may call it (no other website, no plain form post). */
function fromThisComputer(req) {
  const hosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  if (!hosts.includes(req.headers.host || '')) return false;
  if (req.headers.origin && !hosts.some((h) => req.headers.origin === `http://${h}`)) return false;
  return /^application\/json/.test(req.headers['content-type'] || '');
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/quit') {
      if (req.method !== 'POST' || !fromThisComputer(req)) return sendJson(res, 403, { error: 'Forbidden' });
      sendJson(res, 200, { ok: true, liveGame: live.status().active });
      return void res.on('finish', () => shutdown('asked to stop'));
    }
    if (pathname === '/api/phone/status') {
      if (req.method !== 'GET' || ![`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(req.headers.host || '')) return sendJson(res, 403, { error: 'Forbidden' });
      return sendJson(res, 200, phone.status());
    }
    if (pathname.startsWith('/api/sync/')) {     // the computer's own page: no key needed, but only this computer's own page
      if (await handleSync(req, res, pathname, { store: sync, send, authorize: async (r) => (r.method === 'GET' ? [`localhost:${PORT}`, `127.0.0.1:${PORT}`].includes(r.headers.host || '') : fromThisComputer(r)) })) return;
    }
    if (pathname === '/api/phone/rotate') {      // a new pairing key: phones paired before have to scan the QR code again
      if (req.method !== 'POST' || !fromThisComputer(req)) return sendJson(res, 403, { error: 'Forbidden' });
      pairKey = await sync.rotateKey();
      return sendJson(res, 200, phone.status());
    }
    if (pathname === '/api/phone/start' || pathname === '/api/phone/stop') {
      if (req.method !== 'POST' || !fromThisComputer(req)) return sendJson(res, 403, { error: 'Forbidden' });
      try { return sendJson(res, 200, pathname.endsWith('start') ? await phone.start() : await phone.stop()); } catch (e) { return sendJson(res, e.status || 500, { error: e.message }); }
    }
    if (pathname.startsWith('/api/live/')) return live.handleHost(req, res, pathname);
    if (pathname === '/api/exams') return sendJson(res, 200, await listExams());
    const m = pathname.match(/^\/api\/exams\/([a-z0-9-]+)$/);
    if (m) {
      try { return sendJson(res, 200, await loadExam(m[1])); } catch (e) {
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'Unknown exam' });
        throw e;
      }
    }
    await serveStatic(res, pathname);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. If LearnAtHanze is already running, just open http://localhost:${PORT}.`);
    console.error('Otherwise free the port, or pick another with PORT=4000 (note: progress is stored per address/port).');
  } else console.error(e);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`LearnAtHanze is running at ${url}  (Ctrl+C to stop)`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
