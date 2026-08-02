import './style.css';
import { Audio, Transport } from './audio';
import { Grid } from './grid';
import { COLS, NOTE_NAMES, SCALES, columnMidi, rateTable } from './scales';
import { SAMPLES, type SampleDef } from './samples';
import { Synths, SYNTHS, type SynthId } from './synths';
import {
  initAuth,
  isSignedIn,
  onAuthChange,
  signInWithEmail,
  signInWithGoogle,
} from './auth';

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const audio = new Audio();
const transport = new Transport(audio);
const synths = new Synths();

// The sound cycle: the generative synths first, then the sample pack.
type Voice =
  | { kind: 'sample'; def: SampleDef }
  | { kind: 'synth'; id: SynthId; label: string };
const VOICES: Voice[] = [
  ...SYNTHS.map((s): Voice => ({ kind: 'synth', id: s.id, label: s.label })),
  ...SAMPLES.map((def): Voice => ({ kind: 'sample', def })),
];
const voiceLabel = (v: Voice) => (v.kind === 'synth' ? v.label : v.def.label);

// ------------------------------------------------------------------ state ---
interface Track {
  grid: Grid;
  voiceIdx: number;
  buffer: AudioBuffer | null;
  rates: number[];
  muted: boolean;
}

export const TRACKS = 2;
// Tracks start on different voices so the mixer is useful straight away.
const DEFAULT_VOICES = ['reverie', 'machine'] as const;

const tracks: Track[] = DEFAULT_VOICES.map((id) => ({
  grid: new Grid(),
  voiceIdx: VOICES.findIndex((v) => v.kind === 'synth' && v.id === id),
  buffer: null,
  rates: [],
  muted: false,
}));

let rootPc = 9; // A
let scaleIdx = 0; // minor
let activeTrack = 0;
let eraseMode = false;
let midis: number[] = [];
let uiStep = -1;

// View state: 0 = one track full screen, 1 = the 2x2 mixer.
let mixer = false;
let viewAnim = 0;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const track = () => tracks[activeTrack];

function updateRates(): void {
  midis = Array.from({ length: COLS }, (_, c) =>
    columnMidi(c, rootPc, SCALES[scaleIdx])
  );
  for (const t of tracks) {
    const v = VOICES[t.voiceIdx];
    const base = v.kind === 'sample' ? v.def.baseMidi : undefined;
    t.rates = rateTable(rootPc, SCALES[scaleIdx], base);
  }
}
updateRates();

// ------------------------------------------------------------------ boot ----
$('#boot-btn').addEventListener('click', async () => {
  const btn = $('#boot-btn');
  btn.textContent = 'LOADING…';
  try {
    await audio.start();
    // Boot straight into the synths: no sample download to wait on.
    await synths.init(audio.ctx, audio.output);
    $('#boot').hidden = true;
    $('#app').hidden = false;
    buildMixerUI();
    wire();
    wireAuth();
    // Non-blocking: the machine plays while the session is restored.
    initAuth().catch(() => {});
    refreshLabels();
    transport.onStep = onStep;
    transport.start();
    requestAnimationFrame(frame);
    (window as unknown as { __dbg?: unknown }).__dbg = {
      tracks,
      transport,
      audio,
      grid: () => track().grid,
      activeTrack: () => activeTrack,
      mixer: () => mixer,
      filled: () => track().grid.cells.filter((v) => v > 0).length,
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
  const ticked = new Set<SynthId>();

  for (const t of tracks) {
    if (t.muted) continue;
    const voice = VOICES[t.voiceIdx];
    const synthing = voice.kind === 'synth' && synths.isReady;
    if (synthing && !ticked.has(voice.id)) {
      synths.tick(voice.id, step, transport.bpm);
      ticked.add(voice.id);
    }

    const lit: Array<[number, number]> = [];
    for (let c = 0; c < COLS; c++) {
      const v = t.grid.at(step, c);
      if (v <= 0) continue;
      if (v < 1 && Math.random() > 0.35 + 0.65 * v) continue;

      const vel = v * rnd(0.72, 0.98);
      if (synthing) {
        synths.trigger(voice.id, midis[c], vel, time);
      } else if (t.buffer) {
        const cents = rnd(-15, 15);
        const rate = t.rates[c] * Math.pow(2, cents / 1200);
        audio.trigger(t.buffer, rate, vel, time, rnd(0.1, 0.9));
      }
      lit.push([c, vel]);
    }
    // Bloom the dots exactly when their sound lands.
    const delay = Math.max(0, (time - audio.now) * 1000);
    window.setTimeout(() => {
      for (const [c, vel] of lit) t.grid.flash(step, c, vel);
    }, delay);
  }

  const delay = Math.max(0, (time - audio.now) * 1000);
  window.setTimeout(() => (uiStep = step), delay);
}

// ------------------------------------------------------------------ render ---
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

type Rect = [number, number, number, number];

const GAP = 10;
const SAVE_ROOM = 62; // bottom strip in the mixer for the save tile

/**
 * Where track i sits in the mixer. Two tracks stack vertically (taller slots
 * suit the 12x16 grid better); more than two fall back to a 2x2 board.
 */
function quadrant(i: number): Rect {
  const cols = TRACKS <= 2 ? 1 : 2;
  const rows = Math.ceil(TRACKS / cols);
  const w = (cssW - GAP * (cols + 1)) / cols;
  // Leave a strip at the bottom for the save tile.
  const h = (cssH - SAVE_ROOM - GAP * (rows + 1)) / rows;
  const x = GAP + (i % cols) * (w + GAP);
  const y = GAP + Math.floor(i / cols) * (h + GAP);
  return [x, y, w, h];
}

const fullRect = (): Rect => [0, 0, cssW, cssH];

const LABEL_ROOM = 40; // strip at the bottom of a slot for name + mute

/** Where the grid itself draws inside a slot — above the label strip. */
function slotGrid(i: number): Rect {
  const [x, y, w, h] = quadrant(i);
  return [x, y, w, Math.max(40, h - LABEL_ROOM)];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
  lerp(a[3], b[3], t),
];
const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

let lastFrame = 0;

function frame(now: number): void {
  const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 0.016;
  lastFrame = now;
  fitCanvas();

  // Animate between the full view and the mixer.
  const target = mixer ? 1 : 0;
  if (viewAnim !== target) {
    const speed = dt / 0.35;
    viewAnim =
      target > viewAnim
        ? Math.min(target, viewAnim + speed)
        : Math.max(target, viewAnim - speed);
    positionMixerUI();
  }
  const t = ease(viewAnim);

  ctx.clearRect(0, 0, cssW, cssH);

  // Slot outlines, fading in with the mixer.
  if (t > 0.01) {
    ctx.strokeStyle = `rgba(255,255,255,${0.18 * t})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < TRACKS; i++) {
      const [x, y, w, h] = quadrant(i);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }

  for (let i = 0; i < TRACKS; i++) {
    const isActive = i === activeTrack;
    const quad = slotGrid(i);
    // The active track flies between full screen and its slot; the others
    // live in their slots and fade in as the mixer opens.
    const rect = isActive ? lerpRect(fullRect(), quad, t) : quad;
    const alpha = isActive ? 1 : t;
    if (alpha <= 0.01) continue;
    const detail = isActive ? 1 - t * 0.5 : 0.4;
    tracks[i].grid.render(
      ctx,
      rect[0],
      rect[1],
      rect[2],
      rect[3],
      uiStep,
      dt,
      detail,
      tracks[i].muted ? alpha * 0.35 : alpha
    );
  }
  requestAnimationFrame(frame);
}

// -------------------------------------------------------------- mixer UI ----
// Monochrome speaker with a slash, to match the mockup.
const MUTE_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"
  stroke="none"/><path d="M16 9l5 6M21 9l-5 6"/></svg>`;

function buildMixerUI(): void {
  const host = $('#mixer-ui');
  host.innerHTML = '';
  for (let i = 0; i < TRACKS; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.track = String(i);

    const name = document.createElement('button');
    name.className = 'name';
    name.addEventListener('click', (e) => {
      e.stopPropagation();
      openTrack(i);
    });

    const mute = document.createElement('button');
    mute.className = 'mute';
    mute.innerHTML = MUTE_ICON;
    mute.addEventListener('click', (e) => {
      e.stopPropagation();
      tracks[i].muted = !tracks[i].muted;
      refreshMixerUI();
    });

    slot.append(name, mute);
    host.appendChild(slot);
  }

  // Save tile: an account feature, so it opens the sheet while signed out.
  const save = document.createElement('button');
  save.id = 'save-tile';
  save.textContent = 'SAVE PROJECT';
  save.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!requireAccount()) return;
    // Saving itself lands in the next pass.
    save.textContent = 'SAVED SOON…';
    window.setTimeout(() => (save.textContent = 'SAVE PROJECT'), 1200);
  });
  host.appendChild(save);

  positionMixerUI();
  refreshMixerUI();
}

function positionMixerUI(): void {
  const slots = document.querySelectorAll<HTMLElement>('.slot');
  slots.forEach((slot, i) => {
    const [x, y, w, h] = quadrant(i);
    slot.style.left = `${x + 8}px`;
    slot.style.top = `${y + h - 36}px`;
    slot.style.width = `${w - 16}px`;
  });
}

function refreshMixerUI(): void {
  const slots = document.querySelectorAll<HTMLElement>('.slot');
  slots.forEach((slot, i) => {
    const t = tracks[i];
    const name = slot.querySelector<HTMLElement>('.name')!;
    const mute = slot.querySelector<HTMLElement>('.mute')!;
    // Only label a track that actually holds a part.
    const has = t.grid.hasNotes;
    name.hidden = !has;
    mute.hidden = !has;
    name.textContent = voiceLabel(VOICES[t.voiceIdx]);
    mute.classList.toggle('on', t.muted);
  });
}

function setMixer(on: boolean): void {
  mixer = on;
  $('#app').classList.toggle('mixer', on);
  if (on) refreshMixerUI();
}

function openTrack(i: number): void {
  activeTrack = i;
  setMixer(false);
  refreshLabels();
}

// -------------------------------------------------------------------- auth ---
// Tempo, key and saving are account features: tapping them while signed out
// opens the sign-up sheet instead of changing anything.
function requireAccount(): boolean {
  if (isSignedIn()) return true;
  openAuth();
  return false;
}

function openAuth(): void {
  $('#auth').hidden = false;
  setAuthMsg('');
}

function closeAuth(): void {
  $('#auth').hidden = true;
}

function setAuthMsg(text: string, error = false): void {
  const el = $('#auth-msg');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('error', error);
}

function wireAuth(): void {
  $('#auth-close').addEventListener('click', closeAuth);
  $('.auth-scrim').addEventListener('click', closeAuth);

  $('#auth-google').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('#auth-google');
    btn.disabled = true;
    try {
      await signInWithGoogle(); // redirects away on success
    } catch (err) {
      setAuthMsg(err instanceof Error ? err.message : String(err), true);
    } finally {
      btn.disabled = false;
    }
  });

  $<HTMLFormElement>('#auth-email-form').addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();
      const input = $<HTMLInputElement>('#auth-email');
      const email = input.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setAuthMsg('Enter a valid email address.', true);
        return;
      }
      setAuthMsg('Sending a sign-in link…');
      try {
        await signInWithEmail(email);
        setAuthMsg(`Check ${email} for your sign-in link.`);
      } catch (err) {
        setAuthMsg(err instanceof Error ? err.message : String(err), true);
      }
    }
  );

  onAuthChange((s) => {
    if (s) closeAuth();
  });
}

// ------------------------------------------------------------------- input ---
function wire(): void {
  // paint / erase on the grid, or pick a track when the mixer is open
  let painting = false;
  const apply = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const g = track().grid;
    if (eraseMode) {
      const hit = g.hit(x, y);
      if (hit) g.erase(hit.r, hit.c);
    } else {
      const p = g.pos(x, y);
      if (p) g.brush(p.gx, p.gy);
    }
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (mixer) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (let i = 0; i < TRACKS; i++) {
        const [qx, qy, qw, qh] = quadrant(i);
        if (x >= qx && x <= qx + qw && y >= qy && y <= qy + qh) {
          openTrack(i);
          break;
        }
      }
      return;
    }
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    apply(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (painting && !mixer) apply(e);
  });
  const end = () => {
    painting = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  $('#view-toggle').addEventListener('click', () => setMixer(true));

  // BPM: horizontal drag to scrub, tap to bump.
  const bpm = $('#bpm');
  let bx = 0;
  let bstart = 0;
  let bmoved = false;
  bpm.addEventListener('pointerdown', (e) => {
    if (!requireAccount()) return;
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
    if (!requireAccount()) return;
    rootPc = (rootPc + 1) % 12;
    updateRates();
    refreshLabels();
  });
  $('#scale').addEventListener('click', () => {
    if (!requireAccount()) return;
    scaleIdx = (scaleIdx + 1) % SCALES.length;
    updateRates();
    refreshLabels();
  });

  $('#erase').addEventListener('click', () => {
    eraseMode = !eraseMode;
    $('#erase').classList.toggle('active', eraseMode);
  });
  $('#rndm').addEventListener('click', () => track().grid.random());
  $('#sample').addEventListener('click', cycleVoice);

  window.addEventListener('resize', positionMixerUI);
}

async function cycleVoice(): Promise<void> {
  const t = track();
  t.voiceIdx = (t.voiceIdx + 1) % VOICES.length;
  const el = $('#sample');
  el.classList.add('loading');
  refreshLabels();
  try {
    const v = VOICES[t.voiceIdx];
    if (v.kind === 'synth') {
      await synths.init(audio.ctx, audio.output);
    } else {
      t.buffer = await audio.load(v.def.file);
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
  $('#sample').textContent = voiceLabel(VOICES[track().voiceIdx]);
}
