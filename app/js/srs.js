// Spaced repetition: a small SM-2 style scheduler with four ratings. No DOM, so it can be tested in Node.
// A card's state: { due, interval, ease, reps, lapses, misses, first, last }
//   interval 0   = still being learned (new, or just missed): due again in minutes
//   interval 1+  = a review card: due that many days after the day it was rated
// Missing a card (Again) sends it back to minutes, lowers its ease and counts a lapse, so it comes back sooner and
// then grows more slowly than cards you know. Easy raises the ease.
export const MIN = 60 * 1000;
export const NEW_PER_DAY = 20;                 // new cards introduced per day, per exam
export const RATINGS = ['again', 'hard', 'good', 'easy'];

const MIN_EASE = 1.3;
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(startOfDay(ts)); d.setDate(d.getDate() + n); return d.getTime(); };
export const endOfDay = (ts) => addDays(ts, 1) - 1;

// misses counts every Again (a lapse only counts a miss of a card already learned); older saves lack it, so it defaults to 0.
const blank = () => ({ due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, misses: 0, first: 0, last: 0 });
export const isNew = (s) => !s || !s.first;

/** The state after rating a card. prev may be undefined for a card never seen. */
export function rate(prev, rating, now = Date.now()) {
  const c = { ...blank(), ...prev };
  const out = { ...c, first: c.first || now, last: now };
  if (rating === 'again') out.misses = c.misses + 1;
  if (c.interval === 0) {                      // new, or relearning after a miss
    if (rating === 'again') out.due = now + MIN;
    else if (rating === 'hard') out.due = now + 6 * MIN;
    else {
      out.interval = rating === 'good' ? 1 : 4;
      out.due = addDays(now, out.interval);
      out.reps = c.reps + 1;
      if (rating === 'easy') out.ease = c.ease + 0.15;
    }
    return out;
  }
  if (rating === 'again') {
    out.lapses = c.lapses + 1;
    out.ease = Math.max(MIN_EASE, c.ease - 0.2);
    out.interval = 0;
    out.due = now + MIN;
    return out;
  }
  out.reps = c.reps + 1;
  if (rating === 'hard') { out.interval = Math.max(c.interval + 1, Math.round(c.interval * 1.2)); out.ease = Math.max(MIN_EASE, c.ease - 0.15); }
  if (rating === 'good') out.interval = Math.max(c.interval + 1, Math.round(c.interval * c.ease));
  if (rating === 'easy') { out.interval = Math.max(c.interval + 2, Math.round(c.interval * c.ease * 1.3)); out.ease = c.ease + 0.15; }
  out.due = addDays(now, out.interval);
  return out;
}

/** "10 min", "1 day", "3 days", "2 wk", "2 mo": when a card would come back after a rating. */
export function nextLabel(prev, rating, now = Date.now()) {
  const s = rate(prev, rating, now);
  if (s.interval === 0) return `${Math.round((s.due - now) / MIN)} min`;
  const d = s.interval;
  if (d < 14) return d === 1 ? '1 day' : `${d} days`;
  if (d < 60) return `${Math.round(d / 7)} wk`;
  return `${Math.round(d / 30)} mo`;
}

/** Plain-words version of a due time, for "next card due ...". */
export function dueWhen(ts, now = Date.now()) {
  if (ts <= now) return 'now';
  const days = Math.round((startOfDay(ts) - startOfDay(now)) / 864e5);
  if (days === 0) return 'later today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** Counts for one exam's deck. states = progress.cards. */
export function deckStatus(cards, states, now = Date.now()) {
  const eod = endOfDay(now), sod = startOfDay(now);
  let learning = 0, review = 0, fresh = 0, introduced = 0, learned = 0, next = Infinity;
  for (const card of cards) {
    const s = states[card.id];
    if (isNew(s)) { fresh += 1; continue; }
    if (s.first >= sod) introduced += 1;
    if (s.interval >= 1) learned += 1;
    if (s.due <= eod) { if (s.interval === 0) learning += 1; else review += 1; } else next = Math.min(next, s.due);
  }
  const newToday = Math.min(fresh, Math.max(0, NEW_PER_DAY - introduced));
  return { total: cards.length, learning, review, newToday, due: learning + review + newToday, learned, next: next === Infinity ? null : next };
}

const shuffled = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Today's session order: cards being relearned, then reviews (most missed first), then new cards. */
export function buildQueue(cards, states, now = Date.now()) {
  const eod = endOfDay(now), sod = startOfDay(now);
  const learning = [], review = [], fresh = [];
  let introduced = 0;
  for (const card of cards) {
    const s = states[card.id];
    if (isNew(s)) fresh.push(card);
    else {
      if (s.first >= sod) introduced += 1;
      if (s.due <= eod) (s.interval === 0 ? learning : review).push(card);
    }
  }
  review.sort((a, b) => states[b.id].lapses - states[a.id].lapses || states[a.id].due - states[b.id].due);
  return [...shuffled(learning), ...review, ...shuffled(fresh).slice(0, Math.max(0, NEW_PER_DAY - introduced))];
}
