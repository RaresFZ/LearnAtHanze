// Motion layer. Everything is a physical object: a hard shadow plus a face that lifts above it.
// Springs come from Motion (vendor/motion.js, bundled). Only transform and opacity are animated
// (the hard shadow's offset moves through a CSS variable on a compositor layer).
// Reduced motion (OS setting or the top-bar toggle) makes every animation jump to its end state.
// Pressing any key finishes running animations.
const M = window.Motion;
const root = document.documentElement;
const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const store = {
  get(k, d) { try { return localStorage.getItem('learnathanze:' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('learnathanze:' + k, v); } catch { /* ignore */ } },
};
const qs = new URLSearchParams(location.search);
const mq = matchMedia('(prefers-reduced-motion: reduce)');

export const FX = {
  prefs: {
    reduce: qs.get('reduce') === '1' ? 'on' : store.get('reduce', 'auto'),
    sound: qs.get('sound') || store.get('sound', 'off'),
    cursor: qs.get('cursor') || store.get('cursor', 'off'),
  },
  spring: {
    snappy: { type: 'spring', stiffness: 520, damping: 30 },
    bouncy: { type: 'spring', stiffness: 380, damping: 17 },
    soft: { type: 'spring', stiffness: 200, damping: 22 },
    deal: { type: 'spring', stiffness: 240, damping: 19 },
    thud: { type: 'spring', stiffness: 650, damping: 13 },
    flip: { type: 'spring', stiffness: 230, damping: 25 },
  },
  busy: false,     // a page wipe is running
  wiping: false,   // true while the new screen is being built under the wipe
};

FX.reduced = () => FX.prefs.reduce === 'on' || (FX.prefs.reduce === 'auto' && mq.matches);
FX.syncReduce = () => { root.dataset.reduce = FX.reduced() ? '1' : '0'; };
FX.set = (k, v) => { FX.prefs[k] = v; store.set(k, v); FX.syncReduce(); document.dispatchEvent(new CustomEvent('fx:prefs')); };
mq.addEventListener?.('change', FX.syncReduce);
FX.syncReduce();

// ---------- animation wrapper: springs, tracking, skipping ----------
const active = new Set();
FX.anim = (target, kf, opts = {}) => {
  if (FX.reduced()) return M.animate(target, kf, { duration: 0 });
  const c = M.animate(target, kf, opts);
  active.add(c);
  const done = () => active.delete(c);
  c.then(done, done);
  return c;
};
FX.skip = () => { active.forEach((c) => { try { c.complete(); } catch { /* ignore */ } }); active.clear(); };
document.addEventListener('keydown', FX.skip, true);   // capture phase: runs before the page's own key handlers

// ---------- objects: obj > tilt (3D tilt, hard shadow) > lift (hover/press springs) > face ----------
FX.obj = (face, o = {}) => {
  const obj = mk('div', 'obj' + (o.cls ? ' ' + o.cls : '') + (o.fill ? ' fill' : ''));
  const tilt = mk('div', 'tilt'), shadow = mk('i', 'shadow'), lift = mk('div', 'lift');
  face.classList.add('face');
  lift.append(face); tilt.append(shadow, lift); obj.append(tilt);
  let shine = null;
  if (o.shine) { shine = mk('i', 'shine'); face.append(shine); face.classList.add('clip'); }
  obj._p = { tilt, shadow, lift, face, shine };
  obj.dataset.rot = o.rot || 0;
  if (o.hover !== false) {
    const z = o.z ?? 14;
    let hovering = false;
    const hov = () => FX.anim(lift, { x: -2, y: -2, z }, FX.spring.snappy);
    const rest = () => FX.anim(lift, { x: 0, y: 0, z: 0 }, FX.spring.snappy);
    const clicky = /btn|pill|icon|row|mode|tile/.test(o.cls || '');
    face.addEventListener('pointerenter', () => { if (obj.dataset.locked) return; hovering = true; hov(); });
    face.addEventListener('pointerleave', () => { hovering = false; if (!obj.dataset.locked) rest(); });
    face.addEventListener('pointerdown', () => { if (obj.dataset.locked) return; FX.anim(lift, { x: 4, y: 4, z: 0 }, FX.spring.snappy); if (clicky) FX.sound('click'); });
    const up = () => { if (obj.dataset.locked) return; hovering ? hov() : rest(); };
    face.addEventListener('pointerup', up);
    face.addEventListener('pointercancel', up);
  }
  if (o.tilt) attachTilt(obj, o);
  if (o.rot) M.animate(obj, { rotate: o.rot }, { duration: 0 });
  return obj;
};

function attachTilt(obj, o) {
  const { tilt, face, shine } = obj._p;
  const max = o.tilt, base = o.shadow ?? 4;
  const s = { rx: 0, ry: 0, vx: 0, vy: 0, tx: 0, ty: 0, raf: 0, last: 0 };
  const apply = () => {
    tilt.style.transform = `rotateX(${s.rx.toFixed(2)}deg) rotateY(${s.ry.toFixed(2)}deg)`;
    tilt.style.setProperty('--sx', (base - s.ry * 0.8).toFixed(2) + 'px');   // shadow shifts opposite to the tilt
    tilt.style.setProperty('--sy', (base + s.rx * 0.8).toFixed(2) + 'px');
  };
  const step = (t) => {
    const dt = Math.min(0.032, (t - s.last) / 1000 || 0.016); s.last = t;
    const k = 230, c = 2 * Math.sqrt(k) * 0.85;      // slightly underdamped spring toward the target angle
    s.vx += (k * (s.tx - s.rx) - c * s.vx) * dt; s.rx += s.vx * dt;
    s.vy += (k * (s.ty - s.ry) - c * s.vy) * dt; s.ry += s.vy * dt;
    apply();
    const still = Math.abs(s.vx) < 0.02 && Math.abs(s.vy) < 0.02 && Math.abs(s.tx - s.rx) < 0.02 && Math.abs(s.ty - s.ry) < 0.02;
    if (still && !s.tx && !s.ty) { s.rx = s.ry = 0; tilt.style.transform = ''; tilt.style.removeProperty('--sx'); tilt.style.removeProperty('--sy'); s.raf = 0; return; }
    s.raf = requestAnimationFrame(step);
  };
  const kick = () => { if (!s.raf) { s.last = performance.now(); s.raf = requestAnimationFrame(step); } };
  obj.addEventListener('pointermove', (e) => {
    if (FX.reduced() || obj.dataset.locked || e.pointerType === 'touch') return;     // tilt follows a mouse or pen, never a scrolling finger
    const r = face.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    s.ty = Math.max(-1, Math.min(1, px * 2)) * max;
    s.tx = -Math.max(-1, Math.min(1, py * 2)) * max;
    if (shine) { shine.style.transform = `translateX(${(px + 0.5) * r.width - r.width * 0.1}px) skewX(-18deg)`; obj.classList.add('hot'); }
    kick();
  });
  obj.addEventListener('pointerleave', () => { s.tx = 0; s.ty = 0; obj.classList.remove('hot'); kick(); });
}

/** Drop-in with a spring, staggered. */
FX.enter = (els, { y = -44, rotate = 0, delay = 0, stagger = 0.06, spring = FX.spring.bouncy } = {}) => {
  [...els].forEach((el, i) => {
    const r = +(el.dataset.rot || 0);
    M.animate(el, { opacity: 0, y, rotate: r + rotate }, { duration: 0 });
    FX.anim(el, { opacity: 1, y: 0, rotate: r }, { ...spring, delay: delay + i * stagger });
  });
};
/** Delay to use for entrances so they start as a wipe retracts. */
FX.base = () => (FX.wiping ? 0.3 : 0.05);

FX.count = (el, to, { duration = 0.9, delay = 0, from = 0, fmt = (v) => String(Math.round(v)) } = {}) => {
  if (FX.reduced()) { el.textContent = fmt(to); return; }
  el.textContent = fmt(from);
  const c = M.animate(from, to, { duration, delay, ease: [0.2, 0.7, 0.2, 1], onUpdate: (v) => { el.textContent = fmt(v); } });
  active.add(c); c.then(() => { active.delete(c); el.textContent = fmt(to); }, () => active.delete(c));
};

/** Segmented bars fill block by block (40ms apart). */
FX.fillSegs = (segs, { delay = 0, step = 0.04 } = {}) => {
  const n = +segs.dataset.filled;
  [...segs.children].forEach((b, i) => {
    if (i >= n) return;
    if (FX.reduced()) { b.classList.add('on'); return; }
    setTimeout(() => { b.classList.add('on'); FX.anim(b, { scale: [1.35, 1] }, FX.spring.bouncy); }, (delay + i * step) * 1000);
  });
};
FX.wave = (segs) => {
  if (FX.reduced()) return;
  [...segs.children].forEach((b, i) => M.animate(b, { y: [0, -7, 0] }, { duration: 0.32, delay: i * 0.025, ease: 'easeOut' }));
};

// ---------- confetti: small paper squares and stars (never awaited, never blocks anything) ----------
FX.confetti = (x, y, { count = 8, big = false, colors } = {}) => {
  if (FX.reduced()) return;
  const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ffd83d';
  const palette = colors || [accent, '#ffd83d', '#ff9f7a'];
  const layer = mk('div', 'confetti-layer');
  document.body.append(layer);
  const n = big ? Math.round(count * 2.2) : count;
  let finished = 0;
  for (let i = 0; i < n; i++) {
    const color = palette[i % palette.length];
    const size = 8 + Math.random() * (big ? 10 : 5);
    let p;
    if (i % 4 === 3) {
      p = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      p.setAttribute('viewBox', '0 0 20 20'); p.setAttribute('width', size * 1.7); p.setAttribute('height', size * 1.7);
      p.innerHTML = `<polygon points="10,1 12.6,7.2 19,7.8 14.2,12.2 15.6,18.6 10,15.2 4.4,18.6 5.8,12.2 1,7.8 7.4,7.2" fill="${color}" stroke="#141414" stroke-width="1.6" stroke-linejoin="round"/>`;
    } else {
      p = mk('i'); p.style.width = p.style.height = size + 'px'; p.style.background = color; p.style.border = '2px solid #141414'; p.style.borderRadius = '2px';
    }
    p.setAttribute('class', 'paper'); p.style.left = x + 'px'; p.style.top = y + 'px';
    layer.append(p);
    const ang = (-90 + (Math.random() - 0.5) * (big ? 150 : 110)) * Math.PI / 180;
    const speed = (big ? 380 : 220) + Math.random() * (big ? 360 : 160);
    const dx = Math.cos(ang) * speed, rise = Math.sin(ang) * speed * 0.62;
    const dur = (big ? 0.95 : 0.7) + Math.random() * 0.4;
    const c = M.animate(p, {
      x: [0, dx * 0.55, dx], y: [0, rise, rise + 300 + Math.random() * 100],
      rotate: [0, (Math.random() - 0.5) * 360, (Math.random() - 0.5) * 720], opacity: [1, 1, 0],
    }, { duration: dur, times: [0, 0.4, 1], ease: ['easeOut', 'easeIn'] });
    active.add(c);
    const fin = () => { active.delete(c); if (++finished === n) layer.remove(); };
    c.then(fin, fin);
  }
};

// ---------- sound (off by default, synthesized, no files) ----------
let actx;
FX.sound = (name) => {
  if (FX.prefs.sound !== 'on') return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const tone = (type, f0, f1, dur, gain, at = 0) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
      g.gain.setValueAtTime(gain, t + at); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(actx.destination); o.start(t + at); o.stop(t + at + dur + 0.02);
    };
    if (name === 'tick') tone('triangle', 1300, 950, 0.035, 0.06);
    if (name === 'click') tone('triangle', 900, 520, 0.045, 0.07);
    if (name === 'pop') { tone('sine', 420, 820, 0.1, 0.13); tone('sine', 620, 1200, 0.09, 0.07, 0.05); }
    if (name === 'thud') { tone('sine', 150, 42, 0.26, 0.3); tone('triangle', 90, 40, 0.18, 0.14); }
    if (name === 'big') { tone('sine', 520, 1040, 0.12, 0.12); tone('sine', 660, 1320, 0.14, 0.1, 0.07); tone('sine', 780, 1560, 0.18, 0.1, 0.14); }
  } catch { /* audio unavailable */ }
};

// ---------- custom cursor: a marker dot that grows on interactive things (off by default) ----------
FX.cursor = () => {
  if (!matchMedia('(pointer: fine)').matches) return;
  const wrap = mk('div', 'fx-cursor'), dot = mk('i');
  wrap.append(dot); document.body.append(wrap);
  const st = { x: -50, y: -50, cx: -50, cy: -50, raf: 0 };
  const loop = () => {
    st.cx += (st.x - st.cx) * 0.4; st.cy += (st.y - st.cy) * 0.4;
    wrap.style.transform = `translate3d(${st.cx}px,${st.cy}px,0)`;
    st.raf = Math.abs(st.x - st.cx) + Math.abs(st.y - st.cy) > 0.3 ? requestAnimationFrame(loop) : 0;
  };
  const sync = () => { const on = FX.prefs.cursor === 'on'; root.classList.toggle('fx-cursor-on', on); wrap.hidden = !on; };
  sync(); document.addEventListener('fx:prefs', sync);
  document.addEventListener('pointermove', (e) => {
    if (FX.prefs.cursor !== 'on') return;
    st.x = e.clientX; st.y = e.clientY; wrap.classList.add('seen');
    dot.classList.toggle('big', !!e.target.closest?.('a,button,summary,.obj,[role=button]'));
    if (!st.raf) st.raf = requestAnimationFrame(loop);
  }, { passive: true });
  document.addEventListener('pointerdown', () => dot.classList.add('down'));
  document.addEventListener('pointerup', () => dot.classList.remove('down'));
};

// ---------- wipe between screens: a circle of the accent colour (about 250ms each way, no text) ----------
FX.accent = () => getComputedStyle(document.body).getPropertyValue('--accent').trim();
FX.transition = async (fn, { x = innerWidth / 2, y = innerHeight / 2, color } = {}) => {
  if (FX.busy) return;
  FX.busy = true;
  if (FX.reduced()) { try { await fn(); } catch (e) { console.error(e); } FX.busy = false; return; }
  const col = color || FX.accent() || '#ffd83d';
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 20;
  const ov = mk('div', 'fx-wipe'); ov.style.background = col;
  const c0 = `circle(0px at ${x}px ${y}px)`, c1 = `circle(${R}px at ${x}px ${y}px)`;
  ov.style.clipPath = c0; root.append(ov);
  FX.wiping = true;
  try {
    await M.animate(ov, { clipPath: [c0, c1] }, { duration: 0.25, ease: [0.65, 0.05, 0.2, 1] });
    await fn();
  } catch (e) { console.error(e); }
  FX.wiping = false;
  try { await M.animate(ov, { clipPath: [c1, c0] }, { duration: 0.25, ease: [0.5, 0, 0.2, 1] }); } catch { /* ignore */ }
  ov.remove();
  FX.busy = false;
};
/** Navigate to a hash route under a wipe. Resolves once the new screen has rendered. */
FX.navigate = (href, o = {}) => {
  const same = location.hash === href || (href === '#/' && !location.hash);
  // Same address (for example "New quiz" after a quiz started from that address): redraw it instead of ignoring the click.
  if (same) return FX.transition(async () => { await FX.reroute?.(); }, o);
  return FX.transition(() => new Promise((res) => {
    const done = () => { window.removeEventListener('fx:routed', done); res(); };
    window.addEventListener('fx:routed', done);
    setTimeout(done, 1500);
    location.hash = href;
  }), o);
};
FX.links = () => document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || a.target) return;
  e.preventDefault();
  if (FX.busy) return;
  const r = a.getBoundingClientRect();
  FX.navigate(a.getAttribute('href'), { x: e.clientX || r.left + r.width / 2, y: e.clientY || r.top + r.height / 2, color: a.dataset.accent });
});

// ---------- parallax layers ----------
FX.parallax = (box, layers) => {
  if (FX.reduced()) return;
  const s = { x: 0, y: 0, tx: 0, ty: 0, raf: 0 };
  const loop = () => {
    s.x += (s.tx - s.x) * 0.08; s.y += (s.ty - s.y) * 0.08;
    layers.forEach((l) => { const d = +l.dataset.depth || 20; l.style.transform = `translate3d(${(-s.x * d).toFixed(2)}px,${(-s.y * d).toFixed(2)}px,0)`; });
    s.raf = Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y) > 0.002 ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!s.raf) s.raf = requestAnimationFrame(loop); };
  box.addEventListener('pointermove', (e) => { const r = box.getBoundingClientRect(); s.tx = (e.clientX - r.left) / r.width - 0.5; s.ty = (e.clientY - r.top) / r.height - 0.5; kick(); });
  box.addEventListener('pointerleave', () => { s.tx = 0; s.ty = 0; kick(); });
};

// ---------- mascot: a flat pencil that reacts ----------
FX.mascot = () => {
  const w = mk('div', 'mascot'); w.dataset.mood = 'idle';
  w.innerHTML = `<div class="m-wrap"><svg viewBox="0 0 90 132" aria-hidden="true">
    <rect x="22" y="14" width="46" height="14" rx="5" fill="#ff9f7a" stroke="currentColor" stroke-width="3"/>
    <rect x="22" y="28" width="46" height="10" fill="#8fdbff" stroke="currentColor" stroke-width="3"/>
    <rect x="22" y="38" width="46" height="56" fill="#ffd83d" stroke="currentColor" stroke-width="3"/>
    <path d="M22 94 L45 122 L68 94 Z" fill="#fffdf8" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
    <path d="M38 112 L45 122 L52 112 Z" fill="#141414"/>
    <g class="face-idle"><circle cx="36" cy="60" r="3.6" fill="#141414"/><circle cx="54" cy="60" r="3.6" fill="#141414"/>
      <path d="M37 72 Q45 79 53 72" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round"/></g>
    <g class="face-happy"><path d="M31 63 Q36 55 41 63" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round"/>
      <path d="M49 63 Q54 55 59 63" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round"/>
      <path d="M34 70 Q45 88 56 70 Z" fill="#141414" stroke="#141414" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="30" cy="72" r="4" fill="#ff9f7a"/><circle cx="60" cy="72" r="4" fill="#ff9f7a"/></g>
    <g class="face-sad"><circle cx="36" cy="62" r="3.6" fill="#141414"/><circle cx="54" cy="62" r="3.6" fill="#141414"/>
      <path d="M30 58 L41 52 M60 58 L49 52" stroke="#141414" stroke-width="3" stroke-linecap="round"/>
      <path d="M37 80 Q45 71 53 80" fill="none" stroke="#141414" stroke-width="3" stroke-linecap="round"/>
      <path d="M70 42 Q76 52 70 57 Q64 52 70 42Z" fill="#8fdbff" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></g>
  </svg></div>`;
  if (!FX.reduced()) M.animate(w.querySelector('.m-wrap'), { y: [0, -5, 0] }, { duration: 2.6, repeat: Infinity, ease: 'easeInOut' });
  let timer;
  w.mood = (m, hold = 1900) => {
    clearTimeout(timer); w.dataset.mood = m;
    if (m === 'happy') FX.anim(w, { y: [0, -24, 0], rotate: [0, -9, 7, 0] }, { duration: 0.55, ease: 'easeOut' });
    if (m === 'sad') FX.anim(w, { x: [0, -7, 7, -5, 5, 0], rotate: [0, 4, 0] }, { duration: 0.45 });
    if (hold && m !== 'idle') timer = setTimeout(() => { w.dataset.mood = 'idle'; }, hold);
  };
  return w;
};

FX.boot = () => { FX.syncReduce(); FX.cursor(); FX.links(); };
export default FX;
