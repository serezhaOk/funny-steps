# FUNNY⚡STEPS

A mobile-first note-matrix sequencer for the browser. Paint notes into a
**10 × 16** grid — 10 scale notes across, 16 steps down — and they loop,
pitch-mapped across your own samples. Pure Web Audio, no audio frameworks.

Live: https://serezhaok.github.io/funny-steps/

## How it works

- **Grid** — each column is a note of the current scale, each row is a step.
  The sequencer loops top→bottom; every filled cell in the current step plays.
- **Intensity / accents** — tap a cell for a bright **accent** (full velocity);
  its four neighbours get a soft, smaller **bleed** (half velocity). Bigger &
  brighter = louder.
- **ERASE** — toggles an eraser that clears a 2×2 block per touch.
- **RNDM** — scatters accents within the current key and tempo.
- **BPM** — drag left/right to scrub tempo (tap to bump).
- **Key** — tap the note to change root, tap the scale name to cycle
  minor / major / dorian / penta / phrygian.
- **Sample** — tap the centre label to cycle through the built-in set; each
  sample is pitch-shifted per column (`public/samples/`, loaded on demand).

## Dev

```sh
npm install
npm run dev      # add --host to reach it from a phone on the same network
npm run build    # typecheck + production build
CHROMIUM_PATH=/path/to/chromium node scripts/smoke.mjs   # headless smoke test
```

Deploys to GitHub Pages on every push to `main`
(`.github/workflows/deploy.yml`). Audio starts only after the TAP TO START
gesture (iOS autoplay policy).
