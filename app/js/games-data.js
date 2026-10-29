// Mini games, the parts that need no DOM: which pairs and questions a game may use, how rounds are picked, and the scoring.
// Nothing here is new content. A "pair" is one of the exam's own questions (the question is the clue, its answer is the match),
// chosen in content/<exam>/games.json; the quick games use the exam's own short multiple-choice and true/false questions.
import { answerText } from './cards.js';

export const MATCH = { rounds: 3, size: 6 };         // 3 rounds of 6 pairs
export const SORT = { rounds: 3, buckets: 3, per: 3 };   // 3 rounds, 3 topics each, 3 questions per topic
export const SPEED = { seconds: 60, penalty: 3 };    // a wrong answer takes 3 seconds off the clock
export const COMBO = { lives: 3, step: 3, maxMultiplier: 5, points: 10 };
export const MAX_CLUE = 120, MAX_ANSWER = 90;         // longer texts do not fit a game card

const shuffled = (arr, rnd = Math.random) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** games.json: { pairs: [question ids] }. Unknown ids are skipped (validate reports them). */
export function buildPairs(questions, config) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return (config?.pairs || []).map((id) => byId.get(id)).filter(Boolean)
    .map((q) => ({ id: q.id, topic: q.topic, clue: q.question, answer: capital(answerText(q)), src: q.src, flag: q.flag }));
}

/** Rounds of `size` pairs; inside a round no two pairs share an answer or a clue, and pairs are not reused while others are left. */
export function planMatch(pairs, { rounds = MATCH.rounds, size = MATCH.size } = {}, rnd = Math.random) {
  const out = [];
  let pool = shuffled(pairs, rnd);
  for (let r = 0; r < rounds; r++) {
    const round = [];
    const used = (p) => round.some((x) => x.answer === p.answer || x.clue === p.clue);
    for (const p of pool) if (round.length < size && !used(p)) round.push(p);
    if (round.length < size) {                          // the fresh pairs ran out: top up from every pair
      for (const p of shuffled(pairs, rnd)) if (round.length < size && !round.includes(p) && !used(p)) round.push(p);
    }
    if (round.length < size) return out;                // not enough distinct pairs for another full round
    out.push(round);
    pool = pool.filter((p) => !round.includes(p));
    if (pool.length < size) pool = shuffled(pairs, rnd);
  }
  return out;
}

/** Topics that have enough pairs to be a sorting bucket. */
export function sortTopics(pairs, per = SORT.per) {
  const n = new Map();
  for (const p of pairs) n.set(p.topic, (n.get(p.topic) || 0) + 1);
  return [...n].filter(([, c]) => c >= per).map(([t]) => t);
}

/** Rounds of { buckets: [{ topic, items: [pair x per] }] }; different topics every round while enough topics remain. */
export function planSort(pairs, { rounds = SORT.rounds, buckets = SORT.buckets, per = SORT.per } = {}, rnd = Math.random) {
  const topics = sortTopics(pairs, per);
  if (topics.length < buckets) return [];
  const out = [];
  let fresh = shuffled(topics, rnd);
  for (let r = 0; r < rounds; r++) {
    if (fresh.length < buckets) fresh = [...fresh, ...shuffled(topics.filter((t) => !fresh.includes(t)), rnd)];
    const chosen = fresh.splice(0, buckets);
    out.push({ buckets: chosen.map((topic) => ({ topic, items: shuffled(pairs.filter((p) => p.topic === topic), rnd).slice(0, per) })) });
  }
  return out;
}

/** Quick games use short multiple-choice and true/false questions without a "check the source" flag (a flagged fact is not a fair one to race on). */
export function quickPool(questions) {
  return questions.filter((q) => !q.flag && q.question.length <= MAX_CLUE + 20 && (q.type === 'tf' || (q.type === 'mc' && q.options.every((o) => o.length <= 80))));
}

// ---- scoring: higher is always better
/** Match and Sort: 10 per correct, minus 5 per wrong try, never below 0. */
export const roundScore = (correct, wrong) => Math.max(0, correct * 10 - wrong * 5);

/** Combo run: the multiplier is 1 and goes up by 1 for every 3 right in a row, up to 5. */
export const multiplier = (streak) => Math.min(COMBO.maxMultiplier, 1 + Math.floor(streak / COMBO.step));
export function comboStart() { return { score: 0, streak: 0, best: 0, lives: COMBO.lives, answered: 0, correct: 0 }; }
/** The answer is scored with the multiplier you had before it. A wrong answer costs a life and resets the streak. */
export function comboAnswer(s, right) {
  const next = { ...s, answered: s.answered + 1 };
  if (right) {
    next.score += COMBO.points * multiplier(s.streak);
    next.streak = s.streak + 1; next.best = Math.max(s.best, next.streak); next.correct = s.correct + 1;
  } else { next.streak = 0; next.lives = s.lives - 1; }
  return next;
}
export const comboOver = (s) => s.lives <= 0;

/** Speed round: a wrong answer moves the end of the clock closer. Returns the new end time. */
export const speedPenalty = (endAt) => endAt - SPEED.penalty * 1000;
