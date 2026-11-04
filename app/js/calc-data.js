// Calculation trainer rules (pure, no DOM): question generators built on the formulas of the syllabus, and answer grading.
// Every generator makes fresh numbers each time and says which formula it used and the steps, so a wrong answer can be understood.
// The formulas themselves are in FORMULAS, and tools/test-calc.mjs checks them against the syllabus's own worked examples.

/** The formulas, one place. Percent results are returned as numbers like 87.5 (not 0.875). */
export const FORMULAS = {
  takt: (availableMin, demand) => availableMin / demand,
  flowTime: (wip, throughput) => wip / throughput,                       // Little's Law
  wip: (throughput, flowTime) => throughput * flowTime,
  throughput: (wip, flowTime) => wip / flowTime,
  pce: (valueAddedMin, leadTimeMin) => (valueAddedMin / leadTimeMin) * 100,
  ftr: (processed, reworked) => ((processed - reworked) / processed) * 100,
  dpu: (defects, units) => defects / units,
  dpo: (defects, units, opportunities) => defects / (units * opportunities),
  dpmo: (defects, units, opportunities) => (defects / (units * opportunities)) * 1e6,
  defectiveRate: (defectiveUnits, units) => (defectiveUnits / units) * 100,
  rty: (yieldsPercent) => yieldsPercent.reduce((p, y) => p * (y / 100), 1) * 100,
  oee: (a, p, q) => ((a / 100) * (p / 100) * (q / 100)) * 100,
  availability: (plannedMin, downtimeMin) => ((plannedMin - downtimeMin) / plannedMin) * 100,
  performance: (idealCycleMin, totalCount, operatingMin) => ((idealCycleMin * totalCount) / operatingMin) * 100,
  quality: (good, total) => (good / total) * 100,
  rpn: (s, o, d) => s * o * d,
  cp: (usl, lsl, sigma) => (usl - lsl) / (6 * sigma),
  relativeReduction: (from, to) => ((from - to) / from) * 100,
};

const R = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const n0 = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const fix = (x, d) => round(x, d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const GROUPS = [
  { id: 'flow', label: 'Time and flow' },
  { id: 'quality', label: 'Defects and yield' },
  { id: 'oee', label: 'OEE' },
  { id: 'other', label: 'Risk, capability, change' },
];

/** id, group, label, src, make(rng) -> { prompt, unit, answer, decimals, formula, steps } */
export const GENERATORS = [
  { id: 'takt', group: 'flow', label: 'Takt time', src: ['syl', 'Ch.6, p.7'], make(rng) {
    for (;;) {
      const avail = pick(rng, [360, 400, 420, 450, 480]), t = pick(rng, [2, 3, 4, 5, 6]);
      if (avail % t) continue;
      const d = avail / t;
      return { prompt: `A team has ${avail} available minutes per day and demand for ${d} requests per day. What is the takt time?`, unit: 'minutes per request', answer: t, decimals: 0,
        formula: 'takt time = net available time ÷ customer demand', steps: [`${avail} ÷ ${d} = ${t} minutes per request`] };
    }
  } },
  { id: 'little-flow', group: 'flow', label: "Little's Law: flow time", src: ['syl', 'Ch.6, p.7'], make(rng) {
    const x = pick(rng, [10, 20, 25, 30, 40, 50]), f = pick(rng, [1, 2, 3, 4, 5, 6, 8]), w = x * f;
    return { prompt: `There are ${w} open cases and ${x} cases are completed per day. By Little's Law, what is the average flow time?`, unit: 'days', answer: f, decimals: 0,
      formula: "Little's Law: average WIP = throughput rate × average flow time, so flow time = WIP ÷ throughput", steps: [`${w} ÷ ${x} = ${f} days`] };
  } },
  { id: 'little-wip', group: 'flow', label: "Little's Law: WIP", src: ['syl', 'Ch.6, p.7'], make(rng) {
    const x = pick(rng, [10, 15, 20, 25, 30, 40]), f = pick(rng, [2, 3, 4, 5, 6]), w = x * f;
    return { prompt: `A process completes ${x} cases per day and the average flow time is ${f} days. By Little's Law, what is the average WIP (open cases)?`, unit: 'cases', answer: w, decimals: 0,
      formula: "Little's Law: average WIP = throughput rate × average flow time", steps: [`${x} × ${f} = ${w} cases`] };
  } },
  { id: 'little-throughput', group: 'flow', label: "Little's Law: throughput", src: ['syl', 'Ch.6, p.7'], make(rng) {
    const x = pick(rng, [10, 20, 25, 30, 40, 50]), f = pick(rng, [2, 3, 4, 5]), w = x * f;
    return { prompt: `There are ${w} open cases and the average flow time is ${f} days. By Little's Law, how many cases are completed per day?`, unit: 'cases per day', answer: x, decimals: 0,
      formula: "Little's Law: WIP = throughput × flow time, so throughput = WIP ÷ flow time", steps: [`${w} ÷ ${f} = ${x} cases per day`] };
  } },
  { id: 'pce', group: 'flow', label: 'Process cycle efficiency', src: ['syl', 'Ch.5, p.6'], make(rng) {
    const va = pick(rng, [12, 15, 18, 20, 24, 30, 36]), d = pick(rng, [1, 2, 3, 4, 5]), m = d * 1440, a = round(FORMULAS.pce(va, m), 2);
    return { prompt: `A request needs ${va} minutes of value-added work but spends ${d} calendar day${d > 1 ? 's' : ''} (${n0(m)} minutes) in total. What is the process cycle efficiency (2 decimals)?`, unit: '%', answer: a, decimals: 2,
      formula: 'PCE = value-added time ÷ total lead time × 100%', steps: [`${va} ÷ ${n0(m)} × 100 = ${fix(a, 2)}%`] };
  } },
  { id: 'ftr', group: 'quality', label: 'First Time Right', src: ['syl', 'Ch.6, p.7'], make(rng) {
    const n = pick(rng, [200, 250, 400, 500, 1000]), r = R(rng, Math.round(n * 0.04), Math.round(n * 0.2)), a = round(FORMULAS.ftr(n, r), 1);
    return { prompt: `${n} tickets were processed and ${r} of them needed rework (they were reopened). What is First Time Right (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'FTR = units completed correctly without rework on the first attempt ÷ units processed × 100%', steps: [`(${n} − ${r}) ÷ ${n} × 100 = ${n - r} ÷ ${n} × 100 = ${fix(a, 1)}%`] };
  } },
  { id: 'dpu', group: 'quality', label: 'DPU', src: ['syl', 'Ch.7, p.8'], make(rng) {
    const n = pick(rng, [100, 200, 250, 500, 1000]), d = R(rng, Math.round(n * 0.03), Math.round(n * 0.2)), a = round(FORMULAS.dpu(d, n), 3);
    return { prompt: `${n} forms were processed and ${d} defects were found. What is the DPU, defects per unit (3 decimals)?`, unit: '', answer: a, decimals: 3,
      formula: 'DPU = total defects ÷ total units', steps: [`${d} ÷ ${n} = ${fix(a, 3)}`] };
  } },
  { id: 'dpo', group: 'quality', label: 'DPO', src: ['syl', 'Ch.7, p.8'], make(rng) {
    const n = pick(rng, [200, 250, 500, 1000]), o = pick(rng, [2, 4, 5, 10]), d = R(rng, Math.round(n * 0.05), Math.round(n * 0.4)), a = round(FORMULAS.dpo(d, n, o), 4);
    return { prompt: `${n} forms have ${o} defect opportunities each, and ${d} defects were found. What is the DPO, defects per opportunity (4 decimals)?`, unit: '', answer: a, decimals: 4,
      formula: 'DPO = total defects ÷ (units × opportunities per unit)', steps: [`${d} ÷ (${n} × ${o}) = ${d} ÷ ${n * o} = ${fix(a, 4)}`] };
  } },
  { id: 'dpmo', group: 'quality', label: 'DPMO', src: ['syl', 'Ch.7, p.8'], make(rng) {
    const n = pick(rng, [200, 250, 400, 500, 600, 1000, 1200]), o = pick(rng, [2, 3, 4, 5]), d = R(rng, Math.round(n * 0.04), Math.round(n * 0.25)), a = Math.round(FORMULAS.dpmo(d, n, o));
    return { prompt: `${n} units have ${o} defect opportunities each, and ${d} defects were found. What is the DPMO (whole number)?`, unit: 'defects per million opportunities', answer: a, decimals: 0,
      formula: 'DPMO = DPO × 1,000,000, with DPO = defects ÷ (units × opportunities)', steps: [`DPO = ${d} ÷ (${n} × ${o}) = ${d} ÷ ${n * o}`, `DPMO = ${d} ÷ ${n * o} × 1,000,000 = ${n0(a)}`] };
  } },
  { id: 'defective-rate', group: 'quality', label: 'Defective-unit rate', src: ['syl', 'Ch.7, p.8'], make(rng) {
    const n = pick(rng, [200, 400, 500, 1000]), k = R(rng, Math.round(n * 0.03), Math.round(n * 0.12)), d = k + R(rng, 2, Math.round(k * 0.3) + 2), a = round(FORMULAS.defectiveRate(k, n), 1);
    return { prompt: `In ${n} forms, ${d} defects are found, spread over ${k} forms. What is the defective-unit rate (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'defective-unit rate = defective units ÷ units (the DPU counts defects, not defective units)', steps: [`${k} ÷ ${n} × 100 = ${fix(a, 1)}%`, `(The ${d} defects only matter for the DPU: ${d} ÷ ${n}.)`] };
  } },
  { id: 'rty', group: 'quality', label: 'Rolled throughput yield', src: ['syl', 'Ch.7, p.8'], make(rng) {
    const ys = [R(rng, 90, 99), R(rng, 90, 99), R(rng, 88, 99)], a = round(FORMULAS.rty(ys), 1);
    return { prompt: `A process has three steps with first-pass yields of ${ys[0]}%, ${ys[1]}% and ${ys[2]}%. What is the rolled throughput yield (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'RTY = the product of the step first-pass yields', steps: [`${ys[0] / 100} × ${ys[1] / 100} × ${ys[2] / 100} = ${round(a / 100, 4)} = ${fix(a, 1)}%`] };
  } },
  { id: 'oee', group: 'oee', label: 'OEE from the three factors', src: ['syl', 'Ch.12, p.12'], make(rng) {
    const A = pick(rng, [80, 85, 90, 95]), P = pick(rng, [70, 75, 80, 85, 90]), Q = pick(rng, [90, 95, 98]), a = round(FORMULAS.oee(A, P, Q), 1);
    return { prompt: `A machine has availability ${A}%, performance ${P}% and quality ${Q}%. What is the OEE (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'OEE = Availability × Performance × Quality', steps: [`${A / 100} × ${P / 100} × ${Q / 100} = ${round(a / 100, 4)} = ${fix(a, 1)}%`] };
  } },
  { id: 'oee-availability', group: 'oee', label: 'OEE: availability', src: ['syl', 'Ch.12, p.12'], make(rng) {
    const planned = pick(rng, [420, 480, 540]), dt = pick(rng, [30, 45, 60, 75, 90]), op = planned - dt, a = round(FORMULAS.availability(planned, dt), 1);
    return { prompt: `Planned production time is ${planned} minutes and the machine is down for ${dt} minutes. What is the availability (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'Availability = operating time ÷ planned production time', steps: [`operating time = ${planned} − ${dt} = ${op} minutes`, `${op} ÷ ${planned} × 100 = ${fix(a, 1)}%`] };
  } },
  { id: 'oee-performance', group: 'oee', label: 'OEE: performance', src: ['syl', 'Ch.12, p.12'], make(rng) {
    const op = pick(rng, [360, 420, 450]), c = pick(rng, [1, 1.5, 2]), cnt = Math.round((op / c) * pick(rng, [0.8, 0.85, 0.9])), a = round(FORMULAS.performance(c, cnt, op), 1);
    return { prompt: `The operating time is ${op} minutes, the ideal cycle time is ${c} minutes and ${cnt} units were made in total. What is the performance (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'Performance = (ideal cycle time × total count) ÷ operating time', steps: [`${c} × ${cnt} = ${round(c * cnt, 2)} minutes`, `${round(c * cnt, 2)} ÷ ${op} × 100 = ${fix(a, 1)}%`] };
  } },
  { id: 'oee-quality', group: 'oee', label: 'OEE: quality', src: ['syl', 'Ch.12, p.12'], make(rng) {
    const t = pick(rng, [150, 180, 200, 250]), g = t - R(rng, Math.round(t * 0.02), Math.round(t * 0.12)), a = round(FORMULAS.quality(g, t), 1);
    return { prompt: `${t} units were made and ${g} of them were good. What is the quality (1 decimal)?`, unit: '%', answer: a, decimals: 1,
      formula: 'Quality = good count ÷ total count', steps: [`${g} ÷ ${t} × 100 = ${fix(a, 1)}%`] };
  } },
  { id: 'rpn', group: 'other', label: 'FMEA risk priority number', src: ['syl', 'Ch.8, p.9'], make(rng) {
    const s = R(rng, 2, 10), o = R(rng, 2, 9), d = R(rng, 2, 9);
    return { prompt: `A failure mode scores severity ${s}, occurrence ${o} and detectability ${d}. What is the risk priority number (RPN)?`, unit: '', answer: s * o * d, decimals: 0,
      formula: 'RPN = Severity × Occurrence × Detectability', steps: [`${s} × ${o} × ${d} = ${s * o * d}`] };
  } },
  { id: 'cp', group: 'other', label: 'Cp', src: ['syl', 'Ch.9, p.10'], make(rng) {
    const lsl = R(rng, 10, 40), w = pick(rng, [6, 9, 12, 15, 18, 24]), sigma = pick(rng, [0.5, 1, 1.5, 2, 2.5]), usl = lsl + w, a = round(FORMULAS.cp(usl, lsl, sigma), 2);
    return { prompt: `A process has a lower specification limit of ${lsl}, an upper specification limit of ${usl} and a within-process standard deviation of ${sigma}. What is Cp (2 decimals)?`, unit: '', answer: a, decimals: 2,
      formula: 'Cp = (USL − LSL) ÷ (6σ)', steps: [`(${usl} − ${lsl}) ÷ (6 × ${sigma}) = ${w} ÷ ${round(6 * sigma, 2)} = ${fix(a, 2)}`] };
  } },
  { id: 'relative-reduction', group: 'other', label: 'Relative reduction', src: ['syl', 'Ch.14, p.14'], make(rng) {
    const x = pick(rng, [200, 300, 400, 500]), p = pick(rng, [20, 25, 40, 50]), y = x * (1 - p / 100);
    return { prompt: `SLA misses fall from ${x} to ${y} per 1,000 tickets. What is the relative reduction?`, unit: '%', answer: p, decimals: 0,
      formula: 'relative reduction = (old − new) ÷ old × 100%. The absolute reduction is the difference in points.', steps: [`(${x} − ${y}) ÷ ${x} × 100 = ${p}%`, `(Absolute: ${(x - y) / 10} percentage points, from ${x / 10}% to ${y / 10}%.)`] };
  } },
];

export const generatorsFor = (examId) => (examId === 'lean-agile' ? GENERATORS : []);

/** n questions from the chosen groups (all when none given), cycling through shuffled generators so the types vary. */
export function makeSet(examId, { groups = [], n = 10, rng = Math.random } = {}) {
  const pool = generatorsFor(examId).filter((g) => !groups.length || groups.includes(g.group));
  if (!pool.length) return [];
  const out = [];
  let bag = [];
  while (out.length < n) {
    if (!bag.length) { bag = pool.slice(); for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    const g = bag.pop();
    out.push({ gid: g.id, group: g.group, label: g.label, src: g.src, ...g.make(rng) });
  }
  return out;
}

/** Reads what a person typed: "20,000", "20000", "87.5%", "0,42", "3 minutes". Returns a number or null. */
export function parseNumber(text) {
  let s = String(text ?? '').trim().replace(/%/g, '').replace(/\s+/g, '');
  const m = s.match(/^[-+]?[\d.,]+/);
  if (!m) return null;
  s = m[0];
  if (/^[-+]?[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');     // 20,000 or 1,234.5 (a dot is always a decimal point)
  else s = s.replace(',', '.');                                                    // 0,42 and 0,085 are decimals
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Right when the number is the answer. Someone who gives clearly more decimals than asked (0.4167 for 0.42, two or more extra)
 * is right if that rounds to the answer; one extra decimal (3.4 for 3, 68.45 for 68.4) is not enough to call it right.
 */
export function gradeNumber(text, answer, decimals = 0) {
  const v = parseNumber(text);
  if (v === null) return false;
  if (Math.abs(v - answer) < 1e-9) return true;
  const typedDecimals = (String(text).replace(/%/g, '').trim().match(/[.,](\d+)/) || [, ''])[1].length;
  return typedDecimals >= decimals + 2 && Math.abs(round(v, decimals) - round(answer, decimals)) < 1e-9;
}
