// REVERIE — a generative dream-synth voice built on Tone.js.
// Nothing about it is fixed: the oscillator flavour is re-rolled from note to
// note, every note gets a random release (10–90% of the max tail), and once
// per bar the whole patch drifts — filter, chorus, delay feedback, spread.
// Random within the frame: pitches always stay in the grid's scale.

import * as Tone from 'tone';

const OSC_TYPES = [
  'sine',
  'triangle',
  'fatsawtooth',
  'fattriangle',
  'fmsine',
  'fmtriangle',
  'amsine',
  'square',
] as const;

const MAX_RELEASE = 3.2; // seconds; per-note release = 10–90% of this

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T =>
  xs[Math.floor(Math.random() * xs.length)];

export class Dream {
  private ready = false;
  private initing: Promise<void> | null = null;
  private synth!: Tone.PolySynth<Tone.Synth>;
  private filter!: Tone.Filter;
  private chorus!: Tone.Chorus;
  private delay!: Tone.PingPongDelay;
  private reverb!: Tone.Reverb;

  init(ctx: AudioContext, out: AudioNode): Promise<void> {
    if (this.initing) return this.initing;
    this.initing = (async () => {
      Tone.setContext(ctx);

      this.filter = new Tone.Filter(1800, 'lowpass');
      this.filter.Q.value = 1.2;
      this.chorus = new Tone.Chorus({
        frequency: 0.45,
        delayTime: 6,
        depth: 0.55,
        wet: 0.5,
      }).start();
      this.delay = new Tone.PingPongDelay({
        delayTime: 0.32,
        feedback: 0.38,
        wet: 0.28,
      });
      this.reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 0.42 });
      await this.reverb.ready;

      this.synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 24,
        volume: -8,
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 1.5 },
      } as never);

      this.synth.chain(this.filter, this.chorus, this.delay, this.reverb);
      // Tone nodes connect happily to native AudioNodes.
      this.reverb.connect(out as unknown as Tone.ToneAudioNode);
      this.ready = true;
    })();
    return this.initing;
  }

  get isReady(): boolean {
    return this.ready;
  }

  // One note of the dream. midi comes from the scale grid, vel 0..1.
  trigger(midi: number, vel: number, time: number): void {
    if (!this.ready) return;

    // Re-roll the voice character for this note.
    const release = rnd(0.1, 0.9) * MAX_RELEASE;
    const attack = Math.random() < 0.3 ? rnd(0.04, 0.35) : rnd(0.004, 0.02);
    this.synth.set({
      oscillator: { type: pick(OSC_TYPES) } as never,
      envelope: {
        attack,
        decay: rnd(0.08, 0.5),
        sustain: rnd(0.1, 0.5),
        release,
      },
      detune: rnd(-14, 14),
    });

    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    const dur = rnd(0.06, 0.3);
    this.synth.triggerAttackRelease(freq, dur, time, vel);

    // Ghost sparkle an octave up, slightly late and quiet.
    if (Math.random() < 0.22) {
      this.synth.triggerAttackRelease(
        freq * 2,
        dur * 0.6,
        time + rnd(0.02, 0.09),
        vel * rnd(0.2, 0.45)
      );
    }
    // Rare sub an octave down for weight.
    if (Math.random() < 0.1) {
      this.synth.triggerAttackRelease(freq / 2, dur, time, vel * 0.5);
    }
  }

  // Called once per sequencer step; drifts the patch at bar boundaries.
  tick(step: number, bpm: number): void {
    if (!this.ready || step !== 0) return;
    const now = Tone.now();
    const stepDur = 60 / bpm / 4;

    // Filter wanders somewhere new each bar.
    this.filter.frequency.rampTo(rnd(500, 5200), rnd(0.4, 2.5), now);
    // Delay locks to a musical division but re-rolls which one.
    this.delay.delayTime.rampTo(stepDur * pick([2, 3, 4, 6]), 0.3, now);
    this.delay.feedback.rampTo(rnd(0.2, 0.55), 0.5, now);
    this.chorus.depth = rnd(0.2, 0.8);
    this.reverb.wet.rampTo(rnd(0.25, 0.55), 1, now);
  }
}
