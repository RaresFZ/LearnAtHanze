# LearnAtHanze

A local study app for two separate Hanze exams. Everything runs on your own computer: no account, no server online, no installs.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer (check with `node --version`). Then, in this folder:

```
npm start
```

The app opens at **http://localhost:3737**. Stop it with `Ctrl+C`.

> Your progress is saved in the browser and tied to this address. Always use `http://localhost:3737` (the port is fixed on purpose). If you change the port, your progress will look empty; you can bring it back with Export/Import.

## What is in it

Six ways to study, for each exam: **Quiz** (by topic or a random mix, four question types), **Flashcards** (spaced repetition), **Weak spots** (aims the quiz and flashcards at what you keep missing), **Exam simulation** (timed and mixed, one score at the end), **Mini games** (match up, sort it, speed round, combo run) and a **Progress** page. Every question and card comes from your own course files and cites its source; nothing is made up.

## The two exams

Each exam has its own content, progress and stats, and nothing is shared.

| Exam | Folder |
|---|---|
| LEAN & Agile Project Management | `content/lean-agile/` |
| Outsourcing & Agile Governance | `content/outsourcing-governance/` |

## Edit or add questions

Each exam folder contains plain JSON files you can edit in any text editor. Reload the page to see changes (no restart needed).

- `exam.json`: title, description, real exam format, the source documents, the "material gaps" list and the `simulation` block (see Exam simulation).
- `topics.json`: the topics, with a `coverage` rating (`good`, `medium`, `thin`, `missing`).
- `questions.json`: one question per line.
- `flashcards.json` and `games.json`: which questions become extra flashcards, and which question and answer pairs the Match up and Sort it games use (see Flashcards and Mini games). Both are lists of question ids, so they never hold content of their own.
- `sources/`: the text extracted from your course files, so you can check any question against its source.

A question looks like this:

```json
{"id":"og-001","type":"mc","topic":"audit","question":"…","options":["A","B","C","D"],"answer":1,"explanation":"…","src":["g1","Slide 23"]}
```

| `type` | Extra fields |
|---|---|
| `mc` (multiple choice) | `options` (2-6), `answer` (index of the correct option, starting at 0). Options are shuffled when asked, unless `"fixedOrder": true`. |
| `tf` (true/false) | `answer`: `true` or `false` |
| `fill` (fill in the blank) | `answers`: accepted texts. Optional `numbers` (accepted numeric values) and `tolerance` |
| `open` (short open question) | `modelAnswer`; you grade yourself after reading it |

Every question needs `id` (unique), `type`, `topic` (an id from `topics.json`), `question`, and `src`: `[documentKey, location]`, where the key comes from `documents` in `exam.json`. Optional fields: `explanation` and `flag`. A `flag` is shown as a warning ("check the source") for anything that is unclear or inconsistent in your material.

After editing, check your work:

```
npm run validate
```

It reports bad answer indexes, unknown topics or sources, duplicate ids and invalid JSON.

## Flashcards

Flashcards are not a second set of content: every card is one of the exam's own questions (front = the question, back = the answer, explanation, any warning and the cited source). Open and fill-in questions are cards automatically. Multiple-choice and true/false questions become cards only when `content/<exam>/flashcards.json` lists them under `include` (definitions and key terms); list a question under `exclude` to drop it (calculation exercises are excluded). `npm run validate` checks the ids and prints the card count.

Rate each card Again / Hard / Good / Easy. A missed card comes back within minutes (and again later in the same session), loses some "ease", and then grows more slowly than cards you know. Up to 20 new cards a day per exam. Cards are stored as `cards` in each exam's progress, separate from quiz history (each card also counts its Again ratings as `misses`; older saves without it still work).

## Weak spots and progress

Both are built only from what the app already saves for that exam (nothing is estimated, and the two exams never mix).

- **Weak spots** aims the normal quiz and flashcard sessions at what you keep missing. A question is weak once you have lost 2 points on it (2 misses) and stays weak until you answer it right twice in a row. A card is weak once it has been rated Again twice and stays weak until it is scheduled 7 or more days out. A switch on the page lowers the bar to "missed at least once". A session takes the weakest 20. The rules are at the top of `app/js/progress.js` (`WEAK_MISSES`, `RECOVERED_STREAK`, `RECOVERED_DAYS`).
- **Progress** shows: practised, accuracy, current streak and study days in a row; accuracy over time (per day, last 14 days with a quiz, or with flashcards; also as a table); mastery per topic for questions and for cards; and the questions and cards you keep missing, each opening to its answer and source.

## Exam simulation

A timed run through mixed questions with one score at the end, per exam. **It is a practice setup, not the official format:** the course files do not state the real number of questions, time or pass mark (Exam A's format is not stated at all; Exam B is a multiple-choice theory exam). Set your own in the `simulation` block of `content/<exam>/exam.json`:

```json
"simulation": { "official": false, "questions": 30, "minutes": 45, "types": ["mc","tf","fill","open"], "passMark": null, "note": "..." }
```

- `questions` and `minutes` are the defaults on the setup screen (you can still pick other lengths there). `types` limits which question types are drawn (Exam B: only `mc` and `tf`). `passMark` is a percentage, or `null` when it is not known: with `null` you get a score but no pass or fail. Set `official` to `true` once you know the real format.
- Questions are spread evenly over the topics, then mixed. There is no feedback until you submit. You can go back, change an answer (press the chosen option again to clear it) and flag questions. When time is up the exam is submitted for you.
- Open answers are graded by you after submitting (Missed it / Partly / Got it), and a fill-in answer the app marked wrong can be overruled. Unanswered questions score 0.
- The attempt in progress is saved in the browser after every change, so a reload or a closed tab loses nothing: the setup screen offers to resume it. It is not part of Export/Import.
- A finished exam counts toward each answered question's totals (accuracy, weak spots) but not toward your carried-over streak, and is listed under "Practice exams" on the Progress page.
- Keys: 1 to 9 or T / F answer, arrows move, M flags. `npm run validate` checks the block.

## Mini games

Four short games per exam, built only from that exam's own questions and answers (nothing is made up; every question in the review at the end shows its source). Scores are kept per exam; the best score of each game is on the Progress page.

- **Match up**: 3 rounds of 6 questions and 6 answers; pick a question, then its answer (or use the number and letter keys). 10 points per match, minus 5 per wrong try.
- **Sort it**: drag each question into the topic it belongs to (3 rounds, 3 topics each). You can also pick a question (tap or Enter) and press 1, 2 or 3, or tap a topic. The right topic is the one the question has in `questions.json`.
- **Speed round**: 60 seconds of short multiple-choice and true/false questions; a wrong answer takes 3 seconds off the clock; the score is the number you got right.
- **Combo run**: 3 lives, no clock; every answer is worth 10 times a multiplier that goes up by 1 for every 3 right in a row (up to x5); a wrong answer costs a life and resets it.

Match up and Sort it use the pairs listed in `content/<exam>/games.json` (`"pairs": [question ids]`: the question is the clue, its answer is the match). Pick short, unambiguous questions without a source flag; no two pairs in a round may share an answer. Speed round and Combo run pick short questions automatically (flagged ones are left out). The answers you give in the Speed round and Combo run count toward your accuracy and weak spots, but not toward your carried-over streak. `npm run validate` checks `games.json`.

## Re-extract text from the course files

```
npm run extract
```

Reads `exams studies/` and rewrites `content/<exam>/sources/`. It needs `pdftotext` (poppler) for PDFs and LibreOffice for old `.ppt` files. Files that cannot be read yet are listed in the `SKIP` table at the top of `tools/extract.mjs`. Remove the entry once a readable copy is in the folder.

## Design

"Paper cutouts on a desk": flat colour fills, 2px ink borders and hard offset shadows on everything, with springy motion. Headings use Bricolage Grotesque, body text Geist, numbers and labels Geist Mono (all bundled in `app/fonts/`, SIL Open Font License, so the app works offline). Icons are Lucide (ISC). Springs come from Motion (MIT, `app/vendor/motion.js`).

- Each exam has its own accent colour, set as `accent` in its `exam.json`.
- Top bar toggles: sound (off by default), reduce motion, marker cursor (off by default), light/dark. "Reduce motion" is also switched on by your system setting, and it makes every animation land instantly.
- Pressing any key finishes a running animation, so nothing ever blocks you from answering.
- Colours, spacing and type sizes live at the top of `app/css/style.css`; the motion code is in `app/js/fx.js`.
- `docs/screenshots/` has screenshots of the real app; `docs/mockup/` is the standalone design mockup it came from.

## Progress

- Saved automatically in your browser (localStorage), separately per exam. This includes each question's history, the current streak (correct answers in a row, carried over between quizzes), the best streak, the flashcard schedule, your best mini game scores and a list of your sessions.
- Older saves keep working: any field a save is missing is filled with a default when it loads.
- Use **Export progress** on an exam's page to save a backup file named `learnathanze-<exam>-progress-YYYY-MM-DD.json` (always ending in `.json`; your browser may ask where to put it), and **Import progress** to restore it. An import is refused if the file belongs to the other exam, or is not a LearnAtHanze progress file. An exam simulation that is still running is not part of the backup.
- Reset needs two clicks. It only resets the exam you are on.

## Phone and accessibility

- Laptop first, phone friendly: every screen was checked at 390px wide with no sideways scroll. On touch screens the tap targets are at least 44px, tilt effects follow a mouse but never a finger, and Sort it can be played with a drag, a tap or the keyboard.
- Keyboard: every action has a key (shown on screen), and the focus ring is always visible. Colours keep text readable in light and dark (checked with Lighthouse: accessibility 100 on the screens that were audited).
- Motion: "reduce motion" (top bar, or your system setting) makes every animation land instantly.

## If something looks wrong

- **My progress looks empty:** progress is tied to the address. Use `http://localhost:3737` every time (not `127.0.0.1`, and not another port). Restore a backup with Import progress.
- **A page says something went wrong:** a content file you edited probably has a typo. Run `npm run validate`; it names the file and the item.
- **The port is busy:** another copy is still running. Stop it with `Ctrl+C` in its window. The app never picks another port on its own, so your progress stays where it is.

## Status

- [x] Content extraction and the question files for both exams
- [x] Quiz mode (multiple choice, true/false, fill in the blank, open questions; by topic or random mix; retry wrong ones)
- [x] Paper-cutout design with motion, light and dark, phone layout
- [x] Flashcards with spaced repetition (4 ratings, due-today count per exam)
- [x] Weak spots mode and progress view (accuracy over time, mastery per topic, streaks)
- [x] Exam simulation (timed, mixed, self-graded open answers, resumable)
- [x] Mini games (match up, sort it, speed round, combo run)
- [x] Polish: dated Export filename, touch and accessibility pass, README

Tested in Chromium (desktop and a touch-emulated phone). Not tested: Firefox, Safari, a physical phone, screen readers. The app uses modern CSS (`:has()`, `@property`), so use a current browser.
