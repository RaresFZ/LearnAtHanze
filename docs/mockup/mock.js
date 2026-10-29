// Shared bits for the three mockup screens: theme, exam accent, top bar, and sample data
// taken from the real content files (topic names, counts and notes are real; progress numbers are made up).
(function () {
  const params = new URLSearchParams(location.search);
  const exam = params.get('exam') === 'b' ? 'b' : 'a';
  const theme = params.get('theme') || (() => { try { return localStorage.getItem('mock-theme'); } catch { return null; } })();
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
  document.addEventListener('DOMContentLoaded', () => { document.body.dataset.exam = exam; });

  const DATA = {
    a: {
      name: 'LEAN & Agile Project Management', short: 'LEAN & Agile',
      desc: 'Lean Six Sigma Green Belt (TPS, DMAIC, metrics, improvement tools) plus Scrum, ITIL, Kanban and DevOps.',
      format: 'Exam format not stated in the course files',
      practised: 62, total: 159, accuracy: 74, streak: 3, weak: 3,
      notes: [
        'Scrum lectures 2-4 are not in the folder, so Scrum roles, artifacts and events have no source material.',
        'The Lean "metrics 2026 v2" deck is unreadable and was skipped. Add a re-saved .pptx or PDF to include it.',
        'ITIL 4: the slides only list names and structure, with no explanations. Questions stay at that level.',
        'Obeya board: the slide has only a title, so no questions were written.',
        'Chapter 9 statistics comes from the syllabus only; no lecture slide covers it.',
        'The real exam format is not stated anywhere in the files.',
      ],
      topics: [
        ['Foundations & TPS', 17, 12], ['Lean principles & waste', 13, 8, 'The slide shows 7 wastes, the syllabus 8.'], ['Belts, DMAIC & charter', 20, 14],
        ['Define: VOC, CTQ & SIPOC', 10, 3], ['Process mapping & VSM', 8, 0], ['Measure: time, flow & capacity', 15, 9],
        ['Measure: defects & sigma', 11, 11], ['Analyze: root causes', 13, 5], ['Analyze: data & variation', 5, 0, 'Syllabus only; no lecture slide covers it.'],
        ['Improve: flow, pull & error-proofing', 9, 2], ['Improve: 5S, SMED & standard work', 10, 0], ['TPM, OEE & constraints', 8, 4],
        ['Control & Lean leadership', 6, 0], ['Agile & Scrum', 5, 2, 'Thin material: Scrum lectures 2-4 are missing.'], ['ITIL 4', 3, 0, 'Thin material: names only, no explanations.'],
        ['Kanban & DevOps', 6, 1, 'Obeya board has no usable content.'],
      ],
    },
    b: {
      name: 'Outsourcing & Agile Governance', short: 'Outsourcing & Governance',
      desc: 'IT governance and audit, innovation and IT strategy, outsourcing to IT providers, and scaling agile with SAFe and Scrum@Scale.',
      format: 'Multiple-choice theory exam',
      practised: 48, total: 150, accuracy: 68, streak: 2, weak: 2,
      notes: [
        'Outsourcing I refers to a book excerpt on Blackboard that is not in the folder.',
        'Lecture 6 (Spaceship game) is a classroom simulation with rules only.',
        'The BCG matrix and Business Model Canvas slides are pictures with titles only.',
        'The lectures link to YouTube videos, whose content is not available.',
      ],
      topics: [
        ['Need for control: Enron & SOX', 7, 5, 'Lecture 1 only; the videos are not covered.'], ['IT frameworks & standards', 21, 12], ['IT audit', 10, 6], ['Writing the audit report', 12, 4],
        ['Disruptive technologies & IT strategy', 17, 3, 'BCG matrix and Business Model Canvas are pictures only.'], ['Outsourcing basics & choosing a provider', 23, 9, 'The book excerpt is missing from the folder.'],
        ['Managing the provider & contracts', 23, 14], ['Scaling agile: Spaceship game', 4, 0, 'Game rules only; no theory in the slides.'], ['SAFe', 21, 15], ['Scrum@Scale', 12, 5],
      ],
    },
  };

  const q = (s) => `?exam=${exam}${theme ? '&theme=' + theme : ''}${s || ''}`;
  window.MOCK = { exam, data: DATA[exam], DATA, q };

  FX.ready(() => {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    const link = (id, label, tiny) => {
      const a = document.createElement('a');
      a.href = `exam.html?exam=${id}${theme ? '&theme=' + theme : ''}`;
      a.className = id;
      a.dataset.obj = 'o-pill'; a.dataset.accent = FX.ACCENT[id]; a.dataset.kind = 'swap';
      a.setAttribute('aria-current', String(id === exam));
      a.innerHTML = `<span class="swatch ${id}"></span><span class="full">${label}</span><span class="tiny">${tiny}</span>`;
      return a;
    };
    bar.innerHTML = `
      <div class="topbar-inner">
        <a class="wordmark" href="exam.html${q()}"><span class="mark-sq"></span><span class="word">LearnAtHanze</span></a>
        <nav class="switcher" aria-label="Exam"></nav>
        <span class="spacer"></span>
        <div class="tools">
          <button class="icon-btn" id="fx-sound" data-obj="o-icon" type="button"></button>
          <button class="icon-btn" id="fx-motion" data-obj="o-icon" type="button"></button>
          <button class="icon-btn" id="fx-cursor" data-obj="o-icon" type="button"></button>
          <button class="icon-btn" id="theme" data-obj="o-icon" type="button"></button>
        </div>
      </div>`;
    bar.querySelector('.mark-sq').append(icon('graduation-cap', 15));
    bar.querySelector('.switcher').append(link('a', DATA.a.short, 'LEAN'), link('b', DATA.b.short, 'Outsourcing'));
    FX.upgrade(bar);

    const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    const paint = () => {
      const set = (id, ic, label, on) => { const b = document.getElementById(id); b.replaceChildren(icon(ic, 18)); b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); b.title = label; };
      set('fx-sound', FX.prefs.sound === 'on' ? 'volume-2' : 'volume-x', FX.prefs.sound === 'on' ? 'Sound on (click to mute)' : 'Sound off (click to turn on)', FX.prefs.sound === 'on');
      set('fx-motion', FX.reduced() ? 'zap-off' : 'zap', FX.reduced() ? 'Motion reduced (click for full motion)' : 'Full motion (click to reduce)', !FX.reduced());
      set('fx-cursor', 'mouse-pointer-2', FX.prefs.cursor === 'on' ? 'Marker cursor on' : 'Marker cursor off', FX.prefs.cursor === 'on');
      const t = document.getElementById('theme'); t.replaceChildren(icon(isDark() ? 'sun' : 'moon', 18)); t.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
    };
    document.getElementById('fx-sound').addEventListener('click', () => { FX.set('sound', FX.prefs.sound === 'on' ? 'off' : 'on'); FX.sound('pop'); paint(); });
    document.getElementById('fx-motion').addEventListener('click', () => { FX.set('reduce', FX.reduced() ? 'off' : 'on'); paint(); });
    document.getElementById('fx-cursor').addEventListener('click', () => { FX.set('cursor', FX.prefs.cursor === 'on' ? 'off' : 'on'); paint(); });
    document.getElementById('theme').addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('mock-theme', next); } catch { /* ignore */ }
      paint();
    });
    paint();

    // Easter egg: poking the logo sticker makes it spin.
    const sq = bar.querySelector('.mark-sq');
    sq.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      FX.sound('pop');
      FX.anim(sq, { rotate: [-4, 716] }, { type: 'spring', stiffness: 60, damping: 9 });
      const r = sq.getBoundingClientRect();
      FX.confetti(r.left + r.width / 2, r.top + r.height / 2, { count: 14 });
    });
  });
})();
