# Mockup: exam page, quiz, results (motion version)

Standalone and offline. Open `exam.html` in a browser (double-click works). Nothing here touches the real app.

- `exam.html`, `quiz.html`, `results.html`: the three screens.
- `fx.js` and `fx.css`: the motion layer (springs, tilt, confetti, wipe, mascot, sound, cursor).
- `vendor/motion.js`: Motion (MIT), the spring-physics library, bundled locally. `icons.js`: Lucide icons (ISC).
- `screens/`: still screenshots and the GIFs of the interactions.

## Things to try
- Hover and move over the hero, the stat tiles and the quiz tile: they tilt, the shadow shifts, a shine follows the cursor.
- In the quiz, press `1`-`4` to answer and `Enter` for next. Any key press finishes a running animation.
- Click an exam pill in the top bar to see the wipe.
- Click the logo square for the easter egg.

## URL options
| Option | Effect |
|---|---|
| `exam=a` or `exam=b` | which exam |
| `theme=light` or `theme=dark` | colour theme |
| `modes=all` | preview the future five-mode grid (exam page) |
| `fresh=1` | nothing practised yet (exam page) |
| `streak=2`, `n=5` | starting streak and question number (quiz) |
| `state=correct` or `state=wrong` | answer automatically (quiz) |
| `score=100` | change the result and the stamp (results) |
| `reduce=1`, `sound=on`, `cursor=off` | preset the top-bar toggles |
| `demo=reel` | on `exam.html`: plays a hands-free tour across all three screens |
