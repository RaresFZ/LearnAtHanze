// LearnAtHanze local server: serves the app and the editable content files. No dependencies.
// Start with `npm start` (or `node server.js`), then open http://localhost:3737
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const CONTENT = path.join(ROOT, 'content');
// Progress lives in the browser's localStorage, which is tied to the address (including the port).
// Keep the port fixed so your progress is always found.
const PORT = Number(process.env.PORT) || 3737;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
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

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
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

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`LearnAtHanze is running at ${url}  (Ctrl+C to stop)`);
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
