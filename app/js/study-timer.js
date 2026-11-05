// The study timer widget: 25 minutes of focus, a 5 minute break, and the minutes studied today. The rules are in timer-data.js.
// The state lives in localStorage, so the timer keeps running while you go from page to page; each page that shows the widget catches up.
import { h } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';
import { loadProgress, recordStudy, dayKey } from './store.js';
import { start, settle, stop, remaining, mmss, hm, FOCUS_MIN, BREAK_MIN } from './timer-data.js';

const KEY = 'learnathanze:timer';
const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.endsAt && (s.mode === 'focus' || s.mode === 'break') ? s : null; } catch { return null; } };
const save = (s) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* ignore */ } };

/** The widget for one exam (the minutes are added to that exam's progress). Returns { el, destroy }. */
export function studyTimer(examId) {
  const clock = h('span', { class: 'timer-clock', role: 'timer' });
  const label = h('span', { class: 'lab' });
  const today = h('span', { class: 'timer-today' });
  const note = h('span', { class: 'timer-note', role: 'status' });
  const main = h('button', { class: 'btn yellow', type: 'button' });
  const face = h('div', { class: 'card timer-card' },
    h('div', { class: 'timer-left' }, icon('timer', 22), h('div', null, label, clock)),
    h('div', { class: 'timer-mid' }, today, note),
    h('div', { class: 'timer-right' }, FX.obj(main, { cls: 'o-btn' })));
  const el = FX.obj(face, { cls: 'o-tile', hover: false });
  let state = load(), tick = null, dead = false;

  const studiedToday = () => loadProgress(examId).study[dayKey()] || 0;
  const apply = (r, prev = state) => {
    const owner = prev?.examId || examId;                 // the minutes belong to the exam the session was started on
    state = r.state; if (state && prev?.examId) state.examId = prev.examId; save(state);
    if (r.credited) recordStudy(owner, r.credited);
    if (r.finished === 'focus') { note.textContent = `Focus session done: +${FOCUS_MIN} min. Take your ${BREAK_MIN} minute break.`; FX.sound('big'); }
    if (r.finished === 'break') { note.textContent = 'Break over. Ready for the next focus session?'; FX.sound('pop'); }
  };
  const paint = () => {
    if (dead) return;
    apply(settle(state, Date.now()));
    today.textContent = `Studied today: ${hm(studiedToday())}`;
    if (!state) {
      label.textContent = `${FOCUS_MIN} min focus, ${BREAK_MIN} min break`; clock.textContent = `${FOCUS_MIN}:00`;
      main.replaceChildren(icon('play', 18), 'Start focus');
    } else {
      const left = remaining(state, Date.now());
      label.textContent = state.mode === 'focus' ? 'Focus' : 'Break'; clock.textContent = mmss(left);
      main.replaceChildren(icon('x', 18), state.mode === 'focus' ? 'Stop' : 'Skip break');
      document.title = `${mmss(left)} ${state.mode === 'focus' ? 'focus' : 'break'} · LearnAtHanze`;
    }
    if (!state) document.title = 'LearnAtHanze';
  };
  main.addEventListener('click', () => {
    note.textContent = '';
    if (!state) { state = { ...start(Date.now()), examId }; save(state); } else apply(stop(state, Date.now()));
    paint();
  });
  paint();
  tick = setInterval(paint, 500);
  return { el, destroy() { dead = true; clearInterval(tick); document.title = 'LearnAtHanze'; } };
}
