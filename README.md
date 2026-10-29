# LearnAtHanze

A local study app for two separate Hanze exams. Everything runs on your own computer: no account, no server online, no installs.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer (check with `node --version`). Then, in this folder:

```
npm start
```

The app opens at **http://localhost:3737**. Stop it with `Ctrl+C`.

### One-click launcher (Windows)

Instead of typing `npm start`, double-click **`LearnAtHanze.bat`** (from any location). It starts the app in a hidden window, waits until it answers, and opens http://localhost:3737 in your default browser. If the app is already running it only opens the browser, so you never get a second copy or a port error.

- **Stop it** with **`Stop LearnAtHanze.bat`**. It asks the app to quit: a running live game is ended, the phone port (3738) is closed, then the app exits. If a live game is running it asks first (press **Y**; or run it with `-Force` to skip the question). It never force-kills anything.
- **Desktop shortcut with the icon:** run `powershell -ExecutionPolicy Bypass -File tools\make-shortcut.ps1` (add `-IncludeStop` for a second one that stops the app, or `-Folder "C:\path"` to put them somewhere other than the Desktop). Delete the `.lnk` files to remove them. If you move the project folder, run it again. The icon is `tools/icon/LearnAtHanze.ico` (source `tools/icon/icon.svg`; rebuild with `node tools/pack-ico.mjs`).
- The launcher only starts the app. The Live Quiz network listener still opens only when you create a game, never at launch.
- If something goes wrong a message box says what, and the app's output is in `LearnAtHanze.out.log` and `LearnAtHanze.err.log` in this folder.
- **Port 3737 busy with another program?** The launcher says so and changes nothing. Find it with `netstat -ano | findstr :3737`, then `tasklist /FI "PID eq <number>"`, close that program and launch again. Do not switch ports (your progress is stored per address). If you really must: set `PORT=4000` first (PowerShell: `$env:PORT=4000`), and note that your progress will look empty there; Export/Import brings it back.
- Needs Node.js 18+ on your PATH (the launcher tells you if it is missing). Closing the terminal window of a plain `npm start` also stops the app; the launcher has no window, hence the Stop script.

### Updates

The launcher keeps your copy up to date. Each time you start LearnAtHanze with it, it looks at GitHub (this takes about a second, and is skipped without any message when you are offline). If there is a newer version, a window says **"Update available. Update now?"**, with the version you have, the newest one and the list of what changed. **Yes** updates and then starts the app; **No** starts the app as it is (it asks again next time). It never updates without asking.

- **Your progress is safe.** It lives in your browser, which an update cannot reach. Your own course files in `exams studies/` and the `.log` files are never touched either.
- **An update never happens while the app is running.** The launcher then only tells you; use **Stop LearnAtHanze**, then start LearnAtHanze again.
- **If you edited files yourself** and the update would change the same file, it refuses and changes nothing: it tells you which file, and the app starts on your current version. To get the update anyway, copy your edited file somewhere safe, undo your edit (git clone: `git checkout -- <file>`; ZIP copy: download the newest ZIP and put the file back from it) and launch again. Edits to files the update does not change are kept.
- **Git clone** (the folder has a `.git` folder): the update is `git pull --ff-only` (needs git and the `main` branch). **ZIP copy** (you used "Download ZIP"): it downloads the newest ZIP and copies the files over; files that were removed on GitHub stay in your folder. It writes `.lah-install.json` to remember what it installed, which is how it tells your edits from its own files next time. The first time a ZIP copy updates, it cannot know which version you had, so it first saves the files it replaces in `.lah-backup/`. All of these `.lah-*` entries are scratch files, safe to delete, and ignored by git.
- **Copies from before the updater existed** cannot update themselves once: download the newest ZIP (or `git pull`) one time by hand. After that the launcher does it.
- **No update at all?** `LAH_NO_UPDATE=1` skips the check (PowerShell: `$env:LAH_NO_UPDATE=1` before starting). The check also does nothing when GitHub is not reachable or limits requests.
- **For the maintainer:** what you push to `main` on GitHub is what everyone is offered at their next launch. The checks in `.github/workflows/ci.yml` (content validation and the Live Quiz tests) run on every push, so look at them before you tell friends. `npm run test:update` tests the launcher itself against a fake GitHub in scratch copies.

> Your progress is saved in the browser and tied to this address. Always use `http://localhost:3737` (the port is fixed on purpose). If you change the port, your progress will look empty; you can bring it back with Export/Import.

## What is in it

Seven ways to study, for each exam: **Quiz** (by topic or a random mix, four question types), **Flashcards** (spaced repetition), **Weak spots** (aims the quiz and flashcards at what you keep missing), **Exam simulation** (timed and mixed, one score at the end), **Mini games** (match up, sort it, speed round, combo run), a **Progress** page and **Live Quiz** (a multiplayer game for your friends' phones, see below). Every question and card comes from your own course files and cites its source; nothing is made up.

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

## Live Quiz (play with friends on their phones)

A Kahoot-style game for one exam at a time. You host it on this computer's screen, friends join on their phones with a code, no account and nothing to install.

**How to host**

1. Start the app (`npm start`), open an exam and choose **Live Quiz**.
2. Pick topics (none = all), 5, 10 or 20 questions, and 10, 20 or 30 seconds per question. Optional: **I am playing too** (you get your own player screen in a new tab) and **Allow late joiners** (people who arrive after the start join at 0 points).
3. Click **Open the lobby**. The big screen shows the address, a QR code, a 5-digit code and the players as they join. Click **Start game** when everyone is in. Windows may ask once whether Node.js may use the network (see below).

**How friends join**

- On the same Wi-Fi as this computer, scan the QR code or type the address shown (it looks like `192.168.0.12:3738`), then type the code and a nickname (1 to 16 characters).
- Refreshing the page, a locked screen or a lost connection does not lose the seat: the phone reconnects by itself. If a phone ends up on the join screen, typing the same nickname takes the seat back, with its points. Two people cannot use the same nickname at once.
- Up to 30 players. After the game starts nobody new can join (unless you allowed late joiners).

**The rules**

- Only **multiple choice and true/false** questions from the exam you opened, never ones flagged "Check the source". Two exams are never mixed.
- A correct answer scores `500 + 500 x (time left / time limit)`, plus a streak bonus of 50 for each correct answer in a row before it (at most 250). A wrong or missing answer scores 0 and ends the streak.
- A question ends when everyone has answered or the time is up. Then the right answer, the explanation and the source light up on the big screen, and each phone sees its own result. After each question: a top-5 leaderboard with rank changes; after the last one, a podium. Ties are decided by less total time spent on correct answers.
- Host keys: **P** pause or resume, **S** skip to the answer, **Enter** go on. **Play again** keeps the players and the code and starts a fresh set of questions at 0 points.
- Phones only receive what they are allowed to see: the right answer and the explanation are not sent until the question is over. The game runs on the computer and is kept in memory only: if the app is stopped or restarted, the game is over. Sound is off by default; **reduce motion** works on phones too.

**What it does not touch**

- Your solo progress, streaks and flashcard schedules are never read or changed. A live game saves nothing about you.
- Only the phone page can be reached from the network, on its own port (**3738**), and only while a game is hosted. The rest of the app, your course files and your progress stay on `localhost:3737`, which only this computer can open. **Phones can join** (above the code) switches the network off at once; **End game** closes the port.

**If a phone can't connect** (the same help is in the lobby, under "Phones can't connect?"). Try in this order:

1. **Same Wi-Fi.** Not a guest network. If the page will not open, turn mobile data off on the phone for a moment.
2. **Windows Firewall.** The first time, Windows asks if Node.js may use the network: tick **Private networks** only and click Allow access. If you clicked Cancel (or ticked Public only), run PowerShell **as administrator** once:

   ```
   New-NetFirewallRule -DisplayName "LearnAtHanze live quiz" -Direction Inbound -Protocol TCP -LocalPort 3738 -Action Allow -Profile Private
   ```

   To remove that rule later:

   ```
   Remove-NetFirewallRule -DisplayName "LearnAtHanze live quiz"
   ```

   The rule opens only port 3738. It only applies when Windows has marked your Wi-Fi as **Private** (Settings, Network & internet, Wi-Fi, your network, Network profile type). **Public** networks block incoming connections. Switch a network to Private only if you trust it (your home Wi-Fi); for school or other shared Wi-Fi use step 3.
3. **Phone hotspot.** School Wi-Fi often blocks phone-to-laptop traffic ("client isolation"). Turn on the hotspot on one phone and connect this computer and the other phones to it. The address in the lobby updates by itself after the computer switches network.
4. **Windows Mobile hotspot.** Make this computer the hotspot (Settings, Network & internet, Mobile hotspot). The phones join its Wi-Fi. This computer is usually `192.168.137.1` there and shows up in the lobby as another address choice. It needs a connection to share and may not work with every adapter.
5. **Last resort: a tunnel you start by hand.** A tunnel gives the phone page an internet address through a free service. The app never starts one. For example, with `cloudflared` installed from Cloudflare: `cloudflared tunnel --url http://localhost:3738`. It prints an `https://...` address: paste it into the field in the lobby's help panel and the QR code and address switch to it. **Privacy:** everything the phones and this computer exchange (nicknames, questions, answers, scores) passes through the tunnel company's servers; anyone who gets the address can open the join page, so the 5-digit code is the only lock; only port 3738 is exposed, never 3737. Stop the tunnel (Ctrl+C in its window) when the game is over: switching **Phones can join** off does not cut a tunnel. Cloudflare's free quick tunnels do not carry live event streams, so the phone page switches to a slower long-polling mode after about 5 seconds by itself.

**Port busy?** Hosting says so if port 3738 is taken (for example by a second copy of the app). Close the other copy, or start with another play port: PowerShell `$env:PLAY_PORT=3748; npm start`. Tests: `npm run test:live` (engine) and `npm run test:live:http` (over real HTTP, 15 simulated phones; starts its own server on ports 3757 and 3758).

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
- The maintainer keeps screenshots of the app and the design mockup in `docs/` on their own machine; they are not part of the repository.

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
- [x] Live Quiz (multiplayer on phones): lobby, rounds, scoring, leaderboard, podium, reconnecting, network help

Tested in Chromium (desktop and a touch-emulated phone). Live Quiz was also tested with simulated phones and, in an earlier build, one real phone over Wi-Fi. Not tested: Firefox, Safari, iOS, screen readers. The app uses modern CSS (`:has()`, `@property`), so use a current browser.

## License

The code is released under the [MIT License](LICENSE): free to use, copy and change. This covers the code only. The course material the questions are based on belongs to its authors and to Hanze; the files in `content/*/sources/` are text extracted from it. Bundled third-party parts keep their own licenses: Motion and qrcode-generator (MIT, license files in `app/vendor/`), the Lucide icons (ISC, inlined in `app/js/icons.js`) and the fonts Bricolage Grotesque and Geist (SIL Open Font License).
