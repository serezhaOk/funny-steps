// Musical mapping: 10 grid columns -> 10 ascending notes of the chosen scale.

export const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

export interface Scale {
  name: string;
  steps: number[]; // semitone offsets of one octave
}

export const SCALES: Scale[] = [
  { name: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'penta', steps: [0, 3, 5, 7, 10] },
  { name: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
];

export const COLS = 10;

// Samples are recorded in C, so a column whose pitch equals the sample's base
// note (default C4 = 60) plays at natural speed.
const DEFAULT_BASE = 60; // C4
// Root sits low enough that the 10 notes stay in a musical range.
const ROOT_BASE = 48; // C3

// MIDI note for a given column, root pitch class and scale.
export function columnMidi(col: number, rootPc: number, scale: Scale): number {
  const L = scale.steps.length;
  const octave = Math.floor(col / L);
  const offset = octave * 12 + scale.steps[col % L];
  return ROOT_BASE + rootPc + offset;
}

// Playback rate to pitch a sample (base note = baseMidi) to that column.
// No octave clamp: since the samples are tuned to C, every column plays true
// pitch (only guarded against pathological extremes).
export function columnRate(
  col: number,
  rootPc: number,
  scale: Scale,
  baseMidi = DEFAULT_BASE
): number {
  const midi = columnMidi(col, rootPc, scale);
  const rate = Math.pow(2, (midi - baseMidi) / 12);
  return Math.min(4, Math.max(0.25, rate));
}

export function rateTable(
  rootPc: number,
  scale: Scale,
  baseMidi = DEFAULT_BASE
): number[] {
  return Array.from({ length: COLS }, (_, c) =>
    columnRate(c, rootPc, scale, baseMidi)
  );
}
