// Live Quiz pieces shared by the big-screen host view and the phone page: time bar, answer blocks, animated
// leaderboard, podium, stamp. Built on the same object model and motion rules as the rest of the app (FX.obj, FX.anim,
// reduced motion respected). Text only ever goes in through textContent.
import { h } from './util.js';
import { icon } from './icons.js';
import { FX } from './fx.js';

const M = window.Motion;

export const fmt = (n) => Number(n).toLocaleString('en');
export const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const SCRIBBLE = '<svg class="scribble" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M2 11 C 22 3, 42 16, 64 8 S 104 14, 126 7 S 170 13, 198 6"/></svg>';

// ---------------------------------------------------------------- time bar
/** A bar that drains and a number of seconds. `set()` with each message from the server (it carries the exact time left). */
export function timeBar({ big = false, onSecond } = {}) {
  const fill = h('i', { class: 'tb-fill' });
  const num = h('span', { class: 'tb-num' }, '');
  const el = h('div', { class: `timebar${big ? ' big' : ''}`, role: 'timer', 'aria-label': 'Time left' }, h('div', { class: 'tb-track' }, fill), num);
  let at = 0, left0 = 0, limit = 1, paused = false, running = false, raf = 0, tmo = 0, lastSec = -1;
  const left = () => (paused || !running ? left0 : Math.max(0, left0 - (performance.now() - at)));
  const paint = () => {
    const l = left(), sec = Math.ceil(l / 1000);
    const f = FX.reduced() ? sec / (limit / 1000) : l / limit;           // reduced motion: the bar steps once a second
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, f))})`;
    if (sec !== lastSec) {
      lastSec = sec; num.textContent = String(sec);
      el.classList.toggle('low', l > 0 && sec <= 5);
      if (running && !paused && sec > 0 && sec <= 5) onSecond?.(sec);
    }
  };
  const loop = () => { raf = tmo = 0; paint(); if (running && !paused && left() > 0) { if (FX.reduced()) tmo = setTimeout(loop, 250); else raf = requestAnimationFrame(loop); } };
  const halt = () => { cancelAnimationFrame(raf); clearTimeout(tmo); raf = tmo = 0; };
  return {
    el,
    set({ remainingMs, limitMs, paused: p }) {
      halt(); at = performance.now(); left0 = remainingMs; limit = limitMs; paused = !!p; running = true;
      el.classList.toggle('paused', paused); loop();
    },
    stop(finalMs = 0) { halt(); running = false; left0 = finalMs; paint(); el.classList.remove('low'); },
  };
}

// ---------------------------------------------------------------- answer blocks
/** One answer block in the quiz's own style: number badge + text. Colour per position; yellow/red stay for right/wrong. */
export function optionBlock(pos, text, { type = 'mc', interactive = false } = {}) {
  const ink = h('span', { class: 'ink' }, text);
  const state = h('span', { class: 'state' });
  const count = h('span', { class: 'pc', hidden: true });
  const key = h('span', { class: 'key' }, type === 'tf' ? (pos ? 'F' : 'T') : String(pos + 1));
  const el = h(interactive ? 'button' : 'div', { class: 'opt lopt', type: interactive ? 'button' : null, style: { '--oc': `var(--opt-${(pos % 4) + 1})` } }, key, h('span', { class: 'txt' }, ink), count, state);
  const obj = FX.obj(el, { cls: 'o-opt', tilt: interactive ? 3 : 0, hover: interactive, z: 20 });
  return {
    el, obj, pos,
    lock() { obj.dataset.locked = '1'; },
    /** The answer this phone locked in: it stays coloured, the others fade. */
    picked() { el.classList.add('picked'); state.replaceChildren(icon('lock', 20)); },
    right() {
      obj.dataset.locked = '1'; el.classList.add('right'); state.replaceChildren(icon('check', 24));
      ink.style.animationDelay = '0.15s';
      setTimeout(() => { if (obj.isConnected) FX.anim(obj, { scale: [1, 1.04, 1] }, FX.spring.bouncy); }, 140);
    },
    wrong() { obj.dataset.locked = '1'; el.classList.add('wrong'); state.replaceChildren(icon('x', 24)); ink.insertAdjacentHTML('beforeend', SCRIBBLE); },
    // through the animation layer: the entrance animation leaves an inline opacity that a CSS class would not beat
    dim() { obj.dataset.locked = '1'; FX.anim(obj, { opacity: 0.55 }, { duration: 0.18 }); },
    /** Back to untouched (the answer could not be sent). */
    reset() { delete obj.dataset.locked; el.classList.remove('picked'); FX.anim(obj, { opacity: 1 }, { duration: 0.15 }); state.replaceChildren(); FX.anim(obj._p.lift, { x: 0, y: 0, z: 0 }, FX.spring.snappy); },
    setCount(n) { count.hidden = false; count.replaceChildren(icon('users', 14), ` ${n}`); },
  };
}

// ---------------------------------------------------------------- leaderboard with animated rank changes
/** Rows: [{ id, nick, score, gain, rank, delta, away, left }]. `delta` > 0 means the player moved up since the last board. */
export function boardList(rows, { meId, step = 64 } = {}) {
  const box = h('ol', { class: 'lb', style: { height: `${Math.max(1, rows.length) * step}px` } });
  const parts = rows.map((r) => {
    const score = h('span', { class: 'lb-score' }, fmt(r.score - r.gain));
    const gain = h('span', { class: 'lb-gain', hidden: true }, r.gain ? `+${fmt(r.gain)}` : '');
    const move = h('span', { class: `lb-move ${r.delta > 0 ? 'up' : 'down'}`, hidden: true }, r.delta ? [icon(r.delta > 0 ? 'arrow-up' : 'arrow-down', 14), String(Math.abs(r.delta))] : '');
    const li = h('li', {
      class: `lb-row hard${r.id === meId ? ' me' : ''}${r.rank === 1 ? ' first' : ''}${r.away || r.left ? ' gone' : ''}`,
      style: { top: `${(r.rank - 1) * step}px`, height: `${step - 12}px` },
    }, h('span', { class: 'lb-rank' }, String(r.rank)), h('span', { class: 'lb-nick' }, r.nick, r.id === meId ? h('span', { class: 'tag' }, 'you') : null), move, gain, score);
    box.append(li);
    return { r, li, score, gain, move };
  });
  /** Call once the list is on screen: rows start where they were and slide to where they are; scores count up. */
  const play = (base = FX.base()) => {
    parts.forEach(({ r, li, score, gain, move }, i) => {
      const prev = r.rank + r.delta;
      const reveal = () => { score.textContent = fmt(r.score); if (r.gain) gain.hidden = false; if (r.delta) move.hidden = false; };
      if (FX.reduced()) { reveal(); return; }
      const dy = Math.max(-1, Math.min(rows.length, prev - r.rank)) * step;
      M.animate(li, { opacity: 0, y: r.delta ? dy : -26 }, { duration: 0 });
      FX.anim(li, { opacity: 1, y: r.delta ? dy : 0 }, { ...FX.spring.deal, delay: base + i * 0.06 });
      const slide = base + 0.5 + rows.length * 0.06;
      if (r.delta) setTimeout(() => { if (li.isConnected) FX.anim(li, { y: 0 }, FX.spring.soft); }, slide * 1000);
      FX.count(score, r.score, { from: r.score - r.gain, duration: 0.85, delay: base + 0.35 + i * 0.06, fmt: (v) => fmt(Math.round(v)) });
      setTimeout(() => { if (!li.isConnected) return; reveal(); [gain, move].forEach((x) => { if (!x.hidden) FX.anim(x, { scale: [0.4, 1] }, FX.spring.bouncy); }); }, (slide + 0.25) * 1000);
    });
  };
  return { el: box, play };
}

// ---------------------------------------------------------------- podium
/** Top three on blocks of different heights (2nd, 1st, 3rd). `onWinner` runs when the winner's block has landed. */
export function podium(rows, { meId, compact = false } = {}) {
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const heights = compact ? { 1: 150, 2: 112, 3: 84 } : { 1: 250, 2: 190, 3: 140 };
  const colours = { 1: 'var(--yellow)', 2: 'var(--sky)', 3: 'var(--coral)' };
  const cols = order.map((r) => {
    const block = h('div', { class: 'pod-block hard', style: { height: `${heights[r.rank]}px`, background: colours[r.rank] } },
      h('span', { class: 'pod-rank' }, String(r.rank)), h('span', { class: 'pod-score' }, fmt(r.score)));
    const name = h('div', { class: 'pod-name' }, r.nick, r.id === meId ? h('span', { class: 'tag' }, 'you') : null);
    return { r, block, name, el: h('div', { class: `pod-col r${r.rank}` }, name, block) };
  });
  const el = h('div', { class: `podium${compact ? ' compact' : ''}`, style: { minHeight: `${heights[1] + 70}px` } }, cols.map((c) => c.el));
  const play = (onWinner) => {
    const seq = [...cols].sort((a, b) => b.r.rank - a.r.rank);   // third place first, winner last
    seq.forEach((c, i) => {
      if (FX.reduced()) { if (c.r.rank === 1) onWinner?.(c); return; }
      M.animate(c.block, { scaleY: 0 }, { duration: 0 }); M.animate(c.name, { opacity: 0, y: 14 }, { duration: 0 });
      c.block.style.transformOrigin = '50% 100%';
      const at = FX.base() + i * 0.55;
      FX.anim(c.block, { scaleY: 1 }, { ...FX.spring.bouncy, delay: at });
      FX.anim(c.name, { opacity: 1, y: 0 }, { ...FX.spring.soft, delay: at + 0.25 });
      if (c.r.rank === 1) setTimeout(() => { if (el.isConnected) onWinner?.(c); }, (at + 0.45) * 1000);
    });
  };
  return { el, play, cols };
}

// ---------------------------------------------------------------- stamp (drops, thuds, shadow snaps in), like the solo results
export function stamp(text) {
  const shadow = h('i', { class: 'stamp-shadow' });
  const label = h('div', { class: 'stamp' }, text);
  const wrap = h('div', { class: 'stamp-wrap' }, shadow, label);
  const play = (delay = 0) => {
    if (FX.reduced()) { M.animate(wrap, { opacity: 1, rotate: -7 }, { duration: 0 }); M.animate(shadow, { x: 5, y: 5 }, { duration: 0 }); return; }
    M.animate(wrap, { opacity: 0 }, { duration: 0 });
    setTimeout(() => {
      if (!wrap.isConnected) return;
      M.animate(wrap, { opacity: 0, y: -440, scale: 2.6, rotate: -26 }, { duration: 0 });
      FX.anim(wrap, { opacity: [0, 1], y: [-440, 0], scale: [2.6, 1], rotate: [-26, -7] }, { duration: 0.34, ease: [0.55, 0, 0.9, 0.6] }).then(() => {
        FX.sound('thud');
        FX.anim(wrap, { scale: [1, 0.9, 1.04, 1] }, { duration: 0.34, ease: 'easeOut' });
        FX.anim(shadow, { x: [0, 5], y: [0, 5] }, FX.spring.thud);
        const page = document.querySelector('main'); if (page) FX.anim(page, { x: [0, -3, 3, -2, 0], y: [0, 2, -2, 1, 0] }, { duration: 0.22 });
      }, () => {});
    }, delay * 1000);
  };
  return { el: wrap, play };
}
