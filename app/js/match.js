// Match up: pick a question, then its answer. Rounds of pairs come from games.json (see games-data.js).
import { h, mount, shuffle } from './util.js';
import { FX } from './fx.js';
import { recordGame } from './store.js';
import { roundScore } from './games-data.js';
import { gameTop, statChip, clockText, startSession, renderGameResult, posOf, centreOf } from './game-ui.js';

const M = window.Motion;

/** replan() gives a fresh set of rounds (see planMatch); it is called again for "Play again". */
export function runMatch(root, ctx, replan) {
  const { exam } = ctx;
  const plan = replan();
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  let round = 0, correct = 0, wrong = 0, matched = 0, over = false, sel = null, lefts = [], rights = [];
  const missed = new Map();                         // pair id -> pair, for the review
  const t0 = Date.now();

  const top = gameTop((e) => finish(true, posOf(e, top.el)));
  const scoreChip = statChip('Score', 0), roundChip = statChip('Round', `1/${plan.length}`), timeChip = statChip('Time', '00:00');
  const mascot = FX.mascot();
  top.right.append(roundChip.el, scoreChip.el, timeChip.el);
  top.right.prepend(mascot);
  const stage = h('div', { class: 'match-stage' });
  const deck = h('div', { class: 'deck' }, stage);
  mount(root, h('div', { class: 'quiz-wrap game-wrap' }, top.el, deck,
    h('p', { class: 'fine game-hint' }, 'Pick a question, then its answer. Keys: numbers for questions, letters for answers.')));

  const paintScore = () => scoreChip.set(roundScore(correct, wrong));

  function showRound() {
    const pairs = plan[round];
    matched = 0; sel = null;
    roundChip.set(`${round + 1}/${plan.length}`);
    top.lab.textContent = `${pairs.length} pairs`;
    const opt = (text, key, side, p) => {
      const b = h('button', { class: 'opt match-opt', type: 'button', 'data-id': p.id },
        h('span', { class: 'key' }, key), h('span', { class: 'txt' }, h('span', { class: 'ink' }, text)));
      b.addEventListener('click', () => pick(side, p, b));
      return b;
    };
    lefts = shuffle(pairs).map((p, k) => ({ p, b: opt(p.clue, String(k + 1), 'L', p) }));
    rights = shuffle(pairs).map((p, k) => ({ p, b: opt(p.answer, String.fromCharCode(65 + k), 'R', p) }));
    stage.replaceChildren(
      h('div', { class: 'match-col', role: 'group', 'aria-label': 'Questions' }, lefts.map((x) => FX.obj(x.b, { cls: 'o-opt', tilt: 3, z: 14 }))),
      h('div', { class: 'match-col', role: 'group', 'aria-label': 'Answers' }, rights.map((x) => FX.obj(x.b, { cls: 'o-opt', tilt: 3, z: 14 }))));
    FX.enter([...stage.querySelectorAll('.obj')], { y: 22, delay: FX.base(), stagger: 0.035, spring: FX.spring.soft });
  }

  function pick(side, p, b) {
    if (over || b.disabled) return;
    if (!sel || sel.side === side) {                  // first pick, or changing your mind on the same side
      if (sel) sel.b.classList.remove('picked');
      if (sel && sel.b === b) { sel = null; return; }
      sel = { side, p, b }; b.classList.add('picked');
      FX.sound('click');
      return;
    }
    const first = sel; sel = null;
    first.b.classList.remove('picked');
    if (first.p.id === p.id) hit(first.b, b, p); else miss(first.b, b, side === 'R' ? first.p : p);
  }

  function hit(a, b, p) {
    correct += 1; matched += 1; paintScore();
    for (const el of [a, b]) { el.classList.add('matched'); el.disabled = true; el.setAttribute('aria-label', `${el.textContent.trim()}, matched`); FX.anim(el.closest('.obj'), { scale: [1, 1.05, 1] }, FX.spring.bouncy); }
    const c = centreOf(b);
    FX.confetti(c.x, c.y, { count: 6 });
    FX.sound('pop'); mascot.mood('happy', 1200);
    if (matched === plan[round].length) setTimeout(next, 750);
  }

  function miss(a, b, clueSide) {
    wrong += 1; paintScore();
    missed.set(clueSide.id, clueSide);
    for (const el of [a, b]) { el.classList.add('nope'); FX.anim(el.closest('.obj'), { x: [0, -10, 10, -7, 7, -3, 0] }, { duration: 0.4 }); setTimeout(() => el.classList.remove('nope'), 450); }
    FX.sound('thud'); mascot.mood('sad', 1200);
  }

  function next() {
    if (over) return;
    if (round + 1 < plan.length) { round += 1; showRound(); } else finish(false, centreOf(deck));
  }

  function finish(early, at) {
    if (over) return;
    over = true; session();
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (!correct && !wrong) { location.hash = `#/exam/${exam.id}/games`; return; }
    const score = roundScore(correct, wrong);
    const rec = recordGame(exam.id, 'match', { score, answered: correct, seconds });
    FX.transition(() => renderGameResult(root, ctx, {
      game: 'match', score, rec, mood: wrong > correct ? 'sad' : 'happy',
      stats: [`${correct} matched`, `${wrong} wrong ${wrong === 1 ? 'try' : 'tries'}`, `${clockText(seconds * 1000)} time`, early ? 'Ended early' : null].filter(Boolean),
      mistakes: [...missed.values()].map((p) => byId.get(p.id)).filter(Boolean),
      again: (e) => FX.transition(() => runMatch(root, ctx, replan), posOf(e, document.body)),
    }), at || centreOf(deck));
  }

  const onKey = (e) => {
    if (over || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const k = e.key.toLowerCase();
    const n = /^[1-9]$/.test(k) ? Number(k) - 1 : -1;
    const a = /^[a-z]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
    if (n >= 0 && lefts[n]) { pick('L', lefts[n].p, lefts[n].b); e.preventDefault(); }
    else if (a >= 0 && rights[a]) { pick('R', rights[a].p, rights[a].b); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  const timer = setInterval(() => timeChip.set(clockText(Date.now() - t0)), 500);
  const session = () => { over = true; clearInterval(timer); document.removeEventListener('keydown', onKey); };
  startSession(session);
  showRound();
}
