// "Study together": the rounds of a study game. Each round is one lesson part (from content/<exam>/lessons.json) followed by one question
// about it. Pure logic, no HTTP. The lesson text is course material that the players are meant to read before the question, so it is
// sent to phones in the 'lesson' phase; the usual rules for the question itself (no answer before the reveal) stay as they are.

const STOP = new Set('the a an and or of to in on for is are was be by with as at from that this it its not no only into than then so can could may must should will would do does did has have had you your their they them we our if when what which who whom how why more most less per also but about over under between within without each every any all some one two three four five up out off'.split(' '));
const tok = (s) => (String(s).toLowerCase().match(/[a-z0-9][a-z0-9&@'-]*/g) || []).map((w) => w.replace(/'s$/, '')).filter((w) => w.length > 2 && !STOP.has(w));

/** A question a live game can ask: multiple choice or true/false, never one flagged "Check the source". */
export const usable = (q) => !!q && (q.type === 'mc' || q.type === 'tf') && !q.flag;

/** How well a question fits a lesson part: shared words, relative to the size of the question. */
export function fit(part, q) {
  const words = new Set(tok([part.title, ...part.points, part.remember || ''].join(' ')));
  const qt = new Set(tok(`${q.question} ${q.type === 'mc' ? q.options[q.answer] : ''} ${q.explanation || ''}`));
  let hit = 0;
  for (const w of qt) if (words.has(w)) hit++;
  return hit / Math.sqrt(qt.size || 1);
}
export const MIN_FIT = 0.9;

/**
 * The parts of the chosen topics, in the order of the lessons, each with its question:
 * the part's "study" question, else its "ask" (quick check) question, else the best fitting unused question of the topic.
 * A part without a usable question is left out. Returns [{ topicId, topicTitle, part, parts, lesson: { title, points, remember }, q }].
 */
export function studyParts({ lessons, topics = [], questions, topicIds = [] }) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const wanted = new Set(topicIds);
  const order = (lessons?.order || Object.keys(lessons?.topics || {})).filter((id) => wanted.has(id) && lessons.topics[id]);
  const used = new Set();
  const out = [];
  for (const topicId of order) {
    const l = lessons.topics[topicId];
    const topicTitle = topics.find((t) => t.id === topicId)?.title || topicId;
    const pool = questions.filter((q) => q.topic === topicId && usable(q));
    l.chunks.forEach((c, k) => {
      if (Array.isArray(c.study) && !c.study.length) return;                  // "study": [] leaves the part out
      let q = null;
      for (const id of [c.study?.[0], c.ask?.[0]]) { const cand = byId.get(id); if (id && usable(cand) && !used.has(cand.id)) { q = cand; break; } }
      if (!q) {
        const best = pool.filter((x) => !used.has(x.id)).map((x) => ({ x, s: fit(c, x) })).sort((a, b) => b.s - a.s)[0];
        if (best && best.s >= MIN_FIT) q = best.x;
      }
      if (!q) return;
      used.add(q.id);
      out.push({ topicId, topicTitle, part: k + 1, parts: l.chunks.length, lesson: { topic: topicTitle, title: c.title, points: c.points, remember: c.remember || '', part: k + 1, parts: l.chunks.length }, q });
    });
  }
  return out;
}
