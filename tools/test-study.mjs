// Study helpers: the exam countdown, the study timer rules and the lesson quick checks. Run with: npm run test:learn
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { studyWindow, formatLeft, prioritize, pathTopics, SLEEP_HOURS, FOCUS_SHARE } from '../app/js/learn-data.js';
import { FOCUS_MIN, BREAK_MIN, start, settle, stop, remaining, mmss, hm } from '../app/js/timer-data.js';

const load = (exam, file) => JSON.parse(fs.readFileSync(new URL(`../content/${exam}/${file}`, import.meta.url), 'utf8'));
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();      // local time, so the tests do not depend on the time zone

test('countdown: no date, a date in the past, and the numbers for a real case', () => {
  assert.equal(studyWindow(local(2026, 11, 4, 10), undefined, 200), null);
  assert.deepEqual(studyWindow(local(2026, 11, 4, 10), local(2026, 11, 4, 9), 200), { over: true });
  // 10:00 today, exam at 09:00 tomorrow: 23 h, one night
  const w = studyWindow(local(2026, 11, 4, 10), local(2026, 11, 5, 9), 214);
  assert.equal(w.nights, 1);
  assert.equal(Math.round(w.hoursLeft), 23);
  assert.equal(w.focusMinutes, Math.round((23 - SLEEP_HOURS) * FOCUS_SHARE * 60));       // 675 minutes
  assert.equal(w.verdict, 'comfortable');
});

test('countdown: nights are the midnights in between, not 24-hour blocks', () => {
  assert.equal(studyWindow(local(2026, 11, 4, 7), local(2026, 11, 4, 14), 100).nights, 0, 'same day');
  assert.equal(studyWindow(local(2026, 11, 4, 23, 30), local(2026, 11, 5, 8), 100).nights, 1, 'late evening to the next morning');
  assert.equal(studyWindow(local(2026, 11, 4, 10), local(2026, 11, 6, 10), 100).nights, 2);
  assert.equal(studyWindow(local(2026, 11, 4, 10), local(2026, 11, 7, 10), 100).nights, 3);
});

test('countdown: the verdict follows the minutes the path still needs', () => {
  const now = local(2026, 11, 4, 8), exam = local(2026, 11, 4, 20);                       // 12 h, no night: 540 focused minutes
  assert.equal(studyWindow(now, exam, 0).verdict, 'done');
  assert.equal(studyWindow(now, exam, 300).verdict, 'comfortable');                       // 1.8x
  assert.equal(studyWindow(now, exam, 450).verdict, 'enough');                            // 1.2x
  assert.equal(studyWindow(now, exam, 700).verdict, 'tight');                             // 0.77x
  assert.equal(studyWindow(now, exam, 1200).verdict, 'short');                            // 0.45x
  const night = studyWindow(local(2026, 11, 4, 22), local(2026, 11, 5, 6), 100);           // 8 h, one night: nothing left to study
  assert.equal(night.focusMinutes, 0);
  assert.equal(night.verdict, 'short');
});

test('countdown: the time left reads well', () => {
  assert.equal(formatLeft(26 * 3600000 + 5 * 60000), '1 d 2 h');
  assert.equal(formatLeft(24 * 3600000), '1 d');
  assert.equal(formatLeft(5 * 3600000 + 20 * 60000), '5 h 20 min');
  assert.equal(formatLeft(3 * 3600000), '3 h');
  assert.equal(formatLeft(40 * 60000), '40 min');
  assert.equal(formatLeft(-5), '0 min');
});

test('short on time: the topics marked as often missed come first, done topics are left out', () => {
  const topics = load('lean-agile', 'topics.json'), lessons = load('lean-agile', 'lessons.json');
  const path = pathTopics(topics, lessons);
  const done = new Set(['foundations']);
  const order = prioritize(path, lessons, (id) => ({ state: done.has(id) ? 'done' : 'todo' }));
  assert.ok(!order.some((t) => t.id === 'foundations'));
  assert.equal(order.length, path.length - 1);
  const often = (t) => lessons.topics[t.id].chunks.some((c) => c.often);
  const firstPlain = order.findIndex((t) => !often(t));
  assert.ok(order.slice(0, firstPlain).every(often) && order.slice(firstPlain).every((t) => !often(t)), 'flagged topics form the front of the list');
  assert.equal(order[0].id, 'governance', 'path order is kept inside each group');
});

test('timer: a focus session ends in a break, the break in nothing; what ended while away is credited', () => {
  const t0 = local(2026, 11, 4, 10);
  const s = start(t0);
  assert.equal(s.endsAt - s.startedAt, FOCUS_MIN * 60000);
  assert.deepEqual(settle(s, t0 + 10 * 60000), { state: s, credited: 0, finished: null });
  const end = settle(s, t0 + FOCUS_MIN * 60000);
  assert.equal(end.credited, FOCUS_MIN); assert.equal(end.finished, 'focus');
  assert.equal(end.state.mode, 'break'); assert.equal(end.state.endsAt - end.state.startedAt, BREAK_MIN * 60000);
  const away = settle(s, t0 + 2 * 3600000);                                                  // closed the tab for two hours
  assert.equal(away.credited, FOCUS_MIN); assert.equal(away.state, null, 'the break is long over too');
  const done = settle(end.state, end.state.endsAt + 1);
  assert.deepEqual(done, { state: null, credited: 0, finished: 'break' });
  assert.deepEqual(settle(null, t0), { state: null, credited: 0, finished: null });
});

test('timer: stopping credits the minutes that ran, only for focus and only from one minute', () => {
  const t0 = local(2026, 11, 4, 10);
  assert.deepEqual(stop(start(t0), t0 + 12.5 * 60000), { state: null, credited: 12.5 });
  assert.deepEqual(stop(start(t0), t0 + 30 * 1000), { state: null, credited: 0 });
  assert.deepEqual(stop(start(t0), t0 + 99 * 60000), { state: null, credited: FOCUS_MIN }, 'never more than the session');
  assert.deepEqual(stop(start(t0, 'break'), t0 + 3 * 60000), { state: null, credited: 0 });
  assert.deepEqual(stop(null, t0), { state: null, credited: 0 });
});

test('timer: clock text', () => {
  assert.equal(mmss(25 * 60000), '25:00');
  assert.equal(mmss(61 * 1000), '1:01');
  assert.equal(mmss(999), '0:01');
  assert.equal(mmss(0), '0:00');
  assert.equal(remaining(start(0), 5 * 60000), 20 * 60000);
  assert.equal(remaining(null, 5), 0);
  assert.equal(hm(135), '2 h 15 min'); assert.equal(hm(60), '1 h'); assert.equal(hm(7), '7 min');
});

for (const exam of ['lean-agile', 'outsourcing-governance']) {
  test(`${exam}: every quick check in the lessons is a real question of the same topic, used once, never on the last part`, () => {
    const lessons = load(exam, 'lessons.json'), qs = load(exam, 'questions.json');
    const byId = new Map(qs.map((q) => [q.id, q]));
    const seen = new Set();
    let n = 0;
    for (const [tid, l] of Object.entries(lessons.topics)) {
      l.chunks.forEach((c, k) => {
        if (!c.ask) return;
        n++;
        assert.ok(Array.isArray(c.ask) && c.ask.length === 1, `${tid} part ${k + 1}: ask is a list with one id`);
        const q = byId.get(c.ask[0]);
        assert.ok(q, `${c.ask[0]} exists`);
        assert.equal(q.topic, tid, `${q.id} belongs to ${tid}`);
        assert.notEqual(q.type, 'open', `${q.id} is not an open question`);
        assert.ok(!seen.has(q.id), `${q.id} is used twice`);
        seen.add(q.id);
        assert.ok(k < l.chunks.length - 1, `${tid}: the last part leads straight into the test`);
      });
    }
    assert.ok(n >= 30, `${n} quick checks`);
  });
}
