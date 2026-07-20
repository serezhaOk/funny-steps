// Data model: pattern -> tracks -> steps. Each step can p-lock any track param.

export type TrackKind = 'chop' | 'grain' | 'wave';

export interface ParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
  step?: number;
}

export interface Step {
  on: boolean;
  prob: number; // 0..1 chance to fire
  retrig: number; // 1 = single hit, 2/3/4 = ratchet subdivisions
  plocks: Record<string, number>;
}

export interface Track {
  kind: TrackKind;
  name: string;
  steps: Step[];
  params: Record<string, number>; // track-level defaults
  gain: number;
}

export interface Pattern {
  bpm: number;
  swing: number; // 0..0.5, delay applied to odd 16ths
  tracks: Track[];
}

export const STEPS = 16;

export const PARAM_DEFS: Record<TrackKind, ParamDef[]> = {
  chop: [
    { id: 'slice', label: 'SLICE', min: 0, max: 15, def: 0, step: 1 },
    { id: 'pitch', label: 'PITCH', min: -24, max: 24, def: 0, step: 1 },
    { id: 'decay', label: 'DECAY', min: 0.02, max: 1, def: 0.3 },
    { id: 'reverse', label: 'REV', min: 0, max: 1, def: 0, step: 1 },
    { id: 'delaySend', label: 'DELAY', min: 0, max: 1, def: 0 },
  ],
  grain: [
    { id: 'position', label: 'POS', min: 0, max: 1, def: 0.2 },
    { id: 'size', label: 'SIZE', min: 0.02, max: 0.4, def: 0.09 },
    { id: 'density', label: 'DENS', min: 4, max: 80, def: 25 },
    { id: 'spray', label: 'SPRAY', min: 0, max: 0.5, def: 0.05 },
    { id: 'pitch', label: 'PITCH', min: -24, max: 24, def: 0, step: 1 },
    { id: 'delaySend', label: 'DELAY', min: 0, max: 1, def: 0.15 },
  ],
  wave: [
    { id: 'note', label: 'NOTE', min: -24, max: 24, def: 0, step: 1 },
    { id: 'morph', label: 'MORPH', min: 0, max: 1, def: 0.3 },
    { id: 'cutoff', label: 'CUTOFF', min: 80, max: 8000, def: 900 },
    { id: 'res', label: 'RES', min: 0, max: 25, def: 12 },
    { id: 'decay', label: 'DECAY', min: 0.03, max: 1, def: 0.18 },
    { id: 'delaySend', label: 'DELAY', min: 0, max: 1, def: 0.1 },
  ],
};

function makeStep(): Step {
  return { on: false, prob: 1, retrig: 1, plocks: {} };
}

function makeTrack(kind: TrackKind, name: string): Track {
  const params: Record<string, number> = {};
  for (const d of PARAM_DEFS[kind]) params[d.id] = d.def;
  return {
    kind,
    name,
    steps: Array.from({ length: STEPS }, makeStep),
    params,
    gain: 0.9,
  };
}

export function defaultPattern(): Pattern {
  const p: Pattern = {
    bpm: 150,
    swing: 0,
    tracks: [
      makeTrack('chop', 'CHOP'),
      makeTrack('grain', 'GRAIN'),
      makeTrack('wave', 'WAVE'),
    ],
  };
  // A starter groove so the machine talks immediately.
  const [chop, grain, wave] = p.tracks;
  [0, 4, 8, 10, 12].forEach((i) => (chop.steps[i].on = true));
  chop.steps[4].plocks.slice = 4;
  chop.steps[10].plocks.slice = 7;
  chop.steps[12].plocks.pitch = 12;
  [2, 7, 14].forEach((i) => (grain.steps[i].on = true));
  grain.steps[7].plocks.position = 0.6;
  [0, 3, 6, 11, 14].forEach((i) => (wave.steps[i].on = true));
  wave.steps[3].plocks.note = 3;
  wave.steps[6].plocks.note = -5;
  wave.steps[11].plocks.cutoff = 3500;
  wave.steps[14].plocks.note = 7;
  return p;
}

// Resolve the effective value of a param for a given step (p-lock wins).
export function stepParam(track: Track, stepIdx: number, id: string): number {
  const lock = track.steps[stepIdx].plocks[id];
  return lock !== undefined ? lock : track.params[id];
}

const LS_KEY = 'funny-steps-pattern-v1';

export function savePattern(p: Pattern): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function loadPattern(): Pattern | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pattern;
    if (!p.tracks || p.tracks.length !== 3) return null;
    return p;
  } catch {
    return null;
  }
}
