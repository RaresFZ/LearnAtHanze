# LearnAtHanze: handoff

Written at the end of the session that built steps 1 (content + quiz), the design and step 2 (flashcards); updated at the start of step 3. Read this first. It is meant to let a fresh session continue without re-asking anything.

**Latest work: Live Quiz (Kahoot-style multiplayer), see section 11.** All three of its build steps are built; **step 3 (robustness, network guidance, README + this file) is done and waits for the user's OK**, plus one more real-phone LAN test with Windows Firewall that the user will do themself. All six original roadmap steps (section 9) are complete and unrelated to it.

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
npm run test:live      # Live Quiz engine tests (node --test, fake clock, 21 tests)
npm run test:live:http # Live Quiz over real HTTP (6 tests, ~22 s): isolation, no-leak, 15 simulated phones, heartbeat, long-poll fallback, restart, busy port, tunnel address (starts its own server on 3757/3758)
```

Live Quiz ports: the play server for phones is **3738** (`PLAY_PORT` overrides), opened only while a game is hosted. Test-only env: `LIVE_LAN=off` (never open the network, loopback only), `LIVE_LAN=loopback` (loopback only but still *reports* the LAN address, for screenshots and QR tests), `LIVE_SSE=off` (the phone event stream hangs silently, like a tunnel that swallows streams: forces the long-poll fallback) and short timers `LIVE_HEARTBEAT_MS`, `LIVE_POLL_HOLD_MS`, `LIVE_HOST_AWAY_MS` (defaults 10000 / 20000 / 6000). A plain `npm start` opens the network when a game is created (Windows Firewall will ask once). `PORT` and `PLAY_PORT` must differ (the server refuses to start otherwise).

- Port **3737 is fixed on purpose**: localStorage is tied to the address, so a different port looks like lost progress. If it is busy the server says so instead of picking another port. `PORT=4000` overrides it.
- Node 18+ (the machine has Node 24). No npm dependencies at all.
- `npm run extract` needs `pdftotext` (poppler, found via MiKTeX here) for PDFs and LibreOffice (`C:\Program Files\LibreOffice`) for old `.ppt`. It unzips pptx/xlsx with `C:/Windows/System32/tar.exe`.
- Git, on `main`: **the user makes all commits themselves** (the repo now has their commits, e.g. `bdc2221`). Claude does not commit and does not `git add` anything unless they ask. The repo has an `origin` (GitHub) remote; nothing is pushed by Claude. `.gitignore` leaves out `exams studies/` (58MB of the user's own material), `.serena/`, `.playwright-mcp/`.
- Machine: Windows 11, PowerShell and Git Bash. Python is not installed. In Git Bash, Node reads `/tmp` as `C:\tmp`, so use real Windows paths for files Node reads.

## 3. Project structure

```
server.js                    tiny static server + /api/exams and /api/exams/<id> (reads the JSON on every request); mounts the Live Quiz host API at /api/live/* (server/live/hub.js)
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
  js/live.js                 Live Quiz host: setup screen, host view shell, net bar, lobby (code, local QR, players), host stream with watchdog
  js/live-help.js            Live Quiz host: the "Phones can't connect?" panel (steps, copyable commands, tunnel address field); host page only
  js/live-rounds.js          Live Quiz host round screens: ready, question+reveal (one screen), leaderboard, podium
  js/live-shared.js          Live Quiz pieces used by host AND phones: timeBar, optionBlock, boardList (FLIP rank slide), podium, stamp
  play/                      phone page: index.html, play.js (join, lobby, stream), rounds.js (phone round screens), theme.js
  css/live.css               all Live Quiz styles (host + phone)
  vendor/qrcode.js           qrcode-generator 1.4.4 (MIT, unmodified) + qrcode.LICENSE.md; lazy-loaded by the host lobby only
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
server/live/engine.js        Live Quiz game engine (pure, injected clock, ONE game): state machine, scoring, join/rejoin, per-viewer views
server/live/hub.js           Live Quiz hub: the play server (allow-listed files + /live/*), SSE streams, host API under /api/live/*
server/live/lan.js           picks the LAN IPv4 address(es) phones should use
tools/test-live-engine.mjs   engine tests; tools/test-live-http.mjs  HTTP integration test (needs LIVE_* timers set by its own boot())
tools/extract.mjs            extraction (see SKIP table at the top)
tools/validate.mjs           validator
docs/mockup/                 standalone design mockup (open exam.html); screens/ has its GIFs and stills
docs/screenshots/            screenshots of the real app (12 desktop, p1 to p7 phone, f1 to f11 flashcards, g1 to g16 progress and weak spots, h1 to h14 exam simulation, i1 to i21 mini games, j1 to j13 Live Quiz step 1, k1 to k22 step 2, m2 to m23 step 3)
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

7. **Extra feature after step 6: Live Quiz (multiplayer).** Its own 3-step build order, see **section 11** (all three steps built; step 3 waits for the user's OK). It adds a wide "Live Quiz" tile under "Ways to study" on the exam page (shows a "Hosting now" chip while a game runs).

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
- **Never kill processes on ports 3737/3738** (the user may be running their own server or a real game). Test servers go on spare ports (3747/3748, or the HTTP test's 3757/3758) and only those get stopped. A broad kill command was already blocked once for this.

## 11. Live Quiz (multiplayer, Kahoot-style): status and design

**Brief (from the user):** host on the laptop opens "Live Quiz" from an exam page, picks topics / count (5/10/20) / seconds (10/20/30); big-screen host view with join code, local QR, live player list, Start. Friends join on phones (no account), 4 big colour answer buttons (2 for true/false), reveal, leaderboard top 5 with animated rank changes, podium + stamp + winner confetti, Play again, "I'm playing too" for the host. Same paper-cutout design and motion system. Build order: 1 engine+lobby+join, 2 rounds, 3 robustness+docs. User wants a report with screenshots after each step and waits to OK the next.

**Decisions the user approved (do not re-ask):** SSE + POST, no `ws`, no npm dependency; vendored `qrcode-generator` (QR must decode, verified); flagged questions excluded (multiple choice and true/false only); scoring `round(500 + 500 x timeLeft/limit)` for a correct answer + streak bonus `min(streakBefore, 5) x 50`; the LAN listener opens automatically when a game is created, with a visible "Phones can join" switch and banner; no joining after the start except rejoining, plus a host toggle "Allow late joiners (start at 0 points)" default off. Real LAN test: the user joined with their phone over the real network and started a game (firewall prompt handled), so the join path works on a real phone.

**Status**
- Step 1 (engine, lobby, join): DONE, approved (user tested on a real phone over the real network, firewall prompt handled).
- Step 2 (rounds, scoring, reveal, leaderboard, podium, late-joiner toggle, Play again): DONE. The user had not played the round screens on a real phone when step 3 started.
- **Step 3 (robustness, network guidance, docs): DONE, reported, waiting for the user's OK.** What it changed:
  - **Connection layer.** The server sends an `event: ping` heartbeat every 10 s on every stream. The phone page and the host page restart their connection when nothing (no message, no ping) arrived for 30 s, when the tab becomes visible again, on `pageshow` and on `online`. Phones show "Reconnecting…" after 1.5 s of failure, which turns into "Cannot reach the game. Check your Wi-Fi, or ask the host if it is still running." after 20 s and stays until a connection works.
  - **Long-poll fallback.** Cloudflare's docs say quick tunnels (`cloudflared tunnel --url`) do **not** support SSE, so the planned last-resort tunnel would have shown phones a blank lobby. Now, if the event stream delivers nothing within 5 s, the phone switches (remembered in sessionStorage `learnathanze:live:poll`) to `GET /live/state?t&c&tag`: answers at once when the phone's `tag` (rev + hostAway) is out of date, else holds up to 20 s and is released by the next change; answers still go by POST. Same `viewFor()` payload, so the no-leak rules are identical (tested). Tested with `LIVE_SSE=off` only, **never through a real tunnel**.
  - **Clear "gone" messages**: the phone sends its game code with the stream/poll; server says "There is no game running any more…", "That game has ended. If the host started a new one, type its new code." (code field left empty), "The host removed you from this game." (kicked tokens are remembered), or "You are no longer in this game. Join again with your nickname.". The phone remembers the last nickname (`learnathanze:live:lastNick`).
  - **Away players keep their seat** for `LIMITS.keepMs` = 5 min (engine `lastSeen`/`stale()`): the lobby sweep, starting the game and Play again drop only seats nobody came back to for 5 min. Before, a phone that locked its screen in the lobby was removed about 9 s later. A nickname is still free to take back as soon as its stream is gone.
  - **Bug fixed**: `boardRows` crashed the host view when a player was kicked between the reveal and the leaderboard (API only; the host UI has kick buttons in the lobby). Test added and confirmed to fail without the fix.
  - **Host away**: phones get `hostAway` (host screen gone for more than 6 s) and show "The host is away. The game goes on when they are back." at the bottom; the game itself keeps running and waits at the reveal. A host who comes back (`#/exam/<id>/live/host`, or the Live Quiz tile, or "Go to the running game") lands on the current screen. When the host page learns the game is gone without the host pressing End (server restarted) it goes to the setup screen with a notice.
  - **Busy play port**: `create` answers 409 `code: 'port'` with "Port 3738 is already in use, probably by a second copy of this app or a game you left running. Close it and try again, or start the app with another play port (PLAY_PORT=3748)." and nothing is left half-created.
  - **Tunnel address**: host action `public` ({ url }) keeps only the origin (https assumed when no scheme; refuses credentials, non-http(s), hosts without a dot), shown as the join address and QR (`net.publicUrl`, `net.publicJoinUrl`), reset when the game ends. Switching "Phones can join" off does NOT cut a tunnel (the tunnel connects from loopback); the panel and the net bar say so. For connections from loopback the join rate limit uses `CF-Connecting-IP` / `X-Forwarded-For` when present; with neither header a tunnel visitor looks like the laptop and is not limited (the 5-digit code is then the only lock).
  - The lobby address list re-checks the network every 5 s (laptop joined a hotspot): the address updates by itself.
  - **Docs**: README has a Live Quiz section (hosting, joining, rules, what it does not touch, the 5 network steps, busy port); the host's help panel has the same steps with copy buttons.
**Architecture (the rules that must keep holding)**
- Two servers. Host server (`server.js`, **127.0.0.1:3737**, unchanged, plus `/api/live/*` through `hub.handleHost`) has the whole app, the content and the host controls, and checks the `Host` and `Origin` headers and JSON content type. The **play server (3738)** listens on `0.0.0.0` only while a game exists (and only while the switch is on; off = loopback only, a hard cut that drops every phone, they reconnect when it is turned back on). It serves ONLY the allow-list `PLAY_FILES` in `hub.js` (play page files, `style.css`, `live.css`, `fx.js`, `icons.js`, `util.js`, `live-shared.js`, `motion.js`, three fonts) and `/live/*` (`POST join|answer|leave`, `GET events`); everything else is 404. **Any new file a phone needs must be added to `PLAY_FILES` and to the 404/200 lists in `tools/test-live-http.mjs`.** A CSP header is sent (script-src 'self'; the theme script lives in `play/theme.js` for that reason).
- Engine (`engine.js`) is authoritative: clock, answer checking, scoring, ranks. Phases: lobby -> ready (2 s) -> question (+ `paused` flag) -> reveal -> board -> ready ... -> podium; last question goes reveal -> podium. `hostView()` and `playerView(token)` are the ONLY things that leave the engine; `answer`, `explanation`, `source` and per-option counts appear only from the reveal on (tests assert this for every pre-reveal payload). Phones get "ms remaining" and count down locally (no clock sync needed). Answers accepted until deadline + 300 ms grace. Players removed by the host vanish from later boards (`boardRows` filters ids that no longer exist).
- Ranks: score, then less total time on correct answers, then name. Board rows carry `delta` (positive = moved up) and `gain`. Exam A and B stay separate: a game only ever uses one exam's questions and accent. **Live Quiz never touches `store.js` or the solo progress** (verified; it only writes `learnathanze:live:session`, `learnathanze:live:hostNick`, and shares `learnathanze:theme`/reduce prefs).
- Streams: SSE both ways of "state" (server pushes a complete per-viewer snapshot on every change, coalesced ~30 ms), so reconnect/refresh = just receive the current state. A phone is shown "away" 4 s after its last stream or poll ends (`DROP_AFTER_MS`, `released()` in hub.js). Tokens are server-issued; phones keep `{code, token, nick}` in localStorage. The host's own player seat ("I'm playing too") is a normal player with `isHost`, reached through a `localhost:3738/#c=..&t=..` link (token in the fragment, then removed from the URL).
- Joining: nickname 1-16 chars, case-insensitive duplicates refused while the owner is connected; a nickname whose owner is disconnected (or left) can be taken back by typing it again (new token, old one dies, score kept). Max 30 players. Join attempts rate-limited per non-loopback IP. Lobby sweeps players who never came back. One game at a time, in memory only; idle games end after 3 h.
- Host UI: the question and its reveal are ONE screen (`roundScreen`), so the answer lights up in place; screens are keyed by `screenName(m)`. Host keys: P pause/resume, S skip, Enter next. Controls stay reachable via a sticky bottom bar. Sound only through `FX.sound` (off by default): tick in the last 5 s, pop on reveal, thud/big on the podium. Phone: tap locks an answer, refresh keeps it; dimming uses `FX.anim(opacity)` because the entrance animation leaves an inline opacity that a CSS class cannot beat. Answer colours `--opt-1..4` are defined on `body` (NOT `:root`) so option 4 takes the exam accent; yellow stays "correct", red "wrong" (the time bar does turn red in the last 5 s, flagged to the user as a choice).
- Small shared changes made for it: `FX.count` takes `from`; `FX.sound('tick')`; new Lucide icons (users, smartphone, wifi, wifi-off, pause, skip-forward, log-out, radio, external-link, arrow-up, arrow-down, lock); pressed `.toggle .box` now has a light fill in both themes (tick was invisible in dark mode).

**Verified:** engine 17/17, HTTP test 2/2 (15 phones, 22 forbidden paths all 404, no payload leak, rejoin, kick, late join refused, play port closes when the game ends); QR decoded with jsQR from a screenshot to the exact join URL; browser pass with 6 phone contexts at 390 px and one at 375x667, host at 1280 and 1920x1080, light and dark, both exams, reduced motion, refresh of host and phones mid-round, pause/resume, skip, kick, leave, late joiner, Play again; console clean. Screenshots: `docs/screenshots/j1-j13` (step 1) and `k1-k22` (step 2).

**Verified in step 3:** engine 21/21, HTTP 6/6. Browser (Playwright, 390 px phone contexts, host 1280 px, spare ports 3747/3748, `LIVE_LAN=loopback`): a phone gone for 12 s in the lobby stays as "away" and takes its seat back; duplicate nickname refused (case and spaces); host closes the tab mid-question and returns (phones show the pill, the reveal waits, the pill clears); kick in the leaderboard phase; pause freezes the clock on phones, skip; server killed and restarted mid-game (phone pill, host pill, host lands on setup with a notice, old-token phone gets "type its new code"); the 20 s "Cannot reach the game" message; long-poll fallback with `LIVE_SSE=off` (a full round); busy play port message in the setup screen; tunnel address (QR and address switch, bad addresses refused); 12 phones through 5 questions and Play again with 2 phones away. Screenshots `m2`-`m23` (Playwright's offline mode does not drop an open stream, so the first attempt proved nothing and was replaced by closing the tab).

**Known gaps / not tested:** the round screens and everything in step 3 on a **real phone**; iOS Safari and Android Chrome behaviour when the screen locks (simulated by closing and reopening the tab, which exercises the server side but not the browser's own freeze/thaw of EventSource and timers); a **real tunnel** (cloudflared was not installed or run; the fallback was tested with `LIVE_SSE=off`); the Windows Mobile hotspot address (192.168.137.1 is from Windows' documented default, untested here); real firewall behaviour (all tests ran on loopback); real audio and the confetti/stamp motion as a person sees it (screenshots only catch end states); very long games. The host board screen is a snapshot of the last reveal: a player kicked while it is showing stays on it until the next screen. Ideas not built: a host-side toggle for "end the round when everyone answered" (engine option `autoEnd` exists, default on); a kick button during a game (only in the lobby); a real ban (a kicked player can type their nickname again in the lobby).

**Testing tips (Playwright MCP):** simulate a locked phone by closing its page and opening a new page in the same context (localStorage keeps the token); `context.setOffline(true)` does NOT drop an already open event stream. The host's page is the context that has a `:3747` URL (contexts()[0] also holds an about:blank page, so use `pages().find(...)`). Start/stop your own test server with PowerShell `Start-Process node server.js -PassThru` and stop it by that PID only after checking it owns the port. `browser_run_code_unsafe` runs in the Playwright server; globals do NOT persist between calls, but `page.context().browser().contexts()` lists the contexts, so find phone pages by URL (`:3748`). New phone contexts: `browser.newContext({ viewport: {width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 })`. The host page remembers the theme in localStorage, so it may start dark. The simulated right answer can be looked up from `/api/exams/<id>` by matching the question text. Remember `LIVE_LAN=loopback` so no Windows Firewall prompt appears, and stop only your own test server.
