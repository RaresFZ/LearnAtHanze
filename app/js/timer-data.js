// Study timer rules (pure, no DOM): 25 minutes of focus, then a 5 minute break. The state is { mode, startedAt, endsAt } in ms,
// kept in localStorage so a running timer survives a page change; settle() catches up on whatever ended while no page was watching.

export const FOCUS_MIN = 25;
export const BREAK_MIN = 5;
const MIN = 60000;

export const start = (now, mode = 'focus') => ({ mode, startedAt: now, endsAt: now + (mode === 'focus' ? FOCUS_MIN : BREAK_MIN) * MIN });

/**
 * Brings a saved state up to `now`. Returns { state, credited, finished }:
 * credited = minutes of focus to add to the study time, finished = 'focus' or 'break' when one just ended (for a notice).
 */
export function settle(state, now) {
  if (!state) return { state: null, credited: 0, finished: null };
  if (now < state.endsAt) return { state, credited: 0, finished: null };
  if (state.mode === 'break') return { state: null, credited: 0, finished: 'break' };
  const brk = start(state.endsAt, 'break');
  return { state: now < brk.endsAt ? brk : null, credited: FOCUS_MIN, finished: 'focus' };
}

/** The learner stops the timer: a focus session in progress is credited for the time it ran (when it was at least a minute). */
export function stop(state, now) {
  if (!state || state.mode !== 'focus') return { state: null, credited: 0 };
  const minutes = (Math.min(now, state.endsAt) - state.startedAt) / MIN;
  return { state: null, credited: minutes >= 1 ? Math.round(minutes * 10) / 10 : 0 };
}

export const remaining = (state, now) => (state ? Math.max(0, state.endsAt - now) : 0);

/** 1500000 -> "25:00" */
export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 135 -> "2 h 15 min", 45 -> "45 min" */
export function hm(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
