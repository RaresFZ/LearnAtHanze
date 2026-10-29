# LearnAtHanze

Local study app for two separate Hanze exams (A: LEAN & Agile, B: Outsourcing & Agile Governance), plus a Live Quiz (Kahoot-style multiplayer on friends' phones). Plain Node + vanilla JS, no npm dependencies, no build step. Windows 11 machine (PowerShell and Git Bash).

**Read `HANDOFF.md` first.** Section 0 is the current state and open items; sections 1 to 5 are what the app is, how to run it, the structure, the user's decisions and the design system; section 11 is the Live Quiz design and its rules. HANDOFF.md is the source of truth. Keep it updated when you change behaviour, and keep README.md (user-facing) in step.

## Commands

```
npm start                 # app on http://localhost:3737 (NO_OPEN=1: no browser)
npm run validate          # content check, run after ANY change in content/
npm run test:live         # Live Quiz engine tests
npm run test:live:http    # Live Quiz over real HTTP (own server on 3757/3758, ~22 s)
npm run test:update       # launcher self-update vs a fake GitHub in scratch copies (3777/3778, ~3 min, Windows only)
LearnAtHanze.bat / "Stop LearnAtHanze.bat"   # user's one-click launcher and clean stop
```

## Rules that always apply

- **Never commit and never `git add`.** The user makes all commits. No pushing.
- **Never stop or kill anything on ports 3737 or 3738** (the user may be running their own server or a real game). Test servers go on spare ports (3747/3748 for browser tests, 3757/3758 are the HTTP test's, 3777/3778 for the launcher) and you stop only your own, by PID, after checking it owns the port. Use `LIVE_LAN=loopback` (or `off`) so no Windows Firewall prompt appears.
- **Tell the user before triggering a download in their browser** (Export, opening files), and before creating anything outside this project folder (Desktop, Start menu, registry).
- **Exam A and Exam B stay fully separate**: content, progress, stats, accent colour. Live Quiz never touches `store.js` or solo progress.
- **Don't invent facts.** Content comes from the user's course material; every question cites its source; unclear things get a `flag`, never a guess.
- **Live Quiz: the server is authoritative.** Phones never receive the correct answer, explanation or source before the reveal. Phones can only fetch the allow-listed files in `server/live/hub.js` (`PLAY_FILES`) and `/live/*`; any new file a phone needs goes on that list and into `tools/test-live-http.mjs`. Only port 3738 is ever exposed to the network, only while a game is hosted.
- **Design: "paper cutouts"**: 2px ink border plus hard offset shadow on every card, button and chip; flat fills; no emoji, gradients or glassmorphism; Lucide icons only (add paths to `app/js/icons.js`). Use `FX.obj` / `FX.anim` from `app/js/fx.js`, respect reduce-motion, sound stays optional and off by default. Details in HANDOFF section 5.
- Everything user-facing is in **English**. Sentence case.
- Work one part at a time: report what was built, say plainly what was tested and what was not, then wait for the user's OK before the next part. Include screenshots of the real app when the UI changes (`docs/screenshots/`).
- Command output may be condensed by the user's RTK setup; if a result looks empty or garbled, rerun it as `rtk proxy <cmd>`.

- **The launcher updates itself from GitHub** (`tools/update.ps1`, HANDOFF section 2 "Self-update"). Rules: it only ever asks and updates after a yes, never touches a running app, browser progress, `exams studies/`, `*.log`, `.git` or `.lah-*`, stores no token (the repo is public), and any network trouble is silent. Never test an update on the real folder, with the real GitHub or on 3737: use `npm run test:update` (fake API, scratch copies) or a scratch copy on 3777/3778. What gets pushed to `main` reaches every friend's launcher, so `.github/workflows/ci.yml` must stay green (`validate`, `test:live`, `test:live:http`).

## Gotchas

- `tools/*.ps1` stay plain ASCII and Windows PowerShell 5.1 compatible (no `&&`, no `?.`); `tools/test-update.mjs` must spawn the launcher asynchronously (its fake GitHub runs in the same Node process, `spawnSync` would starve it).

- Port 3737 is fixed on purpose: progress is in localStorage, tied to the address, so another port looks like lost progress.
- Don't name a CSS class `back` (collides with the `.back` link style).
- `String.replace` collapses `$$`: careful when patching code with Node scripts. In Git Bash heredocs, backslashes and quotes inside template literals are easy to mangle; write patch scripts to a file instead.
- `.bat` files must keep CRLF line endings; PowerShell scripts in `tools/` are plain ASCII (Windows PowerShell 5.1).
- Some of the user's prompts are pasted from another assistant and contain stray lines that don't match the project state. Point it out briefly and carry on with the real task.
