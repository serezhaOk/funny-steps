import './style.css';
import {
  defaultPattern,
  loadPattern,
  savePattern,
  PARAM_DEFS,
  type Pattern,
  type TrackKind,
} from './state/pattern';
import { AudioEngine } from './audio/engine';
import { Sequencer } from './audio/sequencer';
import { makeDefaultBreak, decodeFile, MicRecorder } from './audio/sample';

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const TRACK_COLORS: Record<TrackKind, string> = {
  chop: 'var(--c-chop)',
  grain: 'var(--c-grain)',
  wave: 'var(--c-wave)',
};

const engine = new AudioEngine();
const pattern: Pattern = loadPattern() ?? defaultPattern();
let seq: Sequencer;
let curTrack = 0;
let editingStep: number | null = null;
const mic = new MicRecorder();

let saveTimer = 0;
function queueSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => savePattern(pattern), 400);
}

// ------------------------------------------------------------------ boot ----
$('#boot-btn').addEventListener('click', async () => {
  const btn = $('#boot-btn');
  btn.textContent = 'STARTING…';
  try {
    await engine.start();
    seq = new Sequencer(engine, pattern);
    const brk = makeDefaultBreak(engine.ctx);
    seq.chopper.setBuffer(brk);
    seq.granular.setBuffer(brk);
    seq.onStep = onStep;
    $('#boot').hidden = true;
    $('#app').hidden = false;
    renderAll();
    seq.start();
    $('.play-btn').classList.add('playing');
  } catch (err) {
    btn.textContent = 'TAP TO START';
    const w = window as unknown as { __bootErr?: (m: unknown) => void };
    w.__bootErr?.(err instanceof Error ? `${err.name}: ${err.message}` : err);
  }
});

// ------------------------------------------------------------- transport ----
$('#play').addEventListener('click', () => {
  if (seq.playing) {
    seq.stop();
    $('.play-btn').classList.remove('playing');
  } else {
    seq.start();
    $('.play-btn').classList.add('playing');
  }
});

const bpmInput = $<HTMLInputElement>('#bpm');
bpmInput.addEventListener('input', () => {
  pattern.bpm = Number(bpmInput.value);
  $('#bpm-val').textContent = bpmInput.value;
  queueSave();
});
const swingInput = $<HTMLInputElement>('#swing');
swingInput.addEventListener('input', () => {
  pattern.swing = Number(swingInput.value);
  $('#swing-val').textContent = Math.round(pattern.swing * 200) + '%';
  queueSave();
});

$('#chaos').addEventListener('click', () => {
  const t = pattern.tracks[curTrack];
  const defs = PARAM_DEFS[t.kind];
  for (const s of t.steps) {
    s.on = Math.random() < 0.4;
    s.retrig = Math.random() < 0.15 ? 2 + Math.floor(Math.random() * 3) : 1;
    s.plocks = {};
    if (s.on && Math.random() < 0.5) {
      const d = defs[Math.floor(Math.random() * defs.length)];
      let v = d.min + Math.random() * (d.max - d.min);
      if (d.step) v = Math.round(v / d.step) * d.step;
      s.plocks[d.id] = v;
    }
  }
  editingStep = null;
  renderGrid();
  renderParams();
  queueSave();
});

// ------------------------------------------------------------ track tabs ----
function renderTracks(): void {
  const nav = $('#tracks');
  nav.innerHTML = '';
  pattern.tracks.forEach((t, i) => {
    const b = document.createElement('button');
    b.textContent = t.name;
    if (i === curTrack) b.classList.add('active');
    b.addEventListener('click', () => {
      curTrack = i;
      editingStep = null;
      document
        .getElementById('app')!
        .style.setProperty('--accent', TRACK_COLORS[t.kind]);
      renderAll();
    });
    nav.appendChild(b);
  });
}

// ------------------------------------------------------------------ grid ----
const pads: HTMLButtonElement[] = [];

function renderGrid(): void {
  const grid = $('#grid');
  grid.innerHTML = '';
  pads.length = 0;
  const track = pattern.tracks[curTrack];
  track.steps.forEach((s, i) => {
    const pad = document.createElement('button');
    pad.className = 'pad';
    if (i % 4 === 0) pad.classList.add('beat');
    if (s.on) pad.classList.add('on');
    if (Object.keys(s.plocks).length || s.retrig > 1 || s.prob < 1)
      pad.classList.add('locked');
    if (i === editingStep) pad.classList.add('editing');

    let held = false;
    let timer = 0;
    pad.addEventListener('pointerdown', () => {
      held = false;
      timer = window.setTimeout(() => {
        held = true;
        editingStep = editingStep === i ? null : i;
        renderGrid();
        renderParams();
      }, 350);
    });
    pad.addEventListener('pointerup', () => {
      clearTimeout(timer);
      if (!held) {
        s.on = !s.on;
        pad.classList.toggle('on', s.on);
        queueSave();
      }
    });
    pad.addEventListener('pointerleave', () => clearTimeout(timer));

    grid.appendChild(pad);
    pads.push(pad);
  });
}

function onStep(step: number, time: number): void {
  const delay = Math.max(0, (time - engine.now) * 1000);
  setTimeout(() => {
    pads.forEach((p, i) => p.classList.toggle('playhead', i === step));
    drawWave(step);
  }, delay);
}

// ---------------------------------------------------------------- params ----
function renderParams(): void {
  const track = pattern.tracks[curTrack];
  const defs = PARAM_DEFS[track.kind];
  const title = $('#params-title');
  const clearBtn = $('#clear-lock');
  const extras = $('#step-extras');

  if (editingStep !== null) {
    title.textContent = `STEP ${editingStep + 1} LOCK`;
    clearBtn.hidden = false;
    extras.hidden = false;
    const st = track.steps[editingStep];
    const prob = $<HTMLInputElement>('#prob');
    prob.value = String(st.prob);
    $('#prob-val').textContent = Math.round(st.prob * 100) + '%';
    extras.querySelectorAll<HTMLButtonElement>('.retrig button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.r) === st.retrig)
    );
  } else {
    title.textContent = `${track.name} · TRACK`;
    clearBtn.hidden = true;
    extras.hidden = true;
  }

  const wrap = $('#sliders');
  wrap.innerHTML = '';
  for (const d of defs) {
    const cur =
      editingStep !== null && track.steps[editingStep].plocks[d.id] !== undefined
        ? track.steps[editingStep].plocks[d.id]
        : editingStep !== null
          ? track.params[d.id] // show default until touched
          : track.params[d.id];

    const label = document.createElement('label');
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = d.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(d.min);
    input.max = String(d.max);
    input.step = String(d.step ?? (d.max - d.min) / 200);
    input.value = String(cur);
    const val = document.createElement('span');
    val.textContent = fmt(cur, d.step);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = fmt(v, d.step);
      if (editingStep !== null) {
        track.steps[editingStep].plocks[d.id] = v;
        pads[editingStep]?.classList.add('locked');
      } else {
        track.params[d.id] = v;
        if (track.kind === 'grain' && d.id === 'position') drawWave(-1);
      }
      queueSave();
    });
    label.append(lbl, input, val);
    wrap.appendChild(label);
  }

  $('#sample-tools').hidden = track.kind === 'wave';
  drawWave(-1);
}

function fmt(v: number, step?: number): string {
  return step && step >= 1 ? String(Math.round(v)) : v.toFixed(2);
}

$('#clear-lock').addEventListener('click', () => {
  if (editingStep === null) return;
  const st = pattern.tracks[curTrack].steps[editingStep];
  st.plocks = {};
  st.retrig = 1;
  st.prob = 1;
  renderGrid();
  renderParams();
  queueSave();
});

$<HTMLInputElement>('#prob').addEventListener('input', function () {
  if (editingStep === null) return;
  pattern.tracks[curTrack].steps[editingStep].prob = Number(this.value);
  $('#prob-val').textContent = Math.round(Number(this.value) * 100) + '%';
  renderGrid();
  queueSave();
});

document.querySelectorAll<HTMLButtonElement>('.retrig button').forEach((b) =>
  b.addEventListener('click', () => {
    if (editingStep === null) return;
    pattern.tracks[curTrack].steps[editingStep].retrig = Number(b.dataset.r);
    renderGrid();
    renderParams();
    queueSave();
  })
);

// ------------------------------------------------------------ sample I/O ----
function currentVoiceBuffer(): AudioBuffer | null {
  const kind = pattern.tracks[curTrack].kind;
  if (kind === 'chop') return seq.chopper.buffer;
  if (kind === 'grain') return seq.granular.buffer;
  return null;
}

function setCurrentVoiceBuffer(buf: AudioBuffer): void {
  const kind = pattern.tracks[curTrack].kind;
  if (kind === 'chop') seq.chopper.setBuffer(buf);
  else if (kind === 'grain') seq.granular.setBuffer(buf);
  drawWave(-1);
}

$('#load').addEventListener('click', () => $('#file').click());
$<HTMLInputElement>('#file').addEventListener('change', async function () {
  const f = this.files?.[0];
  if (!f) return;
  setCurrentVoiceBuffer(await decodeFile(engine.ctx, f));
  this.value = '';
});

$('#rec').addEventListener('click', async () => {
  const btn = $('#rec');
  if (!mic.recording) {
    try {
      await mic.begin();
      btn.classList.add('recording');
      btn.textContent = '■ STOP';
    } catch {
      btn.textContent = 'MIC ✕';
      setTimeout(() => (btn.textContent = '● REC'), 1200);
    }
  } else {
    const buf = await mic.finish(engine.ctx);
    btn.classList.remove('recording');
    btn.textContent = '● REC';
    setCurrentVoiceBuffer(buf);
  }
});

// -------------------------------------------------------------- waveform ----
function drawWave(activeStep: number): void {
  const canvas = $<HTMLCanvasElement>('#wave');
  const track = pattern.tracks[curTrack];
  if (track.kind === 'wave') return;
  const buf = currentVoiceBuffer();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth * dpr;
  const h = canvas.clientHeight * dpr;
  if (canvas.width !== w) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (!buf) return;

  const data = buf.getChannelData(0);
  const color = getComputedStyle($('#app')).getPropertyValue('--accent');
  ctx.strokeStyle = color || '#aaff00';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  const cols = Math.floor(w / dpr);
  const per = Math.floor(data.length / cols);
  for (let x = 0; x < cols; x++) {
    let min = 1;
    let max = -1;
    for (let i = 0; i < per; i += Math.max(1, Math.floor(per / 16))) {
      const v = data[x * per + i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.moveTo(x * dpr + 0.5, (0.5 - max * 0.48) * h);
    ctx.lineTo(x * dpr + 0.5, (0.5 - min * 0.48) * h);
  }
  ctx.stroke();

  if (track.kind === 'chop') {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let i = 1; i < 16; i++) {
      const x = (i / 16) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    if (activeStep >= 0 && track.steps[activeStep].on) {
      const slice =
        track.steps[activeStep].plocks.slice ?? track.params.slice;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect((Math.floor(slice) / 16) * w, 0, w / 16, h);
    }
  } else {
    const pos = track.params.position;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(pos * w - dpr, 0, 2 * dpr, h);
  }
}

// -------------------------------------------------------------------- fx ----
function bindFx(): void {
  const crush = $<HTMLInputElement>('#fx-crush');
  const bits = $<HTMLInputElement>('#fx-bits');
  const apply = () =>
    engine.setCrush(Number(bits.value), 1 + (16 - Number(bits.value)) * 2, Number(crush.value));
  crush.addEventListener('input', apply);
  bits.addEventListener('input', apply);

  const dtime = $<HTMLInputElement>('#fx-dtime');
  const dfb = $<HTMLInputElement>('#fx-dfb');
  const applyD = () => engine.setDelay(Number(dtime.value), Number(dfb.value));
  dtime.addEventListener('input', applyD);
  dfb.addEventListener('input', applyD);
}

// ------------------------------------------------------------------ init ----
function renderAll(): void {
  bpmInput.value = String(pattern.bpm);
  $('#bpm-val').textContent = String(pattern.bpm);
  swingInput.value = String(pattern.swing);
  $('#swing-val').textContent = Math.round(pattern.swing * 200) + '%';
  document
    .getElementById('app')!
    .style.setProperty('--accent', TRACK_COLORS[pattern.tracks[curTrack].kind]);
  renderTracks();
  renderGrid();
  renderParams();
}

bindFx();
