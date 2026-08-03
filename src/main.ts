import './style.css';
import { Audio, Transport } from './audio';
import { Grid } from './grid';
import { COLS, NOTE_NAMES, SCALES, columnMidi, rateTable } from './scales';
import { SAMPLES, type SampleDef } from './samples';
import { Synths, SYNTHS, type SynthId } from './synths';
import {
  consumeAuthError,
  currentSession,
  initAuth,
  onAuthChange,
  signInWithEmail,
  signInWithGoogle,
  signOut,
} from './auth';
import {
  createProject,
  deleteProject,
  listProjects,
  makeAutosave,
  randomName,
  renameProject,
  saveProject,
  type ProjectRow,
  type TrackSnapshot,
} from './projects';

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

// --------------------------------------------------------------- projects ---
let projectId: string | null = null;
const autosave = makeAutosave();

function snapshot(): {
  bpm: number;
  root_pc: number;
  scale: string;
  tracks: TrackSnapshot[];
} {
  return {
    bpm: transport.bpm,
    root_pc: rootPc,
    scale: SCALES[scaleIdx].name,
    tracks: tracks.map((t) => ({
      voiceIdx: t.voiceIdx,
      muted: t.muted,
      // two decimals is plenty for an intensity and keeps the row small
      cells: Array.from(t.grid.cells, (v) => Math.round(v * 100) / 100),
    })),
  };
}

/** Every edit while playing funnels through here. */
function touch(): void {
  if (!projectId) return;
  const id = projectId;
  autosave(() => saveProject(id, snapshot()));
}

function applyProject(p: ProjectRow): void {
  projectId = p.id;
  transport.bpm = p.bpm;
  rootPc = p.root_pc;
  const idx = SCALES.findIndex((sc) => sc.name === p.scale);
  scaleIdx = idx >= 0 ? idx : 0;
  p.tracks?.forEach((snap, i) => {
    const t = tracks[i];
    if (!t) return;
    t.voiceIdx = snap.voiceIdx ?? t.voiceIdx;
    t.muted = !!snap.muted;
    t.grid.clear();
    snap.cells?.forEach((v, c) => {
      if (v > 0) t.grid.cells[c] = v;
    });
  });
  activeTrack = 0;
  updateRates();
}

function resetProject(): void {
  projectId = null;
  transport.bpm = 120;
  rootPc = 9;
  scaleIdx = 0;
  tracks.forEach((t, i) => {
    t.grid.clear();
    t.muted = false;
    t.voiceIdx = VOICES.findIndex(
      (v) => v.kind === 'synth' && v.id === DEFAULT_VOICES[i]
    );
  });
  activeTrack = 0;
  updateRates();
}

// ---------------------------------------------------------------- landing ---
// Signing in is the front door. There is no separate "Enter" step: a session
// lands you straight in the library, and opening a project is the user
// gesture that unlocks audio (iOS won't start a context without one).
let audioReady = false;

async function ensureAudio(): Promise<void> {
  if (audioReady) return;
  await audio.start();
  await synths.init(audio.ctx, audio.output);
  buildMixerUI();
  wire();
  refreshLabels();
  transport.onStep = onStep;
  requestAnimationFrame(frame);
  audioReady = true;
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
}

// ------------------------------------------------------------ projects UI ---
let rows: ProjectRow[] = [];

async function showProjects(): Promise<void> {
  transport.stop();
  $('#app').hidden = true;
  $('#projects').hidden = false;
  closeMenus();
  renderProjects(); // show the empty state at once; rows fill in below
  try {
    rows = await listProjects();
  } catch {
    rows = [];
  }
  renderProjects();
}

function renderProjects(): void {
  const list = $('#p-list');
  list.innerHTML = '';
  list.classList.toggle('empty', rows.length === 0);
  $('#create-new').hidden = rows.length === 0;

  if (rows.length === 0) {
    const empty = document.createElement('button');
    empty.className = 'p-empty';
    empty.textContent = '+ Create first project';
    empty.addEventListener('click', () => openNewProject());
    list.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const card = document.createElement('button');
    card.className = 'p-card';
    card.innerHTML =
      '<span class="p-more"><span class="material-symbols-outlined">' +
      'more_vert</span></span><span class="p-name"></span>';
    card.querySelector<HTMLElement>('.p-name')!.textContent = row.name;
    card.addEventListener('click', () => openProject(row));
    card
      .querySelector<HTMLElement>('.p-more')!
      .addEventListener('click', (e) => {
        e.stopPropagation();
        openCardMenu(row, e as PointerEvent);
      });
    list.appendChild(card);
  }
}

/** One dot per track in the sequencer header; the active one is bright. */
function refreshTrackDots(): void {
  const dots = document.querySelectorAll<HTMLElement>('#view-toggle span');
  dots.forEach((d, i) => d.classList.toggle('on', i === activeTrack));
}

function closeMenus(): void {
  $('#p-menu').hidden = true;
  $('#p-account').hidden = true;
}

let menuRow: ProjectRow | null = null;

function openCardMenu(row: ProjectRow, e: PointerEvent): void {
  menuRow = row;
  const menu = $('#p-menu');
  menu.hidden = false;
  const x = Math.min(e.clientX, window.innerWidth - 184);
  const y = Math.min(e.clientY, window.innerHeight - 120);
  menu.style.left = `${Math.max(8, x - 140)}px`;
  menu.style.top = `${y + 8}px`;
}

async function openProject(row: ProjectRow): Promise<void> {
  await ensureAudio();
  applyProject(row);
  await enterSequencer();
}

async function openNewProject(): Promise<void> {
  await ensureAudio();
  resetProject();
  try {
    const created = await createProject({ ...snapshot(), name: randomName() });
    projectId = created.id;
    rows = [created, ...rows];
  } catch {
    /* offline: play now, the row appears on the next successful save */
  }
  await enterSequencer();
}

async function enterSequencer(): Promise<void> {
  $('#projects').hidden = true;
  $('#app').hidden = false;
  refreshLabels();
  refreshMixerUI();
  refreshTrackDots();
  transport.start();
}

function wireProjects(): void {
  // Test seams: the sandbox has no Supabase, so suites can open the library
  // without a real session and inject rows.
  (window as unknown as { __showProjects?: () => void }).__showProjects = () => {
    $('#landing').hidden = true;
    void showProjects();
  };
  (window as unknown as { __setRows?: (r: ProjectRow[]) => void }).__setRows = (
    r
  ) => {
    rows = r;
    renderProjects();
  };

  $('#create-new').addEventListener('click', () => openNewProject());

  $('#profile-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#p-account');
    const wasOpen = !menu.hidden;
    closeMenus();
    if (wasOpen) return;
    $('#p-account-email').textContent = currentSession()?.user.email ?? '';
    menu.hidden = false;
    menu.style.right = '20px';
    menu.style.left = 'auto';
    menu.style.top = '84px';
  });

  $('#p-account').addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act !== 'signout') return;
    await signOut();
    location.reload();
  });

  $('#p-menu').addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    const row = menuRow;
    closeMenus();
    if (!row || !act) return;
    if (act === 'rename') {
      const name = prompt('Project name', row.name)?.trim();
      if (!name || name === row.name) return;
      row.name = name;
      renderProjects();
      await renameProject(row.id, name).catch(() => {});
    } else if (act === 'delete') {
      if (!confirm(`Delete "${row.name}"?`)) return;
      rows = rows.filter((r) => r.id !== row.id);
      renderProjects();
      await deleteProject(row.id).catch(() => {});
    }
  });

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.p-menu') || t.closest('#profile-btn') || t.closest('.p-more'))
      return;
    closeMenus();
  });
}

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

// Browsers refuse to rasterise a canvas past a certain size, and they do it
// silently: on a wide retina display a full-window canvas at devicePixelRatio
// blew past ~18 megapixels and simply drew nothing, leaving the chrome
// visible and the grid blank. Cap the backing store instead.
const MAX_CANVAS_PIXELS = 8_000_000;
const MAX_CANVAS_SIDE = 4096;

function backingScale(w: number, h: number): number {
  const dpr = window.devicePixelRatio || 1;
  if (w <= 0 || h <= 0) return dpr;
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
  const bySide = MAX_CANVAS_SIDE / Math.max(w, h);
  return Math.max(1, Math.min(dpr, byArea, bySide));
}

function fitCanvas(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w !== cssW || h !== cssH) {
    cssW = w;
    cssH = h;
    const scale = backingScale(w, h);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
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
  // Schedule the next frame first: if drawing throws, the loop survives.
  requestAnimationFrame(frame);
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
}

// -------------------------------------------------------------- mixer UI ----
// Material Symbols, same family as the rest of the icons.
const MUTE_ICON =
  '<span class="material-symbols-outlined">volume_off</span>';

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
      touch();
    });

    slot.append(name, mute);
    host.appendChild(slot);
  }

  // Save tile: an account feature, so it opens the sheet while signed out.
  const save = document.createElement('button');
  save.id = 'save-tile';
  save.textContent = 'PROJECTS';
  save.addEventListener('click', async (e) => {
    e.stopPropagation();
    // Edits already autosave; this just flushes and returns to the library.
    if (projectId) await saveProject(projectId, snapshot()).catch(() => {});
    setMixer(false);
    await showProjects();
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
  refreshTrackDots();
}

// -------------------------------------------------------------------- auth ---
function setLandingMsg(text: string, error = false): void {
  const el = $('#landing-msg');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('error', error);
}

function wireLanding(): void {
  $('#google-btn').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('#google-btn');
    btn.disabled = true;
    try {
      await signInWithGoogle(); // redirects away on success
    } catch (err) {
      btn.disabled = false;
      setLandingMsg(err instanceof Error ? err.message : String(err), true);
    }
  });

  // "Continue with email" reveals the field; submitting mails a sign-in link.
  $('#email-btn').addEventListener('click', () => {
    $('#email-form').hidden = false;
    $<HTMLInputElement>('#email-input').focus();
  });

  $<HTMLFormElement>('#email-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('#email-input');
    const email = input.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setLandingMsg('Enter a valid email address.', true);
      return;
    }
    const send = $<HTMLButtonElement>('#email-send');
    send.disabled = true;
    setLandingMsg('Sending a sign-in link…');
    try {
      await signInWithEmail(email);
      setLandingMsg(`Check ${email} for your sign-in link.`);
    } catch (err) {
      setLandingMsg(err instanceof Error ? err.message : String(err), true);
    } finally {
      send.disabled = false;
    }
  });

  // A session means the library, not the sign-in form.
  onAuthChange((session) => {
    if (!session) return;
    setLandingMsg('');
    $('#landing').hidden = true;
    void showProjects();
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
    touch();
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
    touch();
  });
  bpm.addEventListener('pointerup', () => {
    if (!bmoved) {
      transport.bpm = transport.bpm >= 200 ? 60 : transport.bpm + 10;
      refreshLabels();
      touch();
    }
    bstart = 0;
  });

  $('#root').addEventListener('click', () => {
    rootPc = (rootPc + 1) % 12;
    updateRates();
    refreshLabels();
    touch();
  });
  $('#scale').addEventListener('click', () => {
    scaleIdx = (scaleIdx + 1) % SCALES.length;
    updateRates();
    refreshLabels();
    touch();
  });

  $('#erase').addEventListener('click', () => {
    eraseMode = !eraseMode;
    $('#erase').classList.toggle('active', eraseMode);
  });
  $('#rndm').addEventListener('click', () => {
    track().grid.random();
    touch();
  });
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
    touch();
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

// ------------------------------------------------------------------ start ---
wireLanding();
wireProjects();
// A provider that bounced us back with an error would otherwise just show
// the sign-in form again, with the reason buried in the URL.
const authError = consumeAuthError();
if (authError) setLandingMsg(authError, true);
initAuth().catch((err) => {
  const w = window as unknown as { __bootErr?: (m: unknown) => void };
  w.__bootErr?.(err instanceof Error ? err.message : err);
});
