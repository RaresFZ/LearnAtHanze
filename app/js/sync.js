// Keeps your progress the same on every device you use (the computer's browser and the phone's browser).
// Each device sends its own part of every exam to your computer and fetches the parts of the other devices; store.js shows them combined.
// The computer's own page talks to the app on the same computer (no key). The phone talks to the phone copy and shows the pairing key it got from the QR code.
import { loadOwn, replaceOwn, loadPeers, savePeers, syncMeta, saveSyncMeta } from './store.js';
import { planSync } from './sync-core.js';

const DEVICE_KEY = 'learnathanze:device';
const PAIR_KEY = 'learnathanze:synckey';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } };

let cfg = { base: '', onPhone: false };
/** Shared with the screens: { status: 'off' | 'idle' | 'syncing' | 'ok' | 'offline' | 'unpaired' | 'error', last, devices, error } */
export const syncState = { status: 'off', last: 0, devices: 1, error: '' };
const announce = () => { try { globalThis.dispatchEvent?.(new CustomEvent('lah:sync', { detail: { ...syncState } })); } catch { /* no window */ } };
const set = (patch) => { Object.assign(syncState, patch); announce(); };

export function deviceId() {
  let id = get(DEVICE_KEY);
  if (!/^[a-f0-9]{16}$/.test(id || '')) {
    const bytes = new Uint8Array(8);
    (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
    id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    put(DEVICE_KEY, id);
  }
  return id;
}

/** onPhone: this is the phone copy (needs the pairing key). base: where the app lives (tests pass a full address). */
export function configureSync(c) { cfg = { ...cfg, ...c }; set({ status: paired() ? 'idle' : 'unpaired' }); }

/** The phone opens the app from the QR code: ...?k=<key>. The key is kept; the address stays as it is so "Add to Home Screen" keeps it too. */
export function takeKeyFromUrl(search = globalThis.location?.search || '') {
  const k = new URLSearchParams(search).get('k');
  if (k && /^[a-f0-9]{20}$/.test(k)) { put(PAIR_KEY, k); return true; }
  return false;
}
export const paired = () => !cfg.onPhone || !!get(PAIR_KEY);
export function forgetPairing() { put(PAIR_KEY, null); set({ status: 'unpaired' }); }

async function call(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const key = get(PAIR_KEY);
  if (cfg.onPhone && key) headers['X-Sync-Key'] = key;
  const res = await fetch(`${cfg.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}

const deviceCount = {};      // per exam: how many devices have progress there; the screen shows the highest
let running = Promise.resolve();
/** One sync of one exam: fetch the other devices' parts, send this device's part if it changed. Returns true when what you see may have changed. */
export function syncExam(examId) {
  const job = running.then(() => doSync(examId)).catch(() => false);
  running = job.then(() => {});
  return job;
}

async function doSync(examId) {
  if (!paired()) return false;
  const device = deviceId();
  set({ status: 'syncing' });
  try {
    const pull = await call('GET', `/api/sync/${examId}`);
    const meta = syncMeta(examId);
    const own = loadOwn(examId);
    const hasOwn = !!own && (own.ts || Object.keys(own.questions).length || Object.keys(own.cards).length || own.sessions.length);
    const plan = planSync({ examId, device, meta, own: hasOwn ? own : null, pull });
    const before = JSON.stringify(loadPeers(examId)) + String(meta.resetAt);
    if (plan.clearOwn) replaceOwn(examId, null);
    savePeers(examId, plan.peers);
    let after = plan.meta;
    if (plan.push) {
      try { await call('PUT', `/api/sync/${examId}/${device}`, plan.push); } catch (e) {
        if (e.status === 409) { set({ status: 'idle' }); return false; }      // a reset happened on another device a moment ago: the next sync takes it over
        throw e;
      }
    }
    saveSyncMeta(examId, { ...meta, ...after, last: Date.now() });
    const changed = plan.clearOwn || before !== JSON.stringify(loadPeers(examId)) + String(plan.meta.resetAt);
    deviceCount[examId] = 1 + Object.keys(plan.peers).length;
    set({ status: 'ok', last: Date.now(), devices: Math.max(...Object.values(deviceCount)), error: '' });
    return changed;
  } catch (e) {
    if (e.status === 401) { set({ status: 'unpaired', error: 'The pairing code is not valid any more. Scan the QR code on the computer again.' }); return false; }
    set({ status: e instanceof TypeError ? 'offline' : 'error', error: e instanceof TypeError ? 'The computer cannot be reached.' : e.message });
    return false;
  }
}

/** Every exam in turn. Returns true when something changed that the open screen should show. */
export async function syncAll(examIds) {
  let changed = false;
  for (const id of examIds) if (await syncExam(id)) changed = true;
  return changed;
}

/**
 * Sync in the background: a few seconds after a change on this device, when the page comes back to the front, and once a minute while it is open.
 * onChanged(): called when another device's progress arrived (the screen can refresh itself when that is safe).
 */
export function startAutoSync(examIds, onChanged = () => {}) {
  const ids = () => (typeof examIds === 'function' ? examIds() : examIds);
  const run = async (list) => { if (await syncAll(list)) onChanged(); };
  let timer = 0; const dirty = new Set();
  globalThis.addEventListener?.('lah:progress', (e) => {
    dirty.add(e.detail.examId); clearTimeout(timer);
    timer = setTimeout(() => { const l = [...dirty]; dirty.clear(); run(l); }, 4000);
  });
  globalThis.document?.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(ids()); });
  setInterval(() => { if (!globalThis.document || document.visibilityState === 'visible') run(ids()); }, 60000);
}
