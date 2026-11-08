// Keeps the progress of your devices (the computer's browser, the phone's browser) so each of them can show the combination of all.
// Each device owns one "part" per exam and is the only one that writes it; the server only stores the parts and hands them out.
// How the parts are combined is in app/js/merge.js (in the browser), how they travel is in app/js/sync.js.
//
//   GET /api/sync/<exam>              -> { resetAt, devices: { <deviceId>: { ts, data } } }
//   PUT /api/sync/<exam>/<deviceId>   body { ts, resetAt, data }  -> { resetAt }       (409 { resetAt } when that device missed a reset)
//
// The computer's own page may call it freely (checked by the caller); the phone must send the pairing key.
// The file is .lah-sync.json in the project folder (git ignores it, the launcher update leaves it alone).
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export const MAX_BODY = 1_500_000;
const MAX_DEVICES = 12;
const STALE_MS = 120 * 24 * 3600 * 1000;
const EXAM_RE = /^[a-z0-9-]{1,60}$/;
const DEVICE_RE = /^[a-f0-9]{8,32}$/;

export class SyncError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const newKey = () => crypto.randomBytes(10).toString('hex');

/** Checks the shape of one device's part. Anything odd is refused, nothing is repaired. */
function checkPart(examId, data) {
  if (!isObj(data) || data.v !== 1 || data.exam !== examId) throw new SyncError(400, 'That is not the progress of this exam.');
  for (const f of ['questions', 'cards', 'games', 'learn', 'calc', 'confuse', 'plan', 'study']) if (data[f] !== undefined && !isObj(data[f])) throw new SyncError(400, `Field "${f}" must be an object.`);
  if (data.sessions !== undefined && !Array.isArray(data.sessions)) throw new SyncError(400, 'Field "sessions" must be a list.');
  if (data.sessions && data.sessions.length > 400) throw new SyncError(400, 'Too many sessions.');
  for (const q of Object.values(data.questions || {})) if (!isObj(q)) throw new SyncError(400, 'A question entry must be an object.');
}

export function createSyncStore({ file, knownExams }) {
  let state = null;
  let writing = Promise.resolve();

  async function load() {
    if (state) return state;
    try {
      const d = JSON.parse(await fs.readFile(file, 'utf8'));
      state = { key: typeof d.key === 'string' && /^[a-f0-9]{20}$/.test(d.key) ? d.key : newKey(), exams: isObj(d.exams) ? d.exams : {} };
    } catch { state = { key: newKey(), exams: {} }; }
    return state;
  }
  /** Writes the file after the previous write finished: temp file, then rename, so a crash never leaves half a file. */
  function save() {
    const text = JSON.stringify(state);
    writing = writing.then(async () => { const tmp = `${file}.tmp`; await fs.writeFile(tmp, text); await fs.rename(tmp, file); }).catch(() => {});
    return writing;
  }
  const examState = (s, id) => (s.exams[id] ||= { resetAt: 0, devices: {} });

  async function assertExam(id) {
    if (!EXAM_RE.test(id) || !(await knownExams()).includes(id)) throw new SyncError(404, 'Unknown exam');
  }

  return {
    async key() { return (await load()).key; },
    /** A new pairing key: phones paired with the old one have to scan the code again. */
    async rotateKey() { const s = await load(); s.key = newKey(); await save(); return s.key; },
    async checkKey(k) {
      const s = await load();
      const a = Buffer.from(String(k || '')), b = Buffer.from(s.key);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    async pull(id) {
      await assertExam(id);
      const e = examState(await load(), id);
      return { resetAt: e.resetAt, devices: e.devices };
    },
    async push(id, device, body) {
      await assertExam(id);
      if (!DEVICE_RE.test(device)) throw new SyncError(400, 'Bad device id.');
      if (!isObj(body) || !Number.isFinite(body.ts) || body.ts < 0 || body.ts > Date.now() + 24 * 3600 * 1000) throw new SyncError(400, 'Bad time stamp.');
      const resetAt = Number.isFinite(body.resetAt) && body.resetAt >= 0 ? body.resetAt : 0;
      checkPart(id, body.data);
      if (JSON.stringify(body.data).length > MAX_BODY - 1000) throw new SyncError(413, 'Too much progress data.');
      const s = await load();
      const e = examState(s, id);
      if (resetAt < e.resetAt) throw new SyncError(409, 'A reset happened on another device. Sync again.', { resetAt: e.resetAt });
      if (resetAt > e.resetAt) {                         // a reset: every part older than it is gone
        e.resetAt = resetAt;
        for (const [d, v] of Object.entries(e.devices)) if (v.ts < resetAt) delete e.devices[d];
      }
      if (body.ts < e.resetAt) return { resetAt: e.resetAt, stored: false };   // an old part that arrived late
      const old = e.devices[device];
      if (old && body.ts < old.ts) return { resetAt: e.resetAt, stored: false };
      for (const [d, v] of Object.entries(e.devices)) if (Date.now() - v.ts > STALE_MS && d !== device) delete e.devices[d];
      if (!old && Object.keys(e.devices).length >= MAX_DEVICES) throw new SyncError(409, 'Too many devices for this exam.');
      e.devices[device] = { ts: body.ts, data: body.data };
      await save();
      return { resetAt: e.resetAt, stored: true };
    },
  };
}

async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new SyncError(413, 'Too large.'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SyncError(400, 'That is not valid JSON.'); }
}

/**
 * Answers /api/sync/... requests. `authorize(req)` (async, true/false) decides who may come in: the computer's own page, or a phone with the key.
 * Returns true when the request was one of ours.
 */
export async function handleSync(req, res, pathname, { store, authorize, send }) {
  const m = pathname.match(/^\/api\/sync\/([^/]+)(?:\/([^/]+))?$/);
  if (!m) return false;
  const reply = (status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
  try {
    if (!(await authorize(req))) { req.resume(); return reply(401, { error: 'Not paired' }), true; }
    if (req.method === 'GET' && !m[2]) return reply(200, await store.pull(m[1])), true;
    if (req.method === 'PUT' && m[2]) return reply(200, await store.push(m[1], m[2], await readBody(req))), true;
    req.resume();
    return reply(405, { error: 'Not allowed' }), true;
  } catch (e) {
    req.resume();
    if (e instanceof SyncError) return reply(e.status, { error: e.message, ...e.extra }), true;
    return reply(500, { error: 'Something went wrong' }), true;
  }
}
