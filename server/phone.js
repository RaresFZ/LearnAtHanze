// "Study on your phone": a second, read-only copy of the study app that listens on the local network only while the user has switched it on.
//   - The phone gets the same app files and the same exam data (GET /api/exams, GET /api/exams/<id>) as the computer. Nothing else.
//   - No Live Quiz host controls, no quit endpoint. Only GET and HEAD are answered, with ONE exception: /api/sync/... (the progress of your devices,
//     see server/sync.js), which needs the pairing key from the QR code.
//   - Progress is kept in each device's own browser (localStorage); syncing copies it between your devices through the computer.
//   - It stops by itself after IDLE_STOP_MS without a request, and when the app quits.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lanAddresses } from './live/lan.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon',
};
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };
export const IDLE_STOP_MS = 8 * 60 * 60 * 1000;

export function createPhoneStudy({ app, listExams, loadExam, port, idleMs = IDLE_STOP_MS, syncApi = null, getKey = () => '' }) {
  let server = null, error = null, startedAt = 0, lastRequest = 0, sweeper = null;
  let bindHost = '127.0.0.1';

  const send = (res, status, body, type = 'text/plain; charset=utf-8', extra = {}, head = false) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY, ...extra });
    res.end(head ? undefined : body);
  };
  const sendJson = (res, status, data, head) => send(res, status, JSON.stringify(data), TYPES['.json'], {}, head);

  async function handle(req, res) {
    lastRequest = Date.now();
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://phone').pathname); } catch { req.resume(); return send(res, 400, 'Bad request'); }
    if (pathname.includes('\0')) { req.resume(); return send(res, 400, 'Bad request'); }
    if (syncApi && pathname.startsWith('/api/sync/') && await syncApi(req, res, pathname, send)) return;   // the one thing a phone may write: its own progress
    req.resume();                                  // nobody sends us anything else: drop a body instead of resetting the connection
    const head = req.method === 'HEAD';
    if (req.method !== 'GET' && !head) return send(res, 405, 'Read only', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
    if (pathname === '/api/phone/status') return sendJson(res, 200, { onPhone: true }, head);   // how the app knows it runs as the phone copy
    if (pathname === '/api/exams') return sendJson(res, 200, await listExams(), head);
    const m = pathname.match(/^\/api\/exams\/([a-z0-9-]+)$/);
    if (m) {
      try { return sendJson(res, 200, await loadExam(m[1]), head); } catch (e) {
        if (e.code === 'ENOENT') return sendJson(res, 404, { error: 'Unknown exam' }, head);
        throw e;
      }
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not available on the phone' }, head);
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(app, rel);
    if (file !== app && !file.startsWith(app + path.sep)) return send(res, 403, 'Forbidden');
    try {
      const data = await fs.readFile(file);
      const ext = path.extname(file).toLowerCase();
      send(res, 200, data, TYPES[ext] || 'application/octet-stream', ext === '.woff2' || ext === '.png' ? { 'Cache-Control': 'public, max-age=86400' } : {}, head);
    } catch { send(res, 404, 'Not found'); }
  }

  function addresses() {
    // LIVE_LAN=off: never open the network. LIVE_LAN=loopback: test mode, loopback only but still reports the address (for the QR code).
    return process.env.LIVE_LAN === 'off' ? [] : lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${port}`, pairUrl: `http://${a.address}:${port}/?k=${getKey()}` }));
  }
  function status() {
    const listening = !!server?.listening;
    return {
      on: listening, port, lan: listening && bindHost === '0.0.0.0', addresses: listening ? addresses() : [], localUrl: `http://localhost:${port}`,
      startedAt: listening ? startedAt : 0, error, forcedOff: process.env.LIVE_LAN === 'off', idleHours: idleMs / 3600000,
    };
  }

  async function start() {
    if (server?.listening) return status();
    const mode = process.env.LIVE_LAN;
    bindHost = mode === 'off' || mode === 'loopback' ? '127.0.0.1' : '0.0.0.0';
    const s = http.createServer((req, res) => handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, 'Something went wrong'); else res.end(); }));
    s.on('connection', (sock) => sock.setKeepAlive(true, 10000));
    error = null;
    try {
      await new Promise((resolve, reject) => { s.once('error', reject); s.listen(port, bindHost, () => { s.off('error', reject); resolve(); }); });
    } catch (e) {
      error = e.code === 'EADDRINUSE'
        ? `Port ${port} is already in use (a second copy of the app?). Close it, or start the app with PHONE_PORT=${port + 10}.`
        : e.message;
      throw Object.assign(new Error(error), { status: 409 });
    }
    s.on('error', (e) => console.error('Study on your phone:', e.message));
    server = s; startedAt = lastRequest = Date.now();
    sweeper = setInterval(() => { if (Date.now() - lastRequest > idleMs) stop().catch(() => {}); }, Math.min(60000, Math.max(50, idleMs / 4)));
    sweeper.unref?.();
    return status();
  }

  async function stop() {
    clearInterval(sweeper); sweeper = null;
    const s = server; server = null;
    if (s) { s.closeAllConnections?.(); await new Promise((r) => s.close(() => r())); }
    return status();
  }

  return { start, stop, status };
}
