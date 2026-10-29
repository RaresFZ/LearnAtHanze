// Checks every content/<exam>/questions.json for mistakes (bad answer index, unknown topic or source, duplicate ids...).
// Run after editing content by hand: `npm run validate`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCards } from '../app/js/cards.js';
import { buildPairs, sortTopics, quickPool, MAX_CLUE, MAX_ANSWER } from '../app/js/games-data.js';

const CONTENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
const TYPES = ['mc', 'tf', 'fill', 'open'];
let errors = 0;

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error(`ERROR ${path.relative(CONTENT, file)}: ${e.message}`);
    errors++;
    return null;
  }
};

/** flashcards.json is optional. Every id must be a real question, and only mc/tf need listing (open/fill are cards already). */
function checkFlashcards(exam, questions, config) {
  const err = (msg) => { console.error(`ERROR ${exam}/flashcards.json: ${msg}`); errors++; };
  if (!fs.existsSync(path.join(CONTENT, exam, 'flashcards.json'))) return buildCards(questions).length;
  if (!config) return 0;
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const key of ['include', 'exclude']) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].some((id) => typeof id !== 'string'))) { err(`"${key}" must be an array of question ids`); return 0; }
    for (const id of config[key] || []) if (!byId.has(id)) err(`${key}: unknown question id ${id}`);
  }
  for (const id of config.include || []) {
    const q = byId.get(id);
    if (q && (q.type === 'open' || q.type === 'fill')) console.warn(`warn  ${exam}/flashcards.json: ${id} is ${q.type}, so it is a card already (remove it from include)`);
    if ((config.exclude || []).includes(id)) err(`${id} is in both include and exclude`);
  }
  const cards = buildCards(questions, config);
  const seen = new Set();
  for (const c of cards) { if (seen.has(c.id)) err(`duplicate card ${c.id}`); seen.add(c.id); if (!c.back) err(`card ${c.id} has no answer`); }
  return cards.length;
}

/** exam.json "simulation" is optional: { questions, minutes, types, passMark, official, note }. Returns a one-line description. */
function checkSimulation(name, exam, questions) {
  const s = exam.simulation;
  if (s === undefined) return '';
  const err = (msg) => { console.error(`ERROR ${name}/exam.json simulation: ${msg}`); errors++; };
  if (typeof s !== 'object' || s === null || Array.isArray(s)) { err('must be an object'); return ''; }
  for (const k of ['questions', 'minutes']) if (s[k] !== undefined && !(Number.isInteger(s[k]) && s[k] > 0)) err(`"${k}" must be a positive whole number`);
  if (s.types !== undefined && (!Array.isArray(s.types) || !s.types.length || s.types.some((t) => !TYPES.includes(t)))) err(`"types" must be a non-empty list of ${TYPES.join(', ')}`);
  if (s.passMark != null && !(typeof s.passMark === 'number' && s.passMark > 0 && s.passMark <= 100)) err('"passMark" must be a percentage above 0 up to 100, or null when it is not known');
  const types = Array.isArray(s.types) ? s.types : TYPES;
  const pool = questions.filter((q) => types.includes(q.type)).length;
  if (s.questions > pool) console.warn(`warn  ${name}/exam.json simulation: asks for ${s.questions} questions but only ${pool} match the types`);
  return `  exam simulation: ${s.questions ?? 30} questions / ${s.minutes ?? 45} min from ${pool} matching`;
}

/** games.json is optional: { pairs: [question ids] } for Match up and Sort it. Returns a one-line description. */
function checkGames(name, questions, config) {
  const file = path.join(CONTENT, name, 'games.json');
  const quick = quickPool(questions).length;
  if (!fs.existsSync(file)) return `  mini games: no games.json (${quick} quick questions)`;
  if (!config) return '';
  const err = (msg) => { console.error(`ERROR ${name}/games.json: ${msg}`); errors++; };
  if (!Array.isArray(config.pairs) || config.pairs.some((id) => typeof id !== 'string')) { err('"pairs" must be an array of question ids'); return ''; }
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set();
  for (const id of config.pairs) {
    if (!byId.has(id)) { err(`pairs: unknown question id ${id}`); continue; }
    if (seen.has(id)) err(`pairs: ${id} is listed twice`);
    seen.add(id);
  }
  const pairs = buildPairs(questions, config);
  const answers = new Map();
  for (const p of pairs) {
    if (p.flag) console.warn(`warn  ${name}/games.json: ${p.id} has a "check the source" flag, so it is not a fair pair to race on`);
    if (p.clue.length > MAX_CLUE) console.warn(`warn  ${name}/games.json: ${p.id} clue is ${p.clue.length} characters (over ${MAX_CLUE}); it may not fit a card`);
    if (p.answer.length > MAX_ANSWER) console.warn(`warn  ${name}/games.json: ${p.id} answer is ${p.answer.length} characters (over ${MAX_ANSWER}); it may not fit a card`);
    if (answers.has(p.answer)) console.warn(`warn  ${name}/games.json: ${p.id} and ${answers.get(p.answer)} have the same answer, so they are never in the same round`);
    answers.set(p.answer, p.id);
  }
  return `  mini games: ${pairs.length} pairs, ${sortTopics(pairs).length} sortable topics, ${quick} quick questions`;
}

for (const dir of fs.readdirSync(CONTENT, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const base = path.join(CONTENT, dir.name);
  const exam = readJson(path.join(base, 'exam.json'));
  const topics = readJson(path.join(base, 'topics.json'));
  const questions = readJson(path.join(base, 'questions.json'));
  if (!exam || !topics || !questions) continue;

  const topicIds = new Set(topics.map((t) => t.id));
  const docs = new Set(Object.keys(exam.documents || {}));
  const seen = new Set();
  const byType = {};
  const byTopic = {};
  const err = (q, msg) => { console.error(`ERROR ${dir.name}/${q.id ?? '(no id)'}: ${msg}`); errors++; };
  const warn = (q, msg) => console.warn(`warn  ${dir.name}/${q.id}: ${msg}`);

  for (const q of questions) {
    if (!q.id) { err(q, 'missing id'); continue; }
    if (seen.has(q.id)) err(q, 'duplicate id');
    seen.add(q.id);
    if (!TYPES.includes(q.type)) err(q, `unknown type "${q.type}"`);
    if (!topicIds.has(q.topic)) err(q, `unknown topic "${q.topic}"`);
    if (typeof q.question !== 'string' || !q.question.trim()) err(q, 'empty question');
    if (!Array.isArray(q.src) || !docs.has(q.src[0])) err(q, `src must be [documentKey, location] with a key from exam.json (got ${JSON.stringify(q.src)})`);
    else if (!q.src[1]) warn(q, 'src has no location');
    if (q.type === 'mc') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) err(q, 'mc needs 2-6 options');
      else {
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) err(q, `answer index ${q.answer} out of range`);
        if (new Set(q.options).size !== q.options.length) err(q, 'duplicate options');
      }
    } else if (q.type === 'tf') {
      if (typeof q.answer !== 'boolean') err(q, 'tf answer must be true or false');
    } else if (q.type === 'fill') {
      if (!Array.isArray(q.answers) || !q.answers.length || q.answers.some((a) => typeof a !== 'string')) err(q, 'fill needs a non-empty "answers" array of strings');
      if (q.numbers && (!Array.isArray(q.numbers) || q.numbers.some((n) => typeof n !== 'number'))) err(q, '"numbers" must be an array of numbers');
    } else if (q.type === 'open') {
      if (typeof q.modelAnswer !== 'string' || !q.modelAnswer.trim()) err(q, 'open needs modelAnswer');
    }
    if (q.type !== 'open' && !q.explanation) warn(q, 'no explanation');
    byType[q.type] = (byType[q.type] || 0) + 1;
    byTopic[q.topic] = (byTopic[q.topic] || 0) + 1;
  }

  const cardCount = checkFlashcards(dir.name, questions, readJson(path.join(base, 'flashcards.json')));
  const simLine = checkSimulation(dir.name, exam, questions);
  const gamesFile = path.join(base, 'games.json');
  const gamesLine = checkGames(dir.name, questions, fs.existsSync(gamesFile) ? readJson(gamesFile) : null);
  console.log(`\n${dir.name}: ${questions.length} questions  ${JSON.stringify(byType)}  ${cardCount} flashcards${simLine}${gamesLine}`);
  for (const t of topics) console.log(`  ${String(byTopic[t.id] || 0).padStart(3)}  ${t.id}${byTopic[t.id] ? '' : '  (none)'}`);
}

console.log(errors ? `\n${errors} error(s) found.` : '\nAll content is valid.');
process.exit(errors ? 1 : 0);
