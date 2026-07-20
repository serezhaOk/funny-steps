# FUNNY⚡STEPS

Mobile-first experimental step sequencer for the browser. Granular clouds,
sample chopping and morphing wavetable acid — pure Web Audio, no audio
frameworks.

## Tracks

- **CHOP** — sample chopper: the loaded sample is cut into 16 slices; each step
  picks a slice with pitch, decay, reverse and delay send.
- **GRAIN** — granular sampler: bursts of tiny grains (position / size /
  density / spray / pitch) read from anywhere in the sample. Time-stretch
  textures, Aphex-style smears.
- **WAVE** — morphing wavetable synth (sine → saw → square → gritty hybrid)
  through a resonant lowpass with filter envelope. The acid department.

## Sequencer

16 steps, lookahead scheduling ("A Tale of Two Clocks"), swing, and
Elektron-style **p-locks**: long-press a pad to lock any parameter value,
probability, or 2/3/4-hit retrig to that single step. Tap to toggle. 🎲 CHAOS
randomizes the current track.

## Samples

Each sample track can load an audio file or record from the microphone. A
procedurally synthesized break is loaded by default so the machine talks
immediately.

## Master FX

Bitcrusher + sample-rate reducer (custom AudioWorklet) and a dub delay with
filtered feedback. Patterns auto-save to localStorage.

## Dev

```sh
npm install
npm run dev      # dev server (add --host for phone on the same network)
npm run build    # typecheck + production build
CHROMIUM_PATH=/path/to/chromium node scripts/smoke.mjs   # headless smoke test
```

Audio starts only after the TAP TO START gesture (iOS autoplay policy).
