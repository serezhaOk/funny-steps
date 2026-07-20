import './style.css';
import { Audio, Transport } from './audio';
import { Grid } from './grid';
import { COLS, NOTE_NAMES, SCALES, rateTable } from './scales';
import { SAMPLES } from './samples';

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const audio = new Audio();
const transport = new Transport(audio);
const grid = new Grid();

let rootPc = 9; // A
let scaleIdx = 0; // minor
let sampleIdx = 0; // kalimbox
let eraseMode = false;
let buffer: AudioBuffer | null = null;
let rates: number[] = [];
let uiStep = -1;

function updateRates(): void {
  rates = rateTable(rootPc, SCALES[scaleIdx], SAMPLES[sampleIdx].baseMidi);
}
updateRates();

// ------------------------------------------------------------------ boot ----
$('#boot-btn').addEventListener('click', async () => {
  const btn = $('#boot-btn');
  btn.textContent = 'LOADING…';
  try {
    await audio.start();
    buffer = await audio.load(SAMPLES[sampleIdx].file);
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
function onStep(step: number, time: number): void {
  if (buffer) {
    for (let c = 0; c < COLS; c++) {
      const v = grid.at(step, c);
      if (v > 0) audio.trigger(buffer, rates[c], v * 0.9, time);
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
  sampleIdx = (sampleIdx + 1) % SAMPLES.length;
  const el = $('#sample');
  el.classList.add('loading');
  refreshLabels();
  try {
    buffer = await audio.load(SAMPLES[sampleIdx].file);
    updateRates();
  } finally {
    el.classList.remove('loading');
  }
}

function refreshLabels(): void {
  $('#bpm').textContent = `${transport.bpm} BPM`;
  $('#root').textContent = NOTE_NAMES[rootPc];
  $('#scale').textContent = SCALES[scaleIdx].name.toUpperCase();
  $('#sample').textContent = SAMPLES[sampleIdx].label;
}
