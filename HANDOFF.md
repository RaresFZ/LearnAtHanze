# LearnAtHanze: handoff

Written at the end of the session that built steps 1 (content + quiz), the design and step 2 (flashcards); updated at the start of step 3. Read this first. It is meant to let a fresh session continue without re-asking anything.

## 1. What it is

A local study app for two **separate** Hanze exams. Everything runs on the user's own computer: no account, no online server. Content is plain editable JSON, every question cites its source, progress is saved in the browser.

| Exam | Folder id | Source folder |
|---|---|---|
| A: LEAN & Agile Project Management | `lean-agile` | `exams studies/LEAN & Agile Project Management/` |
| B: Outsourcing & Agile Governance | `outsourcing-governance` | `exams studies/Outsourcing & Agile Governance/` |

The two exams never share content, progress, stats or accent colour. Keep it that way in every new feature.

## 2. Run and check it

```
npm start              # http://localhost:3737 (opens the browser; NO_OPEN=1 stops that)
npm run validate       # checks every content/<exam>/questions.json (ids, topics, sources, answer indexes)
npm run extract        # re-extracts text from "exams studies/" into content/<exam>/sources/
```

- Port **3737 is fixed on purpose**: localStorage is tied to the address, so a different port looks like lost progress. If it is busy the server says so instead of picking another port. `PORT=4000` overrides it.
- Node 18+ (the machine has Node 24). No npm dependencies at all.
- `npm run extract` needs `pdftotext` (poppler, found via MiKTeX here) for PDFs and LibreOffice (`C:\Program Files\LibreOffice`) for old `.ppt`. It unzips pptx/xlsx with `C:/Windows/System32/tar.exe`.
- Git, on `main`: **no commits at all, on purpose.** The user asked Claude to remove every commit it had made (the session's four, then the initial `0ae80c0` from an earlier session) and said they will commit everything themselves, so every file is untracked. Do not commit or `git add` anything unless they ask again. The repo has an `origin` (GitHub) remote; it was empty when last checked, and nothing was pushed. `.gitignore` leaves out `exams studies/` (58MB of the user's own material), `.serena/`, `.playwright-mcp/`.
- Machine: Windows 11, PowerShell and Git Bash. Python is not installed. In Git Bash, Node reads `/tmp` as `C:\tmp`, so use real Windows paths for files Node reads.

## 3. Project structure

```
server.js                    tiny static server + /api/exams and /api/exams/<id> (reads the JSON on every request)
package.json                 scripts only
README.md                    user-facing: how to run, how to edit questions
HANDOFF.md                   this file
app/
  index.html                 shell: top bar (wordmark, exam switcher, toggles) + <main id="view">
  css/style.css              the whole design system (tokens at the top; motion-layer rules further down)
  fonts/                     bricolage.woff2, geist.woff2, geist-mono.woff2 (SIL OFL, bundled)
  vendor/motion.js           Motion 14.7.1 (MIT) UMD bundle -> window.Motion, plus motion.LICENSE.md
  js/main.js                 hash router, top bar, home, exam page (hero, stats, modes, topic rows, tools)
  js/quiz.js                 quiz setup, the run loop (progress blocks, streak sticker, mascot), results
  js/question.js             one question card for all 4 types; grading for fill-in; feedback note
  js/store.js                progress in localStorage; export/import; streak; weak-topic helper; per-card state (recordCard)
  js/cards.js                questions -> flashcards (pure, no DOM); answerText
  js/srs.js                  spaced-repetition scheduler (pure, no DOM): rate, buildQueue, deckStatus, NEW_PER_DAY
  js/flashcards.js           flashcards overview, session (card stack, flip), summary; exports tile() and runCards(.., { label })
  js/progress.js             pure numbers for step 3: weakQuestions, weakCards, dailySeries, studyDays, topicRows, overall (rules at the top)
  js/weak.js                 weak-spots page: counts, level switch, starts runQuiz / runCards on the weakest 20
  js/progress-view.js        progress page: tiles, accuracy-over-time bars (+ table), practice exams, mastery per topic, keeps-missing lists
  js/grade.js                gradeFill (pure), shared by the quiz card and the exam simulation (question.js re-exports it)
  js/sim.js                  exam simulation rules (pure): simConfig, pickExam, newAttempt, autoScore, pendingGrades, finalScores, clock
  js/simulation.js           exam simulation screens: setup, timed exam, self-grading, results (reuses quiz.js renderResults)
  js/games-data.js           mini game rules (pure): buildPairs, planMatch, planSort, quickPool, scoring (roundScore, combo, speed penalty)
  js/game-ui.js              shared game bits: GAMES metadata, header, stat chips, renderGameResult, startSession/destroyGame
  js/games.js                games list (#/exam/<id>/games) and one intro screen per game
  js/match.js, sort.js, quick.js   the four games (quick.js runs both Speed round and Combo run)
  js/fx.js                   motion layer (see section 5)
  js/icons.js                Lucide icons (ISC) as inline SVG paths
  js/util.js                 h() DOM helper (text via textContent only), mount, shuffle, pct, download
content/
  lean-agile/                Exam A
  outsourcing-governance/    Exam B
    exam.json                title, description, accent colour, examFormat, examFormatShort, documents map, gaps list
    topics.json              topics with coverage (good|medium|thin|missing), notes, examFocus
    questions.json           one question per line
    flashcards.json          which mc/tf questions are also flashcards (include) and which cards to drop (exclude)
    games.json               pairs: question ids usable in Match up / Sort it (question = clue, its answer = the match)
    sources/*.md             extracted course text, so every item can be checked against its source
tools/extract.mjs            extraction (see SKIP table at the top)
tools/validate.mjs           validator
docs/mockup/                 standalone design mockup (open exam.html); screens/ has its GIFs and stills
docs/screenshots/            screenshots of the real app (12 desktop, p1 to p7 phone, f1 to f11 flashcards, g1 to g16 progress and weak spots, h1 to h14 exam simulation, i1 to i21 mini games)
```

### Content file format

`questions.json` item: `id` (`la-NNN` for A, `og-NNN` for B), `type` (`mc` | `tf` | `fill` | `open`), `topic` (id from `topics.json`), `question`, `src` = `[documentKey, location]` (keys from `documents` in `exam.json`), optional `explanation`, optional `flag` (shown as "Check the source").

- `mc`: `options` (2 to 6) and `answer` (index). Options are shuffled when asked unless `fixedOrder: true`.
- `tf`: `answer` is `true`/`false`.
- `fill`: `answers` (accepted texts; one typo is forgiven for answers of 6+ characters), optional `numbers` (accepted numeric values) and `tolerance`.
- `open`: `modelAnswer`; the learner grades themself (Missed it 0, Partly 0.5, Got it 1).
- `origin` (Exam A only): `answer-key` for la-001 to la-020, `syllabus-practice` for la-101 to la-140.

Counts today: **A = 159** (89 mc, 18 tf, 23 fill, 29 open, 16 topics). **B = 150** (125 mc, 13 tf, 6 fill, 6 open, 10 topics).

- A: la-001 to la-020 are the answer-key questions **exactly as written** (`fixedOrder`). la-101 to la-140 are the syllabus self-test (items 9, 10 and 36 skipped because they repeat answer-key questions 8, 9 and 20). la-201 and up were written from the syllabus and slides.
- The scripts that generated these files lived in a temporary folder and are **gone**. The JSON files are now the source of truth: edit them directly and run `npm run validate`.

## 4. Decisions the user made (do not re-ask)

- Everything is in **English**.
- Progress in **browser storage** with **Export/Import** (no server-side progress file).
- **The syllabus PDF is the main source for Exam A.** It is a secondary reader (it says so itself: newly authored explanations, built from the slides and Kahoot results), so cite it as such. The 20 answer-key MCs stay as-is.
- **Exam B is a multiple-choice theory exam** (week 46, per the Lecture 1 course plan), so MC is the priority there (125 of 150).
- Every question/card cites its source; unclear things are **flagged**, never guessed.
- Content is simple editable JSON; the user may fix or add questions themself.
- **Hide study modes that do not exist yet.** No "Soon" tiles. Quiz, Flashcards, Weak spots, Exam simulation, Mini games and Progress show today (3 columns x 2 rows of tiles on desktop).
- Exam simulation (answered in step 4): Exam A's format is unknown and Exam B only says "multiple choice", so both use a **configurable practice setup marked unofficial** (A: 30 questions / 45 min / all types; B: 40 / 60 min / mc + tf only; pass mark null = no pass/fail). The numbers live in `exam.json` `simulation` and must be replaced only with figures the user gives. Do not present them as the real format.
- Mini games (step 5): no new content. Pairs are curated ids of existing questions in `games.json` (flagged questions excluded as unfair to race on); the sort game's right answer is the question's own `topic`; Speed round and Combo run use short, unflagged mc/tf questions. Scores: higher is always better; best/plays/last stored per game in `progress.games`.
- Flashcards: 20 new cards per day, flashcard ratings stay **separate from quiz stats** (the user was asked and confirmed by moving on; step 3 may read both for weak spots, but must not mix the stored data).
- The **metrics deck** (`Intro LEAN Minor IT Mgmt CMI 1 1920 metrics 2026 v2.ppt`) stays **skipped** until the user adds a re-saved `.pptx` or PDF. It is listed in the `SKIP` table in `tools/extract.mjs`; remove the entry when a readable copy is in the folder, rerun `npm run extract`, then check the metrics content against it.
- Missing Scrum lectures 2 to 4 and the Outsourcing I book excerpt: the user will add them if they find them.
- The user wants: a report after each part, and to **wait for their OK before starting the next part**.

## 5. Design system: "paper cutouts on a desk"

Flat, bold, tactile. Printed stickers and chunky buttons, not a SaaS dashboard. Spec comes from the user; screenshots in `docs/screenshots/`.

**Hard rules**
- Every card, button, chip and input: **2px solid ink border + hard offset shadow** (`4px 4px 0` in ink, zero blur). Chips, sticker, stamp and keycaps use 3px; hover lift grows it to 6px (done by moving the face over a fixed shadow layer).
- Radius 8px on cards/buttons, 999px on pills, chips wrap with a 16px radius. No gradients, glassmorphism, glow, emoji, purple/blue AI gradients. Flat saturated fills, one colour per tile. Paper grain: 3% SVG noise on the page background.
- Icons: one set (Lucide, SVG). To add one, copy its paths into `app/js/icons.js`.

**Colours** (CSS variables in `style.css`)

| | Light | Dark |
|---|---|---|
| Page | `#F4EFE6` | `#141414` |
| Card | `#FFFDF8` | `#1E1E1E` |
| Ink (text, borders, shadows) | `#141414` | `#F4EFE6` |

- Fills identical in both themes: yellow `#FFD83D` (correct, highlights, primary buttons), red `#FF4D4D` (wrong), coral `#FF9F7A`, lilac `#D4B8FF`, sky `#8FDBFF`. Text on any flat fill is always `#141414` (`--on-fill`).
- Exam accents (set as `accent` in each `exam.json`, applied to `--accent` on `<body>`; changes blend because `--accent` is a registered `@property`): **A lime `#B8F25B`**, **B periwinkle `#9DB0FF`**. Default (home) is yellow.
- Correct = yellow fill with a marker-underline swipe. Wrong = red fill with a hand-drawn strike (clip-path animation), and the right answer is still highlighted.

**Type**: headings Bricolage Grotesque 800 (tight tracking; exam title 48px, section headings ~28px); body and UI Geist 400/500; numbers, labels, chips, keycaps Geist Mono (uppercase labels 12px, 0.04em). **No serif anywhere.** Sentence case in the interface.

**Layout**: top bar with the exam switcher (pills with the exam colour), content max 1100px. Exam page bento: hero tile in the exam accent with the big yellow "Continue quiz" button, 4 stat tiles (practised, accuracy, current streak, weak topics), "Ways to study" tiles, topics as chunky rows with a 10-block mastery bar (+ warning badge on thin topics), "Material notes" chip that opens a collapsible panel with the gaps. Quiz: one centred card with a segmented progress bar, streak sticker, keycap hints. Results: giant score, tilted stamp, by-topic bars, collapsible review rows.

**The object model** (`app/js/fx.js`): `FX.obj(face, opts)` wraps any element as `obj > tilt > (shadow, lift > face)`. Hover lifts the face in Z, press sinks it onto the shadow, tilt (when `tilt` is set) rotates toward the cursor while the shadow shifts the opposite way, an optional flat white shine strip follows the cursor. Options: `cls` (`o-btn`, `o-pill`, `o-icon`, `o-tile`, `o-mode`, `o-row`, `o-opt`, `o-input`, `o-card`, `o-hero`), `tilt`, `shine`, `fill`, `z`, `hover:false`, `rot`. Use `FX.anim` (never `Motion.animate` directly) so reduced motion and key-to-skip work. Use `FX.enter`, `FX.count`, `FX.fillSegs`, `FX.wave`, `FX.confetti`, `FX.mascot`, `FX.transition`/`FX.navigate`, `FX.base()` for entrance delays under a wipe.

**Motion library**: **Motion** (vanilla UMD, MIT, bundled in `app/vendor/motion.js`, no CDN). Spring presets in `FX.spring`. Only transform and opacity are animated (the shadow offset moves through a CSS variable). Everything works offline.

**Motion rules (all implemented)**
- Respect `prefers-reduced-motion` **and** a top-bar "reduce motion" toggle; reduced = every animation jumps to its end state, decoration is hidden, no wipe.
- Pressing **any key finishes running animations** (capture-phase listener), so nothing blocks answering.
- Spring-based, 120 to 160ms for small transitions. Hover/press move with translate, not scale.

**Effect decisions (user-approved)**

| Effect | Decision |
|---|---|
| Hero floating cube/star/pencil with mouse parallax | **Kept**, 50% opacity, behind content, removed when motion is reduced |
| Custom marker cursor | **Off by default**; toggle stays in the top bar |
| "Continue quiz" idle wiggle every 6s | **Cut**. One wiggle on the first exam-page load only |
| Confetti | **Small (~8 pieces) on every correct answer; bigger at streak 3, 5, 10**. Fire-and-forget, never delays the next question |
| Page wipe | **Kept**, circle in the accent colour, ~250ms each way, **no text** (the text lines were cut) |
| Hero tilt | **Max 4deg** (tiles and mode tiles 8, answer blocks 3) |
| Sound | Synthesized (no files), **off by default**, mute toggle in the top bar |
| Everything else from the mockup | **Kept**: press-and-sink springs, tilt + shine on tiles/answers, quiz card dealt from a deck (old card flies off), shake + strike on wrong, correct option pops, progress block pop + flash, bars filling block by block (40ms), count-ups, tiles dropping in 60ms apart, results stamp drop (thud, tiny screen shake, shadow snaps in; text by score: Boss mode 100, Nailed it 85+, Solid 65+, Almost 45+, Keep going), pencil mascot (happy/worried, also a fresh-state bubble on the exam page), streak sticker with flames at 3/5/10, topic-row bar ripple on hover, exam-switch wipe + accent blend, logo easter egg (spins the sticker) |
| "Soon" cards for unbuilt modes | **Cut** (hidden until built) |

Prefs live in localStorage as `learnathanze:theme` (`light`/`dark`), `learnathanze:reduce` (`auto`/`on`/`off`), `learnathanze:sound` (`off`/`on`), `learnathanze:cursor` (`off`/`on`). URL overrides for testing: `?reduce=1`, `?sound=on`, `?cursor=on`.

**Lessons learned**
- Never give a large object a Z lift (the hero uses `z: 0`): it forced a big layer to re-rasterize and flashed black in recordings.
- Dim a disabled/dimmed button as one object (opacity on `.obj`), otherwise the shadow shows through the face.
- `String.replace` collapses `$$` to `$`: be careful when patching code containing `$$` with Node scripts.

**Mockup**: `docs/mockup/` is the standalone mockup the design was approved from (`exam.html`, `quiz.html`, `results.html`; open directly). It has its own copy of `fx.js`/`fx.css`, a scripted "director" (`demo.js`, `?demo=reel` plays a hands-free tour) and `screens/` with five GIFs of the interactions. The real app is the source of truth now.

## 6. Progress data

localStorage key **`learnathanze:v1:<examId>`**, one object per exam, never mixed:

```json
{ "v": 1, "exam": "lean-agile",
  "questions": { "la-001": { "n": 3, "score": 2.5, "last": 1793213570329, "lastScore": 1, "streak": 2 } },
  "sessions": [ { "ts": 1793213570329, "mode": "quiz", "label": "Topic quiz", "answered": 10, "score": 7, "bestStreak": 4 } ],
  "bestStreak": 6,
  "streak": 3,
  "cards": { "la-021": { "due": 1793300000000, "interval": 4, "ease": 2.65, "reps": 1, "lapses": 0, "misses": 0, "first": 1793213570329, "last": 1793213570329 } } }
```

- `cards` is the flashcard state per card id (same object, never mixed with the quiz `questions` map). `misses` counts every Again rating (older saves lack it and default to 0; weak-card logic uses max(lapses, misses)). `interval 0` = being learned or relearned (due in minutes); `interval >= 1` = review, due that many days after the start of the rated day. Defaulted to `{}` on load, so older saves and imports still work.

- `streak` is the **carried-over current streak**: correct answers in a row, kept between quizzes. Only a score of 1 extends it; a wrong answer or a partial (0.5) resets it. `bestStreak` is the highest ever. A quiz starts with the carried streak (the sticker shows from 2).
- `sessions` keeps the last 200. An answer is recorded when the learner advances (or when they End quiz after answering), so a fill-in "my answer was right" override counts correctly.
- Derived numbers: **mastered** question = last attempt scored 1. **Accuracy** = mean per-question accuracy over practised questions. **Weak topic** = 3+ answers in the topic and under 60% right.
- **Mini game storage**: `progress.games = { match|sort|speed|combo: { plays, best, last, lastTs } }` (defaulted to `{}` on load, so older saves and backups still work). `recordGame` in store.js writes it, pushes one session `{ mode: 'game', game, answered, score, seconds }` (counts as a study day; `dailySeries` ignores it) and, for Speed round and Combo run only, updates each answered question's totals (not the carried-over streak). Quitting before any action records nothing.
- **Exam simulation storage**: the attempt in progress is `learnathanze:sim:<examId>` (own key, NOT in Export/Import; cleared by Reset): `{ ids, orders (mc option order), answers, flags, minutes, startedAt, endAt, submittedAt, timedOut, grades }`. Time is an absolute `endAt`, so a reload or a closed tab keeps the real clock. A finished exam is written once by `recordExam` in store.js: per answered question totals (`n`, `score`, `last`, `streak`) but NOT the carried-over `streak`/`bestStreak`, plus one session `{ mode: 'simulation', answered, total, score, minutes, seconds, timedOut }`. `dailySeries` ignores `simulation` sessions (the accuracy chart stays quiz-only); the Progress page lists them under "Practice exams".
- **Step 3 definitions (all derived, nothing new stored except card `misses`; see `progress.js`)**: a question is *weak* when points lost (`n - score`) >= 2 and its `streak` < 2 (answered right twice in a row recovers it); a card is weak when max(lapses, misses) >= 2 and `interval` < 7 days. The weak-spots page can lower the bar to 1 miss. *Accuracy over time* groups `sessions` by local day (last 14 days that have a quiz, or cards: share rated Good/Easy). *Study days* = consecutive days (ending today, or yesterday) with any session, question `last` or card `last`. *Mastery per topic* = quiz mastered (last attempt fully right) and cards learned (interval >= 1). A weak-spots quiz is saved as a normal `quiz` session labelled `Weak spots`; weak cards as a `cards` session with that label.
- **Old saves still load**: `loadProgress` fills every missing field with a default (an old save without `streak`/`bestStreak` simply starts at 0). No migration step, version stays 1. Verified with a legacy save and an old-format import.
- **Export** downloads the exam's JSON; **Import** validates it, **refuses a file whose `exam` is the other exam** (message names both), refuses non-JSON and non-LearnAtHanze files, and normalizes missing fields. The file in storage is untouched on refusal. Verified.
- Reset needs two clicks (confirm), per exam.

## 7. Known content gaps (also shown in the app under "Material notes")

**Exam A (`lean-agile`)**
- Metrics deck skipped (unreadable: LibreOffice produced ~32,000 garbage pages from the 8MB `.ppt`). Waiting for a re-saved copy.
- Scrum lectures 2 to 4 missing: no Scrum roles/artifacts/events content (only values, pillars, Agile Manifesto from the lecture 5/6 decks).
- ITIL 4: names/structure only, no explanations. Obeya: title only ("A0 floor"), no questions written. Agile vs Waterfall vs Start-up: four labels only. Kanban/DevOps: principles and definitions only (videos and the coffee example are not text).
- Chapter 9 statistics (control charts, Cp/Cpk) is syllabus-only; no lecture slide covers it, so it may be beyond the exam.
- The real exam format is not stated anywhere.

**Exam B (`outsourcing-governance`)**
- Outsourcing I's book excerpt (Blackboard, "see BB") is not in the folder.
- Lecture 6 (Spaceship game): rules only. SAFe "essential"/"full configuration" pictures hold more than the text slides; BCG matrix and Business Model Canvas slides are pictures with titles only.
- Not in the folder: the Debating Best Practices document, the audit report example structure ("see BS"), anything for week 45 (PI Planning preparation). YouTube video content is unavailable.

**Contradictions and oddities in the material (flagged on the questions)**
- Wastes: Lesson 3 slide shows 7 wastes, the syllabus 8 (adds unused talent). Questions follow the syllabus and say so.
- Vendor lock-in: Lecture 4 says "at least 20% of IT services in-house", Lecture 5 says "e.g. 25% SRO personnel". Different measures, kept apart.
- Executive MetaScrum: slide 19 "at least once per sprint" vs slide 24 table "weekly".
- PI length: slide 5 "8 to 12 weeks" vs slides 8 and 26 "10 weeks, 5 sprints"; ART "5 to 12 teams" is the slide's figure.
- Slide typos: Lecture 5 sets innovation targets "for an SRO" (means SPO), "TRE" for RTE, "Adaption" for Adaptation.
- COBIT figures (5 domains, 37 processes, ...) and ISO 27001 "114 controls" are taken from the slides; the edition/version is not stated, so verify if the exam may expect other numbers.
- The syllabus lists low-scoring class-quiz themes (Poka Yoke, Champion, TPS, Mura, 5 Whys, takt time, SIPOC, VOC, aims of Six Sigma). They are marked as `examFocus` in `topics.json`.
- Image-only slides were read from rendered pictures (rendered via LibreOffice to PDF to PNG); those questions carry a flag saying so.

## 8. Known issues and things not tested

**Fixed (step 6): Export progress filename.** The file is now `learnathanze-<exam>-progress-YYYY-MM-DD.json` (local date), and `download()` in `app/js/util.js` appends `.json` if missing. Likely cause of the user's missing extension, not reproducible in Chromium: the blob URL was revoked right after `click()`, which can make a browser save it under a random name; it is now revoked after 60 s. Verified in the Playwright browser through its download event (both exams: name pattern, valid JSON, round trip through Import). **Still ask the user to confirm in their own browser.** Testing an export triggers a download: only do it in the Playwright browser, or tell the user first.

**Fixed: black flash on mouse-out** (reported by the user, confirmed gone on their machine). The hover spring overshoots to about -1.1px depth on release, which put the face behind its solid ink `.shadow` layer for about 180ms. The shadow now sits at `translate3d(.., -6px)`. Keep any new layer behind a lifted face clear of z = 0.

**Performance, step 6 survey (Chromium, 4x CPU throttle, long-task observer):** no long task (over 50 ms) on any screen except the Exam A page load (one 68 ms task, about 17 ms unthrottled). Quiz: moving to the next question, worst frame 7 ms at 4x and 21 ms at 6x, none over 50 ms in 10 changes, so the old 97 ms spike below does not reproduce and no pre-build was added to the quiz (the flashcards still pre-build). Games and the exam simulation: no long task when a round or a question appears. Touch: real touch drag (CDP touch events) works in Sort it and the page does not scroll during it.

**Performance, earlier measurements** (measured with a rAF meter in Chromium on a 144Hz display): exam page entrance 143.7 fps avg, hover sweep 144, quiz with confetti ~144 (one 20.8ms frame), results stamp 144. With the CPU throttled 4x: 131 to 142 fps average, p95 frame time 7 to 14ms, but isolated long frames: up to 83ms (exam entrance), 97ms (quiz, when the next question card is built), 42ms (results). Nothing sustained below 55fps. **Proposed fix if a stutter shows up: build the next question card ahead of time while the learner reads the feedback.** The flashcards already pre-build the next card (worst frame 14ms at 4x throttle, none over 50ms; the quiz itself is not changed yet).

**Not tested**: a physical phone (a touch-emulated 390px Chromium context was tested in step 6: taps, flashcard flip, real touch drag, tap targets); Firefox and Safari (only Chromium; the CSS uses `:has()` and `@property`, which need a modern browser); screen readers; real audio; touch behaviour of tilt/cursor; very long sessions.

Other notes: progress is tied to `http://localhost:3737` (a different port or host looks empty; Export/Import is the backup). The repo is ~23MB mostly because of `docs/` (screenshots and GIFs). The flaky bit of testing tooling: screenshots taken with the Playwright MCP are saved relative to the project root, so delete stray ones and `.playwright-mcp/` before committing.

## 9. Roadmap (do one step at a time, report, wait for OK)

1. **Step 1: done.** Extraction, both exams' content, quiz mode.
   - Done after step 1: the redesign, motion, carried-over streak, committed.
2. **Step 2: flashcards with spaced repetition: DONE and approved, built (not committed, see section 2).** Built: `app/js/flashcards.js` (overview, session, summary), `srs.js` (scheduler, no DOM), `cards.js` (questions -> cards, no DOM), `content/<exam>/flashcards.json` (include/exclude lists), `cards` map in the progress object, route `#/exam/<id>/cards`, due-today chips on home and the exam page. Cards: A = 94, B = 119. New cards per day: 20 (`NEW_PER_DAY` in srs.js). Next card is pre-built while the current one is read.
   Original brief:
   - Same content files and cited sources; Exam A and B fully separate.
   - Cards you miss come back more often, rated with **Again / Hard / Good / Easy** as **4 colored bordered buttons**.
   - Card stack look: **2 offset cards behind the front one**, a flip animation, built on the same motion system (`FX.obj`, springs, `FX.anim`).
   - Reuse existing questions where it makes sense (definitions, key terms); **do not invent anything**. Open/fill/short-definition questions are the natural source. Optional hand-written `flashcards.json` per exam with a `src` on every card.
   - The metrics deck stays skipped.
   - Suggested (not decided) storage: add `cards: { [cardId]: { due, interval, ease, reps, lapses } }` to the per-exam progress object (version stays 1, defaulted on load like `streak`). Only enable the "Flashcards" mode tile when it exists.
3. **Step 3: progress tracking + weak spots mode: DONE, approved (not committed, see section 2).** Built: routes `#/exam/<id>/weak` and `#/exam/<id>/progress`, two new tiles in "Ways to study" (Weak spots with a "N to fix" chip, Progress), the files listed in section 3. Tested in Chromium with seeded data: both exams, an old-format save, empty states, light and dark, 390px phone, reduced motion, import refusal of the other exam's backup (done through the real Import input, no download). Not tested: real touch device, Firefox/Safari, screen readers. Original brief: Brief from the user: per exam, fully separate; a weak-spots mode that focuses on questions and cards the learner keeps getting wrong, built on the existing quiz and flashcard modes; a progress view per exam (accuracy over time, mastery per topic, questions they keep missing, streaks); reuse the design system and motion; hide nothing that exists and show nothing that does not; old saves must still load and Export/Import must still refuse the other exam's backup; screenshots of the real app; tell the user before triggering any download.
4. **Step 4: exam simulation: DONE and approved, NOT committed yet** (not committed, see section 2). Built: route `#/exam/<id>/simulation`, tile on the exam page, `simulation` block in both `exam.json` (validated by `npm run validate`), files in section 3. Flow: setup (length, minutes) -> timed exam (numbered navigator, flag, change answers, submit panel, auto-submit at 0, resume after reload) -> grade your open answers / overrule wrong fill-ins -> results (same screen as the quiz plus your own answer in each review row). Tested in Chromium: both exams, exact scores (MC with shuffled options, TF, fill, open, overrides), unanswered questions, resume, time ran out while away, live auto-submit, leaving mid-exam, light/dark, 390px phone, reduced motion, 8 question changes at 4x throttle (no long task). Not tested: real touch device, Firefox/Safari, screen readers, a real multi-hour wait. Original brief: Timed, mixed questions, final score. For Exam B follow the real format (multiple choice); Exam A's format is unknown, so ask.
5. **Step 5: mini games: DONE and approved, NOT committed yet.** Built: routes `#/exam/<id>/games` and `/games/<match|sort|speed|combo>`, a Mini games tile, `games.json` per exam (35 pairs for A, 32 for B; validated by `npm run validate`), the files listed in section 3, a "Mini games" section on the Progress page (only games played). Tested in Chromium: exact scores in all four games (Match 175 = 18x10-5, Sort 265 = 27x10-5, Combo 10+10+10+20+10 = 60 with 3 lives, Speed 5 right with two 3-second penalties and the clock ending it), real mouse drag, tap-to-pick, keyboard, early exit, leaving mid-game, both exams, old saves/backups, light/dark, 390px phone, reduced motion, 4x throttle (no long task). Not tested: real touch dragging on a phone, Firefox/Safari, screen readers, sound. Original brief: Match term to definition, timed speed round, drag-into-category, streak/combo game. Reuse the object model and mascot.
6. **Step 6: polish + README: DONE, waiting for the user's OK, NOT committed yet.** Done: dated Export filename (above); performance survey (see section 8); touch pass (44px targets under `@media (pointer: coarse)`, tilt ignores touch, hover-only rules guarded by `@media (hover: hover)`); Lighthouse accessibility audit with fixes (heading order, meta description, flashcard rating button names, quiz progress bar name, dim contrast of unchosen/matched options); README rewritten (overview, backups, phone and accessibility, troubleshooting). Smoke test: 96 screen visits (both exams, 11 screens + a missing page, 1280px and 390px, light and dark): no console errors, no sideways scroll, a heading on every screen. **All six roadmap steps are now built.** Original brief for this step: Fix the Export filename if still open, performance pass (card pre-build), phone/touch test, README update.

Each new mode: new tile on the exam page (only once it exists), uses the design system and motion rules above, light and dark, phone width, reduced motion.

## 10. Working rules

- **Don't invent facts.** Everything comes from the user's material. If something is unclear or contradictory, flag it (`flag` field, "Check the source") instead of guessing.
- **Cite the source on every item** (`src: [documentKey, location]`).
- **Report after each part**, with screenshots of the real app when the UI changes, and **wait for the user's OK** before the next part. Say plainly what was tested and what was not.
- **Tell the user whenever you trigger a download in their browser** (Export, opening files, etc.).
- Keep Exam A and Exam B strictly separate: content, progress, stats, accent colour.
- The Export filename bug (section 8) is still **open**; it stays in step 6 unless the user asks earlier.
- Don't name a CSS class `back`: it collides with the existing `.back` link style (the flashcard sides are `f-front` / `f-back`).
- Run `npm run validate` after any content change. Keep the metrics deck in the `SKIP` list until the user adds a readable copy.
- Design asks from the user that still apply: no emoji icons, no purple/blue gradients, no glassmorphism, no generic centred-everything SaaS look; calm, focused quiz view; laptop first, phone friendly; every effect must respect reduce-motion and never block answering.
- Commit only when asked. Commit messages end with the session trailer given by the harness (`Claude-Session: ...`).
- The user's global instructions note that command output may be condensed; if a result looks empty or garbled, rerun it as `rtk proxy <cmd>`.
