// The built-in sample set (files live in public/samples). All are recorded
// in C, so baseMidi defaults to C4 (60); override per sample if one sits in a
// different octave.

export interface SampleDef {
  file: string;
  label: string;
  baseMidi?: number;
}

export const SAMPLES: SampleDef[] = [
  { file: 'bell-kalimbox.wav', label: 'KALIMBOX' },
  { file: 'keys-synth.wav', label: 'KEYS SYNTH' },
  { file: 'grand-piano-low.wav', label: 'PIANO LOW' },
  { file: 'grand-piano-high.wav', label: 'PIANO HIGH' },
  { file: 'horn-synth.wav', label: 'HORN SYNTH' },
  { file: 'ikembe.wav', label: 'IKEMBE' },
  { file: 'bell-evolving.wav', label: 'EVOLVING' },
  { file: 'bell-lovely.wav', label: 'LOVELY' },
  { file: 'bell-toy-piano.wav', label: 'TOY PIANO' },
  { file: 'bell-ring.wav', label: 'RING BELL' },
  { file: 'synth-round-five.wav', label: 'ROUND FIVE' },
  { file: 'westafrica-ngona.wav', label: 'NGONA' },
  { file: 'bells-agogo.wav', label: 'AGOGO' },
  { file: 'cowbell.wav', label: 'COWBELL' },
  { file: 'conga-low.wav', label: 'CONGA' },
  { file: 'bongo-low.wav', label: 'BONGO' },
];
