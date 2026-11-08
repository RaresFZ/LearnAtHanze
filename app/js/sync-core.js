// What one sync of one exam has to do, decided from what this device knows and what the computer answered. Pure: no network, no storage.
// (sync.js does the talking; merge.js says how the parts are combined.)
import { partTime } from './merge.js';

const num = (v) => (Number.isFinite(v) ? v : 0);

export const emptyPart = (examId, ts = 0) => ({ v: 1, exam: examId, questions: {}, cards: {}, games: {}, learn: {}, calc: {}, confuse: {}, plan: {}, study: {}, sessions: [], bestStreak: 0, streak: 0, ts });

/**
 * meta:  { resetAt, pushedTs, pushedReset }  what this device last agreed on with the computer
 * own:   this device's part (or null when it has none)
 * pull:  { resetAt, devices: { id: { ts, data } } }  what the computer holds
 * Returns { clearOwn, meta, peers, push } where push is the body to send (or null when there is nothing new),
 * and meta is the bookkeeping to keep once the push went through (pushedTs and pushedReset already updated).
 */
export function planSync({ examId, device, meta, own, pull }) {
  const m = { resetAt: num(meta.resetAt), pushedTs: num(meta.pushedTs), pushedReset: num(meta.pushedReset) };
  let mine = own;
  let clearOwn = false;
  const serverReset = num(pull.resetAt);
  if (serverReset > m.resetAt) {                    // another device reset this exam: what this device had is gone too
    clearOwn = true; mine = null;
    m.resetAt = serverReset; m.pushedReset = serverReset; m.pushedTs = 0;
  }
  const peers = {};
  for (const [id, v] of Object.entries(pull.devices || {})) {
    if (id === device || !v || typeof v.data !== 'object' || v.data === null) continue;
    if (num(v.ts) < m.resetAt) continue;              // older than the last reset
    peers[id] = v.data;
  }
  const ownTs = mine ? partTime(mine) : 0;
  const resetToAnnounce = m.resetAt > m.pushedReset;
  let push = null;
  if (resetToAnnounce || ownTs !== m.pushedTs) {
    const data = mine || emptyPart(examId, m.resetAt);
    push = { ts: mine ? ownTs : m.resetAt, resetAt: m.resetAt, data };
    if (!mine && !resetToAnnounce) push = null;
  }
  const after = { ...m, pushedTs: push ? push.ts : m.pushedTs, pushedReset: push ? m.resetAt : m.pushedReset };
  return { clearOwn, meta: after, peers, push };
}
