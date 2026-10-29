// Mini games: the list of games, and one intro screen per game (what it is, the rules, your best score, Start).
// Every game runs on the exam's own questions (see games-data.js); nothing is shared between the two exams.
import { h, mount } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress } from './store.js';
import { buildPairs, planMatch, planSort, quickPool } from './games-data.js';
import { GAMES, destroyGame, posOf, plural } from './game-ui.js';
import { runMatch } from './match.js';
import { runSort } from './sort.js';
import { runQuick } from './quick.js';

export { destroyGame };

const material = (ctx) => ({ pairs: buildPairs(ctx.questions, ctx.games), quick: quickPool(ctx.questions) });

/** '' when the game can be played, otherwise why not (the exam's content is too small for it). */
function unavailable(game, m) {
  if (game === 'match') return planMatch(m.pairs).length ? '' : 'There are not enough question and answer pairs in games.json for a round.';
  if (game === 'sort') return planSort(m.pairs).length ? '' : 'Sorting needs at least 3 topics with 3 pairs each in games.json.';
  return m.quick.length >= 10 ? '' : 'There are not enough short multiple-choice or true/false questions.';
}

function launch(root, ctx, game, m) {
  if (game === 'match') runMatch(root, ctx, () => planMatch(m.pairs));
  else if (game === 'sort') runSort(root, ctx, () => planSort(m.pairs));
  else runQuick(root, ctx, game);
}

export function renderGamesHub(root, ctx) {
  destroyGame();
  const { exam } = ctx;
  const played = loadProgress(exam.id).games;
  const m = material(ctx);
  const tiles = Object.entries(GAMES).map(([id, g]) => FX.obj(
    h('a', { class: `mode ${g.color}`, href: `#/exam/${exam.id}/games/${id}` },
      h('div', { class: 'mode-top' }, icon(g.icon, 40), h('span', { class: 'chip' }, played[id] ? `Best ${played[id].best}` : 'Not played yet')),
      h('div', null, h('h3', null, g.title), h('p', null, g.blurb))),
    { cls: 'o-mode', tilt: 8, shine: true, fill: true, z: 18 }));
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}` }, icon('arrow-left', 14), exam.title),
    h('h1', { class: 'pagetitle' }, 'Mini games'),
    h('p', { class: 'lead' }, 'Short rounds built from this exam\'s own questions and answers. Nothing is made up, and every question has its source in the review at the end.'),
    h('div', { class: 'modes games' }, tiles),
    h('p', { class: 'fine', style: { marginTop: '22px' } },
      `${plural(m.pairs.length, 'question and answer pair', 'question and answer pairs')} and ${plural(m.quick.length, 'short question', 'short questions')} are available. Answers in the Speed round and Combo run count toward your accuracy and weak spots; Match up and Sort it only keep their own scores.`));
  FX.enter(tiles, { y: 40, delay: FX.base(), stagger: 0.07 });
}

export function renderGameIntro(root, ctx, game) {
  destroyGame();
  const { exam } = ctx;
  const g = GAMES[game];
  const m = material(ctx);
  const why = unavailable(game, m);
  const rec = loadProgress(exam.id).games[game];
  const start = h('button', { class: 'btn yellow xl', type: 'button' }, icon('play', 22), 'Start');
  start.disabled = !!why;
  start.addEventListener('click', (e) => FX.transition(() => launch(root, ctx, game, m), posOf(e, start)));
  const startObj = FX.obj(start, { cls: 'o-btn' });
  const row = h('div', { class: 'start-row' }, startObj, why ? h('p', { class: 'setup-summary', role: 'status' }, why) : null);
  const rulesObj = FX.obj(h('div', { class: 'card sim-note' },
    h('span', { class: 'chip yellow' }, icon(g.icon, 14), g.title),
    h('ul', { class: 'sim-how' }, g.rules.map((r) => h('li', null, r))),
    h('p', { class: 'fine' }, rec ? `Best score ${rec.best}, played ${plural(rec.plays, 'time', 'times')}.` : 'You have not played this one yet.')), { cls: 'o-tile', hover: false });
  mount(root,
    h('a', { class: 'back', href: `#/exam/${exam.id}/games` }, icon('arrow-left', 14), 'Mini games'),
    h('h1', { class: 'pagetitle' }, g.title),
    h('p', { class: 'lead' }, g.blurb),
    rulesObj,
    row);
  const base = FX.base();
  FX.enter([rulesObj], { y: 30, delay: base, spring: FX.spring.soft });
  FX.enter([row], { y: 30, delay: base + 0.15, spring: FX.spring.soft });   // the row, not the button: an inline opacity would defeat the disabled dimming
}
