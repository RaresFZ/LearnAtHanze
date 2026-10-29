// Fill-in grading. Pure (no DOM), shared by the quiz card and the exam simulation.
const norm = (s) =>
  String(s).toLowerCase().replace(/[%€$]/g, '').replace(/[^\p{L}\p{N}.\s-]/gu, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Fill-in grading: exact text match, a one-typo allowance for longer answers, or a numeric match. */
export function gradeFill(q, input) {
  const v = norm(input);
  if (!v) return false;
  for (const a of q.answers || []) {
    const na = norm(a);
    if (na === v || (na.length >= 6 && lev(na, v) <= 1)) return true;
  }
  if (q.numbers) {
    const m = String(input).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = parseFloat(m[0]);
      return q.numbers.some((t) => Math.abs(t - n) <= (q.tolerance ?? 1e-6));
    }
  }
  return false;
}
