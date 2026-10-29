/* Demo director for the mockup (only runs with ?demo=...). It drives the page with synthetic pointer events
   (cursor path, hover, click, keys) so the interactions can be recorded hands-free.
   ?demo=reel plays one continuous tour across the pages: tilt, hover waves, correct + milestone, wrong, results stamp, exam switch. */
(function () {
  const params = new URLSearchParams(location.search);
  let name = params.get('demo');
  let stage = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem('mock-demo') || 'null');
    if (!name && saved) { name = saved.name; stage = saved.stage; }
  } catch { /* ignore */ }
  if (!name) return;

  const D = (window.Demo = {});
  const cur = { x: innerWidth * 0.55, y: innerHeight * 0.4, el: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mkEv = (type, x, y, bubbles) => new PointerEvent(type, { bubbles, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true, buttons: 0 });

  function point(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    if (cur.el !== el) {
      const oldFace = cur.el?.closest?.('.face'), newFace = el.closest?.('.face');
      if (oldFace !== newFace) {
        if (oldFace) { oldFace.dispatchEvent(mkEv('pointerleave', x, y, false)); oldFace.closest('.obj')?.dispatchEvent(mkEv('pointerleave', x, y, false)); }
        if (newFace) newFace.dispatchEvent(mkEv('pointerenter', x, y, false));
      }
      cur.el = el;
    }
    el.dispatchEvent(mkEv('pointermove', x, y, true));
    document.dispatchEvent(mkEv('pointermove', x, y, false));
  }
  D.move = (x, y, ms = 600) => new Promise((res) => {
    const x0 = cur.x, y0 = cur.y, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cur.x = x0 + (x - x0) * e; cur.y = y0 + (y - y0) * e; point(cur.x, cur.y);
      k < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  });
  const at = (el, fx = 0.5, fy = 0.5) => { const r = el.getBoundingClientRect(); return [r.left + r.width * fx, r.top + r.height * fy]; };
  D.hover = (el, fx = 0.5, fy = 0.5, ms = 600) => D.move(...at(el, fx, fy), ms);
  D.sweep = async (el, ms = 520) => { await D.hover(el, 0.12, 0.2, ms); await D.hover(el, 0.88, 0.8, ms); };
  D.click = async (el, ms = 600) => {
    await D.hover(el, 0.5, 0.5, ms);
    const [x, y] = at(el);
    document.dispatchEvent(mkEv('pointerdown', x, y, true));
    el.dispatchEvent(mkEv('pointerdown', x, y, true));
    await sleep(110);
    el.dispatchEvent(mkEv('pointerup', x, y, true));
    document.dispatchEvent(mkEv('pointerup', x, y, true));
    el.click();
  };
  D.key = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  D.sleep = sleep;
  D.fast = params.get('manual') === '1';   // manual: page already settled, start quickly
  const setStage = (s) => { try { sessionStorage.setItem('mock-demo', JSON.stringify({ name, stage: s })); } catch { /* ignore */ } };
  const done = () => { try { sessionStorage.removeItem('mock-demo'); } catch { /* ignore */ } document.title = 'DEMO DONE'; window.__demoDone = true; };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const page = /quiz\.html/.test(location.pathname) ? 'quiz' : /results\.html/.test(location.pathname) ? 'results' : 'exam';

  const scripts = {
    // exam page: tile tilt, hover waves
    async tilt() {
      await sleep(D.fast ? 300 : 2300);
      await D.sweep($('.hero'), 800);
      for (const t of $$('.stats .face')) await D.sweep(t, 480);
      for (const r of $$('.trow').slice(1, 6)) await D.hover(r, 0.3, 0.5, 380);
      await D.hover($('.mode'), 0.3, 0.3, 500);
      await D.sweep($('.mode'), 480);
      await sleep(500);
    },
    async correct() {
      await sleep(D.fast ? 300 : 1700);
      const Q = window.QUIZ;
      await D.hover(Q.optObj(0)._p.face, 0.5, 0.5, 500);
      await D.hover(Q.optObj(1)._p.face, 0.7, 0.4, 450);
      await D.click(Q.optObj(Q.correct())._p.face, 500);
      await sleep(1900);
      D.key('Enter');
      await sleep(1500);
      await D.click(Q.optObj(Q.correct())._p.face, 700);   // second correct: streak milestone
      await sleep(2300);
    },
    async wrong() {
      await sleep(D.fast ? 300 : 1700);
      const Q = window.QUIZ;
      const bad = (Q.correct() + 1) % 4;
      await D.hover(Q.optObj(2)._p.face, 0.5, 0.5, 500);
      await D.click(Q.optObj(bad)._p.face, 450);
      await sleep(2200);
    },
    async switch() {
      await sleep(D.fast ? 300 : 2000);
      const pill = $$('.switcher a')[1];
      await D.click(pill, 800);
      await sleep(3200);
    },
    async stamp() { await sleep(4200); },
    // one continuous tour across the pages
    async reel() {
      if (page === 'exam' && !stage) {
        await sleep(2300);
        await D.sweep($('.hero'), 700);
        for (const t of $$('.stats .face')) await D.sweep(t, 420);
        for (const r of $$('.trow').slice(1, 5)) await D.hover(r, 0.3, 0.5, 340);
        setStage('quiz');
        await D.click($('.mode'), 650);                       // wipe to the quiz
      } else if (page === 'quiz') {
        await sleep(1800);
        const Q = window.QUIZ;
        await D.hover(Q.optObj(1)._p.face, 0.7, 0.5, 500);
        await D.click(Q.optObj(Q.correct())._p.face, 450);    // correct: confetti, streak 4
        await sleep(1700);
        D.key('Enter');
        await sleep(1500);
        await D.click(Q.optObj(Q.correct())._p.face, 600);    // correct: streak 5 milestone, flames
        await sleep(2200);
        D.key('Enter');
        await sleep(1500);
        const bad = (Q.correct() + 1) % 4;
        await D.click(Q.optObj(bad)._p.face, 600);            // wrong: shake, strike, mascot sweats
        await sleep(2000);
        setStage('results');
        const r = window.QUIZ.card.getBoundingClientRect();
        window.FX.go('results.html' + window.MOCK.q(), { x: r.left + r.width / 2, y: r.top + 60, kind: 'results' });
      } else if (page === 'results') {
        await sleep(4300);                                    // number counts up, bars fill, stamp drops
        setStage('exam2');
        await D.click($('.textlink'), 700);
      } else if (page === 'exam' && stage === 'exam2') {
        await sleep(2000);
        const pill = $$('.switcher a').find((a) => a.getAttribute('aria-current') !== 'true');
        setStage('end');
        await D.click(pill, 800);                              // exam switch: circle wipe from the pill
      } else if (page === 'exam' && stage === 'end') {
        await sleep(3000);
        done();
        return;
      }
    },
  };

  D.run = async (n) => { try { await (scripts[n] || (async () => {}))(); } catch (e) { console.error('demo failed', e); } };
  if (params.get('manual') === '1') return;
  FX.ready(async () => {
    if (name === 'reel' && !stage && page === 'exam') setStage(null);
    try { await (scripts[name] || (async () => {}))(); } catch (e) { console.error('demo failed', e); }
    if (name !== 'reel') done();
  });
})();
