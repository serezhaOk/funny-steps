import './style.css';
import { Audio, Transport } from './audio';
import { Grid } from './grid';
import { COLS, NOTE_NAMES, SCALES, columnMidi, rateTable } from './scales';
import { SAMPLES, type SampleDef } from './samples';
import { Dream } from './dream';

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const audio = new Audio();
const transport = new Transport(audio);
const grid = new Grid();
const dream = new Dream();

// The sound cycle: every sample plus the REVERIE dream-synth.
type Voice = { kind: 'sample'; def: SampleDef } | { kind: 'dream' };
const VOICES: Voice[] = [
  { kind: 'sample', def: SAMPLES[0] },
  { kind: 'dream' },
  ...SAMPLES.slice(1).map((def): Voice => ({ kind: 'sample', def })),
];
const voiceLabel = (v: Voice) => (v.kind === 'dream' ? 'REVERIE' : v.def.label);

let rootPc = 9; // A
let scaleIdx = 0; // minor
let voiceIdx = 0; // kalimbox
let eraseMode = false;
let buffer: AudioBuffer | null = null;
let rates: number[] = [];
let midis: number[] = [];
let uiStep = -1;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function updateRates(): void {
  const v = VOICES[voiceIdx];
  const base = v.kind === 'sample' ? v.def.baseMidi : undefined;
  rates = rateTable(rootPc, SCALES[scaleIdx], base);
  midis = Array.from({ length: COLS }, (_, c) =>
    columnMidi(c, rootPc, SCALES[scaleIdx])
  );
}
updateRates();

// ------------------------------------------------------------------ boot ----
$('#boot-btn').addEventListener('click', async () => {
  const btn = $('#boot-btn');
  btn.textContent = 'LOADING…';
  try {
    await audio.start();
    buffer = await audio.load(SAMPLES[0].file);
    $('#boot').hidden = true;
    $('#app').hidden = false;
    wire();
    refreshLabels();
    transport.onStep = onStep;
    transport.start();
    requestAnimationFrame(frame);
    (window as unknown as { __dbg?: unknown }).__dbg = {
      grid,
      transport,
      filled: () => grid.cells.filter((v) => v > 0).length,
      ctx: () => audio.ctx.state,
    };
  } catch (err) {
    btn.textContent = 'TAP TO START';
    const w = window as unknown as { __bootErr?: (m: unknown) => void };
    w.__bootErr?.(err instanceof Error ? `${err.name}: ${err.message}` : err);
  }
});

// -------------------------------------------------------------- sequencer ----
// Random within the frame: full accents always fire; soft bleed cells fire
// with a probability tied to their intensity, and every hit is humanized
// (random release 10–90%, micro-detune, velocity shimmer).
function onStep(step: number, time: number): void {
  const voice = VOICES[voiceIdx];
  const dreaming = voice.kind === 'dream' && dream.isReady;
  if (dreaming) dream.tick(step, transport.bpm);

  for (let c = 0; c < COLS; c++) {
    const v = grid.at(step, c);
    if (v <= 0) continue;
    if (v < 1 && Math.random() > 0.35 + 0.65 * v) continue;

    const vel = v * rnd(0.72, 0.98);
    if (dreaming) {
      dream.trigger(midis[c], vel, time);
    } else if (buffer) {
      const cents = rnd(-15, 15);
      const rate = rates[c] * Math.pow(2, cents / 1200);
      audio.trigger(buffer, rate, vel, time, rnd(0.1, 0.9));
    }
  }
  const delay = Math.max(0, (time - audio.now) * 1000);
  window.setTimeout(() => (uiStep = step), delay);
}

// ------------------------------------------------------------------ render ----
const canvas = $<HTMLCanvasElement>('#grid');
const ctx = canvas.getContext('2d')!;
let cssW = 0;
let cssH = 0;

function fitCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w !== cssW || h !== cssH) {
    cssW = w;
    cssH = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function frame(): void {
  fitCanvas();
  grid.render(ctx, cssW, cssH, uiStep);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------- input ---
function wire(): void {
  // paint / erase on the grid
  let painting = false;
  const apply = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (eraseMode) {
      const hit = grid.hit(x, y);
      if (hit) grid.erase(hit.r, hit.c);
    } else {
      const p = grid.pos(x, y);
      if (p) grid.brush(p.gx, p.gy);
    }
  };
  canvas.addEventListener('pointerdown', (e) => {
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    apply(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (painting) apply(e);
  });
  const end = () => {
    painting = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // BPM: horizontal drag to scrub, tap to bump.
  const bpm = $('#bpm');
  let bx = 0;
  let bstart = 0;
  let bmoved = false;
  bpm.addEventListener('pointerdown', (e) => {
    bx = (e as PointerEvent).clientX;
    bstart = transport.bpm;
    bmoved = false;
    bpm.setPointerCapture((e as PointerEvent).pointerId);
  });
  bpm.addEventListener('pointermove', (e) => {
    if (!bstart) return;
    const dx = (e as PointerEvent).clientX - bx;
    if (Math.abs(dx) > 3) bmoved = true;
    transport.bpm = Math.min(240, Math.max(40, Math.round(bstart + dx * 0.4)));
    refreshLabels();
  });
  bpm.addEventListener('pointerup', () => {
    if (!bmoved) {
      transport.bpm = transport.bpm >= 200 ? 60 : transport.bpm + 10;
      refreshLabels();
    }
    bstart = 0;
  });

  $('#root').addEventListener('click', () => {
    rootPc = (rootPc + 1) % 12;
    updateRates();
    refreshLabels();
  });
  $('#scale').addEventListener('click', () => {
    scaleIdx = (scaleIdx + 1) % SCALES.length;
    updateRates();
    refreshLabels();
  });

  $('#erase').addEventListener('click', () => {
    eraseMode = !eraseMode;
    $('#erase').classList.toggle('active', eraseMode);
  });
  $('#rndm').addEventListener('click', () => grid.random());
  $('#sample').addEventListener('click', cycleSample);
}

async function cycleSample(): Promise<void> {
  voiceIdx = (voiceIdx + 1) % VOICES.length;
  const el = $('#sample');
  el.classList.add('loading');
  refreshLabels();
  try {
    const v = VOICES[voiceIdx];
    if (v.kind === 'dream') {
      await dream.init(audio.ctx, audio.output);
    } else {
      buffer = await audio.load(v.def.file);
    }
    updateRates();
  } finally {
    el.classList.remove('loading');
  }
}

function refreshLabels(): void {
  $('#bpm').textContent = `${transport.bpm} BPM`;
  $('#root').textContent = NOTE_NAMES[rootPc];
  $('#scale').textContent = SCALES[scaleIdx].name.toUpperCase();
  $('#sample').textContent = voiceLabel(VOICES[voiceIdx]);
}
