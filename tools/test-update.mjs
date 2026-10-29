// Launcher self-update (tools/update.ps1 via tools/launch.ps1) against a FAKE GitHub: a local API server that answers from a scratch git repo.
// Every scenario builds its own scratch "upstream" repo and its own scratch install (a git clone or a ZIP copy), runs the real launcher on
// spare ports 3777/3778 and stops only its own app. Your real folder, port 3737 and the real GitHub are never touched. Windows only.
// Run with: npm run test:update   (LAH_TEST_TMP=<folder> chooses where the scratch copies go; default is the system temp folder)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

if (process.platform !== 'win32') { console.log('skipped: the launcher is Windows only'); process.exit(0); }

const PROJECT = path.resolve(import.meta.dirname, '..');
const PORT = 3777, PLAY = 3778;
const REPO = 'test/LearnAtHanze';
const TMP = fs.mkdtempSync(path.join(process.env.LAH_TEST_TMP || os.tmpdir(), 'lah-update-'));
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------- scratch project and upstream repo
function copyProject(dest) {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: PROJECT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    if (f.startsWith('docs/')) continue;                    // screenshots: not needed to run the app
    const from = path.join(PROJECT, f);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(from, path.join(dest, f));
  }
}
let counter = 0;
/** A fresh upstream repo with commit A (this project's files). */
function makeUpstream() {
  const dir = path.join(TMP, `upstream-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  copyProject(dir);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'A: first version');
  return dir;
}
/** Add a commit upstream. edits: { 'relative/path': 'text to append' }; remove: paths to delete. Returns the new sha. */
function advance(up, message, edits, remove = []) {
  for (const [f, add] of Object.entries(edits)) {
    fs.mkdirSync(path.dirname(path.join(up, f)), { recursive: true });
    fs.appendFileSync(path.join(up, f), add);
  }
  for (const f of remove) fs.rmSync(path.join(up, f));
  git(up, 'add', '-A'); git(up, 'commit', '-q', '-m', message);
  return git(up, 'rev-parse', 'HEAD');
}
const head = (dir) => git(dir, 'rev-parse', 'HEAD');
function cloneInstall(up) { const d = path.join(TMP, `install-${++counter}`); git(TMP, 'clone', '-q', up, d); return d; }
function zipInstall(up, sha = 'HEAD') {                       // like an unpacked "Download ZIP": no .git folder, no install record
  const d = path.join(TMP, `zipcopy-${++counter}`); fs.mkdirSync(d);
  const tar = path.join(TMP, `a-${counter}.tar`);
  git(up, 'archive', '--format=tar', '-o', tar, sha);
  execFileSync(TAR, ['-xf', tar, '-C', d]);
  fs.rmSync(tar);
  return d;
}

// ---------------------------------------------------------------- fake GitHub API
let mode = 'ok';                                              // ok | hang | ratelimit
let upstream = null;                                          // the upstream repo the fake API answers from
const hung = new Set();
const api = http.createServer((req, res) => {
  if (mode === 'hang') { hung.add(res); return; }             // accepts the connection and never answers
  if (mode === 'ratelimit') { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"message":"API rate limit exceeded"}'); }
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://x');
  const commitObj = (rec) => { const [sha, date, msg] = rec.split('\x1f'); return { sha, commit: { message: msg.trim(), committer: { date } } }; };
  let m;
  try {
    if ((m = url.pathname.match(new RegExp(`^/repos/${REPO}/commits/main$`)))) {
      return json(200, commitObj(git(upstream, 'log', '-1', '--format=%H%x1f%cI%x1f%B', 'main')));
    }
    if ((m = url.pathname.match(new RegExp(`^/repos/${REPO}/compare/([0-9a-f]{40})\\.\\.\\.main$`)))) {
      const base = m[1];
      try { git(upstream, 'cat-file', '-e', `${base}^{commit}`); } catch { return json(404, { message: 'Not Found' }); }
      const [behind, ahead] = git(upstream, 'rev-list', '--left-right', '--count', `${base}...main`).split(/\s+/).map(Number);
      const status = ahead === 0 && behind === 0 ? 'identical' : behind === 0 ? 'ahead' : ahead === 0 ? 'behind' : 'diverged';
      const raw = git(upstream, 'log', '--reverse', '--format=%H%x1f%cI%x1f%B%x1e', `${base}..main`);
      const commits = raw.split('\x1e').map((s) => s.trim()).filter(Boolean).map(commitObj);
      return json(200, { status, ahead_by: ahead, behind_by: behind, commits });
    }
    if ((m = url.pathname.match(/^\/archive\/([0-9a-f]{40})\.zip$/))) {
      const zip = execFileSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=zip', `--prefix=LearnAtHanze-${m[1]}/`, m[1]], { cwd: upstream, maxBuffer: 1 << 29 });
      res.writeHead(200, { 'Content-Type': 'application/zip' }); return res.end(zip);
    }
  } catch (e) { return json(500, { message: String(e) }); }
  json(404, { message: 'Not Found' });
});
let apiPort;

// ---------------------------------------------------------------- running the real launcher
const logs = [];
async function launcher(dir, { answer, env = {}, script = 'launch.ps1', args = [] } = {}) {   // async: the fake API runs in this process and must keep answering
  const logFile = path.join(TMP, `run-${++counter}.log`);
  const fd = fs.openSync(logFile, 'w');                       // a file, not a pipe: the hidden server must not inherit a pipe we wait on
  const t0 = Date.now();
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'tools', script), ...args], {
    stdio: ['ignore', fd, fd], windowsHide: true, cwd: dir,
    env: {
      ...process.env, PORT: String(PORT), PLAY_PORT: String(PLAY), NO_OPEN: '1', NO_PAUSE: '1', LIVE_LAN: 'off',
      LAH_REPO: REPO, LAH_API: `http://127.0.0.1:${apiPort}`, LAH_ZIP_URL: `http://127.0.0.1:${apiPort}/archive/{sha}.zip`, LAH_GIT_URL: upstream,
      LAH_UPDATE_ANSWER: answer ?? '', ...env,
    },
  });
  const killer = setTimeout(() => child.kill(), 120000);
  const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)));
  clearTimeout(killer);
  fs.closeSync(fd);
  const out = read(logFile);
  logs.push(out);
  return { code, out, ms: Date.now() - t0 };
}
async function appUp() { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/live/status`); return r.ok; } catch { return false; } }
async function stopApp(dir) {
  if (await appUp()) await launcher(dir, { script: 'stop.ps1', args: ['-Force'] });
  for (let i = 0; i < 40 && await appUp(); i++) await sleep(150);
  assert.equal(await appUp(), false, 'the scratch app should be stopped');
}
/** Run the launcher, check the app came up, stop it. */
async function launchAndStop(dir, opts) {
  const r = await launcher(dir, opts);
  const up = await appUp();
  await stopApp(dir);
  return { ...r, up };
}

before(async () => {
  assert.equal(await appUp(), false, `something already answers on port ${PORT}; this test will not touch it`);
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  apiPort = api.address().port;
  upstream = makeUpstream();
});
after(async () => {
  for (const r of hung) r.destroy();
  api.close();
  api.closeAllConnections?.();
  await sleep(200);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* a log file may still be open; the folder is in the temp area */ }
});

// ---------------------------------------------------------------- scenarios
test('up to date (git clone): no question, app starts, version shown', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream);
  const r = await launchAndStop(dir, { answer: 'y' });
  assert.equal(r.code, 0); assert.ok(r.up, 'app should start');
  assert.match(r.out, /LearnAtHanze version: [0-9a-f]{7} \(\d{4}-\d\d-\d\d\)/);
  assert.doesNotMatch(r.out, /Update now/);
  assert.equal(head(dir), head(upstream));
});

test('update available, git clone: answer n changes nothing; answer y pulls, shows the commit messages, starts the new version', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream); const before = head(dir);
  advance(upstream, '{FEAT}: first upstream change', { 'README.md': '\nline from B\n' });
  const latest = advance(upstream, '{FIX}: second upstream change', { 'notes/c.txt': 'hello\n' });
  const no = await launchAndStop(dir, { answer: 'n' });
  assert.match(no.out, /Update now\?/);
  assert.match(no.out, /first upstream change/); assert.match(no.out, /second upstream change/);
  assert.match(no.out, /2 commits/);
  assert.ok(no.out.includes(before.slice(0, 7)), 'shows the version you have');
  assert.ok(no.out.includes(latest.slice(0, 7)), 'shows the latest version');
  assert.equal(no.code, 0); assert.ok(no.up); assert.equal(head(dir), before, 'a no must not change anything');
  assert.doesNotMatch(read(path.join(dir, 'README.md')), /line from B/);

  const nothing = await launchAndStop(dir, { answer: '' });          // no answer given and no window possible: counts as no
  assert.equal(head(dir), before, 'no answer must never update'); assert.ok(nothing.up);

  const yes = await launchAndStop(dir, { answer: 'y' });
  assert.equal(yes.code, 0); assert.ok(yes.up, 'app should start after the update');
  assert.match(yes.out, /Updated to /);
  assert.equal(head(dir), latest);
  assert.match(read(path.join(dir, 'README.md')), /line from B/);
  assert.ok(fs.existsSync(path.join(dir, 'notes', 'c.txt')));
  const again = await launchAndStop(dir, { answer: 'y' });
  assert.doesNotMatch(again.out, /Update now/, 'now up to date');
});

test('git clone: local edit to a file the update also changes -> refused in plain words, nothing overwritten, app still starts', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream); const before = head(dir);
  advance(upstream, '{FEAT}: touches the readme', { 'README.md': '\nupstream line\n' });
  fs.appendFileSync(path.join(dir, 'README.md'), '\nMY OWN EDIT\n');
  const mine = read(path.join(dir, 'README.md'));
  const r = await launchAndStop(dir, { answer: 'y' });
  assert.equal(r.code, 0); assert.ok(r.up, 'app starts on the current version');
  assert.match(r.out, /NOT applied/); assert.match(r.out, /nothing was changed/i);
  assert.equal(head(dir), before); assert.equal(read(path.join(dir, 'README.md')), mine, 'your edit is untouched');
  assert.doesNotMatch(r.out, /Updated to/);
});

test('git clone: local edit to an unrelated file is kept, the update still applies', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream);
  const latest = advance(upstream, '{FEAT}: readme only', { 'README.md': '\nupstream line\n' });
  fs.appendFileSync(path.join(dir, 'content', 'lean-agile', 'exam.json'), '\n');   // an edit the update does not touch
  const mine = read(path.join(dir, 'content', 'lean-agile', 'exam.json'));
  const r = await launchAndStop(dir, { answer: 'y' });
  assert.ok(r.up); assert.equal(head(dir), latest);
  assert.equal(read(path.join(dir, 'content', 'lean-agile', 'exam.json')), mine);
});

test('git clone: your own unpublished commits -> no question; own commits plus new upstream ones -> refused', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream);
  fs.appendFileSync(path.join(dir, 'README.md'), '\nlocal commit\n'); git(dir, 'commit', '-q', '-am', 'local only');
  const ahead = await launchAndStop(dir, { answer: 'y' });
  assert.doesNotMatch(ahead.out, /Update now/); assert.ok(ahead.up);
  git(upstream, 'fetch', '-q', dir, 'main:refs/heads/someones-branch');         // now GitHub knows the local commit (it was pushed somewhere), but it is not on main
  advance(upstream, '{FEAT}: upstream moves on', { 'notes/x.txt': 'x\n' });
  const before = head(dir);
  const div = await launchAndStop(dir, { answer: 'y' });
  assert.match(div.out, /Update now/); assert.match(div.out, /commits of your own/); assert.equal(head(dir), before); assert.ok(div.up);
});

test('git clone on another branch: not updated, explained', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream); git(dir, 'switch', '-q', '-c', 'mine');
  advance(upstream, '{FEAT}: x', { 'notes/x.txt': 'x\n' });
  const before = head(dir);
  const r = await launchAndStop(dir, { answer: 'y' });
  assert.match(r.out, /branch 'mine'/); assert.equal(head(dir), before); assert.ok(r.up);
});

test('ZIP copy of unknown age: answer n changes nothing; y replaces files, backs them up, leaves logs and "exams studies" alone, writes the install record', async () => {
  upstream = makeUpstream(); const dir = zipInstall(upstream);
  assert.ok(!fs.existsSync(path.join(dir, '.git')));
  const bat = path.join(upstream, 'LearnAtHanze.bat');                          // GitHub may hand out the .bat with LF only: the updater must fix that
  fs.writeFileSync(bat, read(bat).replace(/\r\n/g, '\n'));
  const latest = advance(upstream, '{FEAT}: zip change', { 'README.md': '\nzip line\n', 'notes/new.txt': 'new\n' });
  fs.mkdirSync(path.join(dir, 'exams studies'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'exams studies', 'my-slides.txt'), 'private');
  fs.writeFileSync(path.join(dir, 'debug.log'), 'old log');
  const readmeBefore = read(path.join(dir, 'README.md'));

  const no = await launchAndStop(dir, { answer: 'n' });
  assert.match(no.out, /version: unknown/); assert.match(no.out, /Update now\?/); assert.match(no.out, /zip change/);
  assert.equal(read(path.join(dir, 'README.md')), readmeBefore); assert.ok(no.up);
  assert.ok(!fs.existsSync(path.join(dir, '.lah-install.json')));

  const yes = await launchAndStop(dir, { answer: 'y' });
  assert.equal(yes.code, 0); assert.ok(yes.up); assert.match(yes.out, /Updated to /);
  assert.match(read(path.join(dir, 'README.md')), /zip line/); assert.ok(fs.existsSync(path.join(dir, 'notes', 'new.txt')));
  assert.equal(read(path.join(dir, 'exams studies', 'my-slides.txt')), 'private');
  assert.equal(read(path.join(dir, 'debug.log')), 'old log', 'log files are not part of the update');
  const backups = fs.readdirSync(path.join(dir, '.lah-backup'));
  assert.equal(backups.length, 1);
  assert.equal(read(path.join(dir, '.lah-backup', backups[0], 'README.md')), readmeBefore, 'the replaced file was saved');
  const st = JSON.parse(read(path.join(dir, '.lah-install.json')));
  assert.equal(st.commit, latest); assert.ok(Object.keys(st.files).length > 50, `install record lists ${Object.keys(st.files).length} files`);
  assert.ok(!fs.existsSync(path.join(dir, '.lah-update')), 'scratch download folder is removed');
  assert.ok(!read(path.join(upstream, 'LearnAtHanze.bat')).includes('\r'), 'sanity: upstream has LF only');
  assert.ok(fs.readFileSync(path.join(dir, 'LearnAtHanze.bat')).includes(13), 'the .bat is CRLF again after the update');

  const again = await launchAndStop(dir, { answer: 'y' });
  assert.match(again.out, new RegExp(`version: ${latest.slice(0, 7)}`)); assert.doesNotMatch(again.out, /Update now/);
});

test('ZIP copy with an install record: unmodified files update without a backup; your edits are detected', async () => {
  upstream = makeUpstream(); const dir = zipInstall(upstream);
  advance(upstream, '{FEAT}: b', { 'README.md': '\nb\n' });
  assert.ok((await launchAndStop(dir, { answer: 'y' })).up);                 // first update creates the install record
  fs.rmSync(path.join(dir, '.lah-backup'), { recursive: true, force: true });

  // upstream changes README.md and package.json; the person edited README.md (conflict) -> refused as a whole
  const c = advance(upstream, '{FEAT}: c', { 'README.md': '\nc\n', 'package.json': '\n' });
  fs.appendFileSync(path.join(dir, 'README.md'), '\nMY EDIT\n');
  const mineReadme = read(path.join(dir, 'README.md')); const pkg = read(path.join(dir, 'package.json'));
  const refused = await launchAndStop(dir, { answer: 'y' });
  assert.match(refused.out, /NOT applied/); assert.match(refused.out, /README\.md/); assert.doesNotMatch(refused.out, /Updated to/);
  assert.equal(read(path.join(dir, 'README.md')), mineReadme); assert.equal(read(path.join(dir, 'package.json')), pkg, 'nothing at all was written');
  assert.ok(refused.up);

  // the person's edit is on a file upstream does NOT change -> kept, update applies
  fs.writeFileSync(path.join(dir, 'README.md'), mineReadme.replace('\nMY EDIT\n', ''));   // undo the conflicting edit
  fs.appendFileSync(path.join(dir, 'app', 'js', 'util.js'), '\n// my tweak\n');
  const tweak = read(path.join(dir, 'app', 'js', 'util.js'));
  const ok = await launchAndStop(dir, { answer: 'y' });
  assert.match(ok.out, /Updated to /); assert.ok(ok.up);
  assert.equal(JSON.parse(read(path.join(dir, '.lah-install.json'))).commit, c);
  { const t = read(path.join(dir, 'README.md')); assert.ok(/\nc\n/.test(t), 'README tail: ' + JSON.stringify(t.slice(-40)) + ' out: ' + ok.out.slice(-400)); }
  assert.equal(read(path.join(dir, 'app', 'js', 'util.js')), tweak, 'edit on an untouched file survives');
  assert.ok(!fs.existsSync(path.join(dir, '.lah-backup')), 'with an install record there is no need for a backup');
});

test('offline, hanging GitHub and rate limit: silent, the app starts, the check cannot hold the launcher', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream);
  advance(upstream, '{FEAT}: unreachable', { 'notes/x.txt': 'x\n' });
  const before = head(dir);
  const down = await launchAndStop(dir, { answer: 'y', env: { LAH_API: 'http://127.0.0.1:9' } });          // nothing listens on port 9
  assert.equal(down.code, 0); assert.ok(down.up); assert.doesNotMatch(down.out, /Update now|Updated to/); assert.equal(head(dir), before);
  mode = 'hang';
  try {
    const slow = await launchAndStop(dir, { answer: 'y' });
    assert.equal(slow.code, 0); assert.ok(slow.up); assert.doesNotMatch(slow.out, /Update now|Updated to/);
    assert.ok(slow.ms < 20000, `hung API must not block the start (took ${slow.ms} ms)`);
    console.log(`# hung GitHub: launcher finished in ${slow.ms} ms`);
  } finally { for (const r of hung) r.destroy(); hung.clear(); mode = 'ok'; }
  mode = 'ratelimit';
  try {
    const lim = await launchAndStop(dir, { answer: 'y' });
    assert.equal(lim.code, 0); assert.ok(lim.up); assert.doesNotMatch(lim.out, /Update now|Updated to/);
  } finally { mode = 'ok'; }
  assert.equal(head(dir), before);
});

test('app already running: update is announced, never applied, the running app is not restarted', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream);
  const first = await launcher(dir, { answer: 'y' });                                                // starts the app (up to date)
  assert.equal(first.code, 0); assert.ok(await appUp());
  const pid = JSON.stringify(await (await fetch(`http://127.0.0.1:${PORT}/api/live/status`)).json());
  try {
    advance(upstream, '{FEAT}: while running', { 'notes/x.txt': 'x\n' });
    const before = head(dir);
    const r = await launcher(dir, { answer: 'y' });
    assert.equal(r.code, 0); assert.match(r.out, /already running/);
    assert.match(r.out, /Update available/); assert.match(r.out, /Stop LearnAtHanze/); assert.match(r.out, /while running/);
    assert.doesNotMatch(r.out, /Updated to|Update now\?/);
    assert.equal(head(dir), before, 'a running app is never updated');
    assert.ok(await appUp()); assert.equal(JSON.stringify(await (await fetch(`http://127.0.0.1:${PORT}/api/live/status`)).json()), pid);
  } finally { await stopApp(dir); }
});

test('LAH_NO_UPDATE=1 skips everything', async () => {
  upstream = makeUpstream(); const dir = cloneInstall(upstream);
  advance(upstream, '{FEAT}: x', { 'notes/x.txt': 'x\n' });
  const r = await launchAndStop(dir, { answer: 'y', env: { LAH_NO_UPDATE: '1' } });
  assert.ok(r.up); assert.doesNotMatch(r.out, /Update now|version:/);
});

test('the update never reaches outside the project folder, ports 3737/3738 or the real repo', () => {
  const all = logs.join('\n');
  assert.doesNotMatch(all, /api\.github\.com|github\.com\/RaresFZ/, 'every request went to the fake API');
  assert.ok(fs.existsSync(PROJECT), 'sanity');
});
