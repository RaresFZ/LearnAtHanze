// Sort it: drag each question into the topic it belongs to. The right topic is the one the question already has in the
// exam's own content (questions.json), so nothing here is new. Works with a pointer (drag), a tap (pick, then tap a topic)
// and the keyboard (the highlighted question goes to topic 1, 2 or 3 with the number keys).
import { h, mount, shuffle } from './util.js';
import { FX } from './fx.js';
import { recordGame } from './store.js';
import { roundScore } from './games-data.js';
import { gameTop, statChip, clockText, startSession, renderGameResult, posOf, centreOf } from './game-ui.js';

const M = window.Motion;

/** replan() gives a fresh set of rounds (see planSort); it is called again for "Play again". */
export function runSort(root, ctx, replan) {
  const { exam, topics } = ctx;
  const plan = replan();
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  const topicTitle = (id) => topics.find((t) => t.id === id)?.title || id;
  let round = 0, correct = 0, wrong = 0, over = false, explicit = null, items = [], buckets = [];
  const missed = new Map();
  const t0 = Date.now();

  const top = gameTop((e) => finish(true, posOf(e, top.el)));
  const scoreChip = statChip('Score', 0), roundChip = statChip('Round', `1/${plan.length}`), timeChip = statChip('Time', '00:00');
  const mascot = FX.mascot();
  top.right.append(roundChip.el, scoreChip.el, timeChip.el);
  top.right.prepend(mascot);
  const stage = h('div', { class: 'sort-stage' });
  const deck = h('div', { class: 'deck' }, stage);
  mount(root, h('div', { class: 'quiz-wrap game-wrap sort-wrap' }, top.el, deck,
    h('p', { class: 'fine game-hint' }, 'Drag a question onto its topic. Or pick it (tap or Enter) and press 1, 2 or 3, or tap a topic.')));

  const paintScore = () => scoreChip.set(roundScore(correct, wrong));
  const current = () => explicit || items[0] || null;
  const paintCurrent = () => {
    for (const it of items) { it.btn.classList.remove('picked', 'next'); it.btn.setAttribute('aria-pressed', 'false'); }
    const c = current();
    if (c) { c.btn.classList.add(explicit ? 'picked' : 'next'); if (explicit) c.btn.setAttribute('aria-pressed', 'true'); }
    top.lab.textContent = `${items.length} left`;
  };
  const select = (it) => { explicit = explicit === it ? null : it; if (explicit) FX.sound('click'); paintCurrent(); };

  function bucketAt(x, y) {
    const el = document.elementsFromPoint(x, y).find((n) => n.classList?.contains('bucket'));
    return el ? buckets.findIndex((b) => b.el === el) : -1;
  }
  const clearOver = () => buckets.forEach((b) => b.el.classList.remove('over'));

  function wire(it) {
    const { btn } = it;
    let drag = null;
    const springBack = () => FX.anim(btn, { x: 0, y: 0 }, FX.spring.snappy);
    btn.addEventListener('pointerdown', (e) => {
      if (over || e.button) return;
      btn.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    btn.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      if (!drag.moved) { drag.moved = true; btn.classList.add('dragging'); explicit = null; paintCurrent(); }
      M.animate(btn, { x: dx, y: dy }, { duration: 0 });
      clearOver();
      const k = bucketAt(e.clientX, e.clientY);
      if (k >= 0) buckets[k].el.classList.add('over');
    });
    btn.addEventListener('pointerup', (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      btn.classList.remove('dragging'); clearOver();
      if (!d.moved) { select(it); return; }
      const k = bucketAt(e.clientX, e.clientY);
      if (k >= 0) drop(it, k); else springBack();
    });
    btn.addEventListener('pointercancel', () => { if (!drag) return; drag = null; btn.classList.remove('dragging'); clearOver(); springBack(); });
  }

  function showRound() {
    const rd = plan[round];
    explicit = null;
    roundChip.set(`${round + 1}/${plan.length}`);
    buckets = rd.buckets.map((b, k) => {
      const list = h('ul', { class: 'bucket-items' });
      const head = h('button', { class: 'bucket-head', type: 'button' }, h('span', { class: 'bkey' }, String(k + 1)), topicTitle(b.topic));
      head.addEventListener('click', () => { const it = current(); if (it) drop(it, k); });
      return { topic: b.topic, list, el: h('div', { class: 'bucket', role: 'group', 'aria-label': `Topic: ${topicTitle(b.topic)}` }, head, list) };
    });
    items = shuffle(rd.buckets.flatMap((b) => b.items)).map((p) => {
      const it = { p, btn: h('button', { class: 'sort-item', type: 'button', 'aria-pressed': 'false' }, p.clue) };
      wire(it);
      return it;
    });
    stage.replaceChildren(h('div', { class: 'buckets' }, buckets.map((b) => b.el)), h('div', { class: 'pile', role: 'group', 'aria-label': 'Questions to sort' }, items.map((i) => i.btn)));
    FX.enter([...stage.querySelectorAll('.bucket'), ...stage.querySelectorAll('.sort-item')], { y: 22, delay: FX.base(), stagger: 0.03, spring: FX.spring.soft });
    paintCurrent();
  }

  function drop(it, k) {
    if (over || !items.includes(it)) return;
    const b = buckets[k];
    if (it.p.topic === b.topic) {
      correct += 1; paintScore();
      items = items.filter((x) => x !== it);
      if (explicit === it) explicit = null;
      it.btn.remove();
      const chip = h('li', { class: 'bchip' }, it.p.clue);
      b.list.append(chip);
      FX.anim(chip, { scale: [0.7, 1], opacity: [0, 1] }, FX.spring.bouncy);
      const c = centreOf(b.el);
      FX.confetti(c.x, c.y, { count: 6 });
      FX.sound('pop'); mascot.mood('happy', 1200);
      paintCurrent();
      if (!items.length) setTimeout(next, 850);
    } else {
      wrong += 1; paintScore();
      missed.set(it.p.id, it.p);
      FX.anim(it.btn, { x: 0, y: 0 }, FX.spring.snappy);
      b.el.classList.add('nope'); setTimeout(() => b.el.classList.remove('nope'), 450);
      FX.anim(b.el, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.35 });
      FX.sound('thud'); mascot.mood('sad', 1200);
    }
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
    const rec = recordGame(exam.id, 'sort', { score, answered: correct, seconds });
    FX.transition(() => renderGameResult(root, ctx, {
      game: 'sort', score, rec, mood: wrong > correct ? 'sad' : 'happy',
      stats: [`${correct} sorted`, `${wrong} wrong ${wrong === 1 ? 'drop' : 'drops'}`, `${clockText(seconds * 1000)} time`, early ? 'Ended early' : null].filter(Boolean),
      mistakes: [...missed.values()].map((p) => byId.get(p.id)).filter(Boolean),
      again: (e) => FX.transition(() => runSort(root, ctx, replan), posOf(e, document.body)),
    }), at || centreOf(deck));
  }

  const onKey = (e) => {
    if (over || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    const it = current();
    if (n >= 0 && n < buckets.length && it) { drop(it, n); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);
  const timer = setInterval(() => timeChip.set(clockText(Date.now() - t0)), 500);
  const session = () => { over = true; clearInterval(timer); document.removeEventListener('keydown', onKey); };
  startSession(session);
  showRound();
}
