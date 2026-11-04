// "Easily confused" drills (pure, no DOM): groups of look-alike terms from content/<exam>/confusions.json.
// A drill item is a clue (a statement from the course) and the terms of its group; the learner picks the term it describes.

export const MAX_OPTIONS = 4;

const shuffled = (arr, rng) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** A term name without a bracketed part, for checking that a clue does not give its own answer away: "Skills (unused talent)" -> "skills". */
export const bareName = (name) => name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase();

/** One drill item for a clue of a term. Options: the right term plus other terms of the group (at most MAX_OPTIONS), shuffled. */
export function makeItem(group, term, clue, rng = Math.random) {
  const others = shuffled(group.terms.filter((t) => t.name !== term.name), rng).slice(0, MAX_OPTIONS - 1);
  const options = shuffled([term, ...others], rng);
  return { gid: group.id, title: group.title, clue, term, options: options.map((t) => t.name), answer: options.findIndex((t) => t.name === term.name), byName: Object.fromEntries(group.terms.map((t) => [t.name, t])), src: group.src, topic: group.topic };
}

/** n drill items from the chosen groups (all when none given). Spreads over the groups; a clue is not repeated until all are used. */
export function drillItems(groups, { n = 10, only = [], rng = Math.random } = {}) {
  const chosen = groups.filter((g) => !only.length || only.includes(g.id));
  const bags = chosen.map((g) => ({ g, triples: shuffled(g.terms.flatMap((t) => t.clues.map((c) => ({ t, c }))), rng) }));
  const out = [];
  let k = 0, guard = 0;
  while (out.length < n && bags.length && guard++ < n * 20) {
    const bag = bags[k % bags.length]; k++;
    if (!bag.triples.length) { bag.triples = shuffled(bag.g.terms.flatMap((t) => t.clues.map((c) => ({ t, c }))), rng); }
    const { t, c } = bag.triples.pop();
    out.push(makeItem(bag.g, t, c, rng));
  }
  return out;
}

/** Problems in a confusions.json, as a list of messages (shared by validate.mjs and the tests). */
export function checkConfusions(config, { topicIds = new Set(), docKeys = new Set() } = {}) {
  const errors = [], warnings = [];
  const groups = config?.groups;
  if (!Array.isArray(groups) || !groups.length) return { errors: ['"groups" must be a non-empty array'], warnings };
  const ids = new Set();
  for (const g of groups) {
    const where = `group "${g.id}"`;
    if (!g.id || ids.has(g.id)) errors.push(`${where}: missing or duplicate id`);
    ids.add(g.id);
    if (!g.title) errors.push(`${where}: no title`);
    if (g.topic && topicIds.size && !topicIds.has(g.topic)) errors.push(`${where}: unknown topic "${g.topic}"`);
    if (docKeys.size && (!Array.isArray(g.src) || !docKeys.has(g.src[0]))) errors.push(`${where}: src must be [documentKey, location] with a key from exam.json`);
    if (!Array.isArray(g.terms) || g.terms.length < 2) { errors.push(`${where}: needs at least 2 terms`); continue; }
    const names = new Set(), clues = new Map();
    for (const t of g.terms) {
      if (!t.name || names.has(t.name)) errors.push(`${where}: a term has no name or a duplicate name`);
      names.add(t.name);
      if (!t.means || !t.tip) errors.push(`${where} / ${t.name}: needs "means" and "tip"`);
      if (!Array.isArray(t.clues) || !t.clues.length || t.clues.some((c) => typeof c !== 'string' || !c.trim())) { errors.push(`${where} / ${t.name}: needs at least one clue (text)`); continue; }
      for (const c of t.clues) {
        if (clues.has(c)) errors.push(`${where}: the clue "${c.slice(0, 40)}..." is used by ${clues.get(c)} and ${t.name}`);
        clues.set(c, t.name);
        if (c.toLowerCase().includes(bareName(t.name)) && bareName(t.name).length > 2) warnings.push(`${where} / ${t.name}: a clue contains the term itself ("${c.slice(0, 50)}...")`);
      }
    }
  }
  return { errors, warnings };
}

/** { n, right, share } for one group from the saved progress. */
export function groupStat(progress, groupId) {
  const c = progress.confuse?.[groupId];
  return c && c.n ? { n: c.n, right: c.right, share: c.right / c.n } : { n: 0, right: 0, share: 0 };
}
