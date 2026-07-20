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

// Reference pitch that plays a sample at its natural speed (playbackRate 1).
const REF_MIDI = 60; // C4
// Root sits low enough that the 10 notes stay in a musical, low-shift range.
const ROOT_BASE = 48; // C3

// MIDI note for a given column, root pitch class and scale.
export function columnMidi(col: number, rootPc: number, scale: Scale): number {
  const L = scale.steps.length;
  const octave = Math.floor(col / L);
  const offset = octave * 12 + scale.steps[col % L];
  return ROOT_BASE + rootPc + offset;
}

// Playback rate to pitch a sample to that column (clamped to +/- one octave
// so shifted samples keep their character).
export function columnRate(col: number, rootPc: number, scale: Scale): number {
  const midi = columnMidi(col, rootPc, scale);
  const rate = Math.pow(2, (midi - REF_MIDI) / 12);
  return Math.min(2, Math.max(0.5, rate));
}

export function rateTable(rootPc: number, scale: Scale): number[] {
  return Array.from({ length: COLS }, (_, c) => columnRate(c, rootPc, scale));
}
