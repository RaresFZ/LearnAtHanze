// Pieces every mini game shares: the game list, the header, the live clock, and the results screen.
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { reviewBlocks } from './question.js';
import { SPEED, MATCH, SORT, COMBO } from './games-data.js';

const M = window.Motion;

export const GAMES = {
  match: { title: 'Match up', icon: 'arrow-left-right', color: 'lilac', unit: 'points', blurb: 'Match each question to its answer.',
    rules: [`${MATCH.rounds} rounds of ${MATCH.size} questions and ${MATCH.size} answers.`, 'Pick a question, then its answer (or use the number and letter keys).', '10 points for each match, minus 5 for each wrong try.'] },
  sort: { title: 'Sort it', icon: 'move', color: 'coral', unit: 'points', blurb: 'Drag each question into the topic it belongs to.',
    rules: [`${SORT.rounds} rounds. Each round has ${SORT.buckets} topics and ${SORT.buckets * SORT.per} questions to sort.`, 'Drag a question onto its topic, or pick it and press 1, 2 or 3.', '10 points for each right drop, minus 5 for each wrong one.'] },
  speed: { title: 'Speed round', icon: 'timer', color: 'yellow', unit: 'right', blurb: `${SPEED.seconds} seconds, as many right answers as you can.`,
    rules: [`Short multiple-choice and true/false questions for ${SPEED.seconds} seconds.`, `A wrong answer takes ${SPEED.penalty} seconds off the clock.`, 'Answer with the number keys (or T and F). The score is the number you got right.'] },
  combo: { title: 'Combo run', icon: 'flame', color: 'sky', unit: 'points', blurb: 'Keep the streak alive to multiply your score.',
    rules: [`You have ${COMBO.lives} lives and no clock.`, `Each answer is worth ${COMBO.points} points times your multiplier. Every ${COMBO.step} right in a row raises it by 1, up to x${COMBO.maxMultiplier}.`, 'A wrong answer costs a life and resets the multiplier.'] },
};

export const centreOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
export const posOf = (e, el) => (e && e.clientX ? { x: e.clientX, y: e.clientY } : centreOf(el));
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

let active = null;
/** One game runs at a time: starting a game or changing page stops the previous one (timers, key handlers). */
export function startSession(destroy) { active?.(); active = destroy; }
export function destroyGame() { active?.(); active = null; }

/** Top row: an "end game" button and a label on the left, small stat chips on the right. */
export function gameTop(onExit) {
  const exit = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'End game' }, icon('x', 18));
  exit.addEventListener('click', (e) => onExit(e));
  const lab = h('span', { class: 'lab' });
  const right = h('div', { class: 'game-stats' });
  return { el: h('div', { class: 'quiz-top game-top' }, h('div', { class: 'left' }, FX.obj(exit, { cls: 'o-icon' }), lab), right), lab, right };
}

/** A labelled value in a chip; set() changes the value. */
export function statChip(label, value = '') {
  const v = h('b', null, String(value));
  const el = h('span', { class: 'chip stat' }, `${label} `, v);
  return { el, set: (x) => { if (v.textContent !== String(x)) v.textContent = String(x); } };
}

/** mm:ss */
export const clockText = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/**
 * The finished-game screen.
 * r: { game, score, rec: { isBest, best, plays }, stats: [text], mistakes: [question], mood, again(e) }
 */
export function renderGameResult(root, ctx, r) {
  const { exam } = ctx;
  const meta = GAMES[r.game];
  const numEl = h('span', null, '0');
  const stampText = r.rec.isBest ? 'New best' : r.rec.plays === 1 ? 'First score' : `Best ${r.rec.best}`;
  const stampShadow = h('i', { class: 'stamp-shadow' });
  const stampWrap = h('div', { class: 'stamp-wrap' }, stampShadow, h('div', { class: 'stamp' }, stampText));
  const mascot = FX.mascot(); mascot.dataset.mood = r.mood || 'happy';
  const scoreFace = h('div', { class: 'score-card' },
    h('div', { class: 'score-row' }, h('div', { class: 'score-num' }, numEl, h('small', null, meta.unit)), h('div', { class: 'stamp-spot' }, stampWrap)),
    h('div', { class: 'meta' }, r.stats.map((s) => h('span', { class: 'chip' }, s))),
    h('div', { class: 'mascot-spot' }, mascot));
  const scoreObj = FX.obj(scoreFace, { cls: 'o-tile', tilt: 4, shine: true, fill: true, z: 12 });

  const againBtn = h('button', { class: 'btn yellow xl', type: 'button' }, icon('rotate-ccw', 20), 'Play again');
  againBtn.addEventListener('click', (e) => r.again(e));
  const rows = r.mistakes.map((q, k) => h('details', { class: 'review', open: k === 0 },
    h('summary', null, h('span', null, q.question), icon('chevron-down', 22)), h('div', { class: 'body' }, reviewBlocks(q, exam.documents))));
  const reviewHead = h('h2', { class: 'section' }, r.mistakes.length ? `To review (${r.mistakes.length})` : 'No mistakes');
  const actions = h('div', { class: 'actions' },
    FX.obj(againBtn, { cls: 'o-btn' }),
    FX.obj(h('a', { class: 'btn xl', href: `#/exam/${exam.id}/games` }, 'All games'), { cls: 'o-btn' }),
    h('a', { class: 'btn textlink', href: `#/exam/${exam.id}` }, 'Back to exam'));
  const page = h('div', null,
    h('h1', { class: 'pagetitle' }, `${meta.title}: done`),
    h('p', { class: 'pagesub lab' }, `${exam.shortTitle || exam.title} / ${plural(r.rec.plays, 'play', 'plays')}`),
    h('div', { class: 'game-result' }, scoreObj),
    reviewHead, r.mistakes.length ? h('div', { class: 'review-list' }, rows) : h('p', { class: 'lead' }, 'Nothing to review.'),
    actions);
  mount(root, page);
  window.scrollTo(0, 0);

  const base = FX.base();
  FX.enter([scoreObj], { delay: base, y: -50 });
  FX.count(numEl, r.score, { duration: 0.9, delay: base + 0.15 });
  FX.enter([reviewHead, ...rows, ...root.querySelectorAll('.actions > .obj, .actions > a')], { y: 22, delay: base + 0.5, stagger: 0.05, spring: FX.spring.soft });
  M.animate(stampWrap, { opacity: 0 }, { duration: 0 });
  const land = () => {
    if (!stampWrap.isConnected) return;
    FX.sound('thud');
    FX.anim(stampShadow, { x: [0, 5], y: [0, 5] }, FX.spring.thud);
    if (r.rec.isBest) { const b = stampWrap.getBoundingClientRect(); FX.confetti(b.left + 60, b.top + 20, { count: 10, big: true }); }
    mascot.mood(r.mood === 'sad' ? 'sad' : 'happy', 3000);
  };
  if (FX.reduced()) { M.animate(stampWrap, { opacity: 1, rotate: -7 }, { duration: 0 }); M.animate(stampShadow, { x: 5, y: 5 }, { duration: 0 }); }
  else setTimeout(() => {
    if (!stampWrap.isConnected) return;
    M.animate(stampWrap, { opacity: 0, y: -300, scale: 2.4, rotate: -24 }, { duration: 0 });
    FX.anim(stampWrap, { opacity: [0, 1], y: [-300, 0], scale: [2.4, 1], rotate: [-24, -7] }, { duration: 0.32, ease: [0.55, 0, 0.9, 0.6] }).then(land, land);
  }, (base + 0.9) * 1000);
}
