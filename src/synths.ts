// The synth voices, built on Tone.js. Every preset follows the same rule:
// random within a frame. Pitches always come from the grid's scale, but the
// timbre is re-rolled on every note and the patch drifts once per bar, so a
// pattern never repeats itself exactly.
//
// Each note builds its own short-lived synth and disposes after its tail —
// there is no shared voice pool to exhaust (a PolySynth silently ran dry by
// the second loop under long random releases).

import * as Tone from 'tone';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T =>
  xs[Math.floor(Math.random() * xs.length)];

export type SynthId = 'reverie' | 'kalimba' | 'rhodes' | 'acid' | 'machine';

export interface SynthDef {
  id: SynthId;
  label: string;
  /** One line for the sound picker. */
  hint: string;
}

export const SYNTHS: SynthDef[] = [
  { id: 'reverie', label: 'REVERIE', hint: 'Drifting pad, long random tails' },
  { id: 'kalimba', label: 'KALIMBA', hint: 'Muted wooden pluck' },
  { id: 'rhodes', label: 'RHODES', hint: 'Electric piano, shimmering' },
  { id: 'acid', label: 'ACID', hint: 'Squelching 303 bass' },
  { id: 'machine', label: 'MACHINE', hint: 'Synthesised drums' },
];

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

const MAX_RELEASE = 3.2; // REVERIE tail; per-note release = 10–90% of this

/** Per-preset home base for the shared effect chain. */
const TONE_SETTINGS: Record<
  SynthId,
  {
    cutoff: [number, number];
    chorus: number;
    delayWet: number;
    reverbWet: [number, number];
    /** Overdrive in the chain, 0 for none. The 303 wants some. */
    drive?: number;
  }
> = {
  reverie: { cutoff: [500, 5200], chorus: 0.5, delayWet: 0.28, reverbWet: [0.25, 0.55] },
  kalimba: { cutoff: [700, 3400], chorus: 0.25, delayWet: 0.2, reverbWet: [0.2, 0.4] },
  rhodes: { cutoff: [900, 6000], chorus: 0.6, delayWet: 0.18, reverbWet: [0.2, 0.42] },
  // The chain filter stays out of the way — on acid the sweep belongs to the
  // per-note filter, and the reverb stays dry so the bass keeps its edge.
  acid: { cutoff: [6000, 12000], chorus: 0, delayWet: 0.22, reverbWet: [0.04, 0.16], drive: 0.28 },
  machine: { cutoff: [1200, 9000], chorus: 0.1, delayWet: 0.12, reverbWet: [0.06, 0.22] },
};

/** One preset's own colouring: filter -> chorus -> delay, plus a reverb send. */
interface Chain {
  filter: Tone.Filter;
  chorus: Tone.Chorus;
  delay: Tone.PingPongDelay;
  send: Tone.Gain;
  /** Echo spacing in steps, and what that came to in seconds. */
  division: number;
  echo: number;
}

export class Synths {
  private ready = false;
  private initing: Promise<void> | null = null;
  /** Shared reverb bus — one convolution for every preset, not four. */
  private reverb!: Tone.Reverb;
  private out!: Tone.ToneAudioNode;
  private chains = new Map<SynthId, Chain>();
  /** Voice budget so four busy tracks can't melt a phone. */
  private active = 0;
  private readonly maxVoices = 40;

  init(ctx: AudioContext, out: AudioNode): Promise<void> {
    if (this.initing) return this.initing;
    this.initing = (async () => {
      Tone.setContext(ctx);
      this.out = out as unknown as Tone.ToneAudioNode;
      this.reverb = new Tone.Reverb({ decay: 7, preDelay: 0.02, wet: 1 });
      await this.reverb.ready;
      this.reverb.connect(this.out);
      this.ready = true;
    })();
    return this.initing;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Build (once) the effect chain a preset plays through. */
  private chainFor(id: SynthId): Chain {
    const hit = this.chains.get(id);
    if (hit) return hit;
    const s = TONE_SETTINGS[id];

    const filter = new Tone.Filter((s.cutoff[0] + s.cutoff[1]) / 2, 'lowpass');
    filter.Q.value = 1.2;
    const chorus = new Tone.Chorus({
      frequency: 0.45,
      delayTime: 6,
      depth: 0.55,
      wet: s.chorus,
    }).start();
    const delay = new Tone.PingPongDelay({
      delayTime: 0.32,
      feedback: 0.38,
      wet: s.delayWet,
    });
    const send = new Tone.Gain((s.reverbWet[0] + s.reverbWet[1]) / 2);

    // Overdrive sits after the filter, before the modulation — the way a
    // 303 runs into a pedal, so the resonance peak is what gets driven.
    if (s.drive) {
      const drive = new Tone.Distortion({ distortion: s.drive, wet: 0.85 });
      filter.chain(drive, chorus, delay);
    } else {
      filter.chain(chorus, delay);
    }
    delay.connect(this.out); // dry
    delay.connect(send);
    send.connect(this.reverb); // wet

    const chain = { filter, chorus, delay, send, division: 0, echo: 0.32 };
    this.chains.set(id, chain);
    return chain;
  }

  /** Wire a one-shot voice into its preset's chain and bin it after the tail. */
  private live(
    id: SynthId,
    node: Tone.ToneAudioNode,
    time: number,
    ttl: number
  ): void {
    node.connect(this.chainFor(id).filter);
    const ms = (time - Tone.now() + ttl) * 1000;
    this.active++;
    window.setTimeout(() => {
      node.dispose();
      this.active--;
    }, Math.max(0, ms));
  }

  /** Test seam: what a preset's chain sounds like right now. */
  snapshot(
    id: SynthId
  ): { cutoff: number; echo: number; wet: number; feedback: number } | null {
    const c = this.chains.get(id);
    if (!c) return null;
    return {
      cutoff: c.filter.frequency.value as number,
      echo: c.echo,
      wet: c.delay.wet.value,
      feedback: c.delay.feedback.value,
    };
  }

  /** Room for another note? Keeps four dense tracks from stacking up. */
  get hasHeadroom(): boolean {
    return this.active < this.maxVoices;
  }

  trigger(id: SynthId, midi: number, vel: number, time: number): void {
    if (!this.ready || !this.hasHeadroom) return;
    this.chainFor(id);
    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    switch (id) {
      case 'reverie':
        return this.reverie(freq, vel, time);
      case 'kalimba':
        return this.kalimba(freq, vel, time);
      case 'rhodes':
        return this.rhodes(freq, vel, time);
      case 'acid':
        return this.acid(freq, vel, time);
      case 'machine':
        return this.machine(midi, vel, time);
    }
  }

  // ---------------------------------------------------------- REVERIE -----
  // Oscillator flavour re-rolled per note, random 10–90% release, ghost
  // octave sparkles and the occasional sub for weight.
  private reverieNote(
    freq: number,
    dur: number,
    time: number,
    vel: number,
    release: number
  ): void {
    const s = new Tone.Synth({
      volume: -12,
      oscillator: { type: pick(OSC_TYPES) } as never,
      envelope: {
        attack: Math.random() < 0.3 ? rnd(0.04, 0.35) : rnd(0.004, 0.02),
        decay: rnd(0.08, 0.5),
        sustain: rnd(0.1, 0.5),
        release,
      },
      detune: rnd(-14, 14),
    });
    s.triggerAttackRelease(freq, dur, time, vel);
    this.live('reverie', s, time, dur + release + 0.4);
  }

  private reverie(freq: number, vel: number, time: number): void {
    const dur = rnd(0.06, 0.3);
    const release = rnd(0.1, 0.9) * MAX_RELEASE;
    this.reverieNote(freq, dur, time, vel, release);
    if (Math.random() < 0.22) {
      this.reverieNote(
        freq * 2,
        dur * 0.6,
        time + rnd(0.02, 0.09),
        vel * rnd(0.2, 0.45),
        release * 0.7
      );
    }
    if (Math.random() < 0.1) {
      this.reverieNote(freq / 2, dur, time, vel * 0.5, release);
    }
  }

  // ---------------------------------------------------------- KALIMBA -----
  // Karplus-Strong pluck: muted, woody, thumb-piano. Release (resonance) and
  // cutoff (dampening) are rolled fresh on every note.
  private kalimba(freq: number, vel: number, time: number): void {
    const resonance = rnd(0.55, 0.94); // how long the tine rings
    const dampening = rnd(900, 4500); // the pluck's cutoff
    // PluckSynth has no velocity argument, so dynamics live in the gain.
    const db = (v: number) => Math.max(-40, 20 * Math.log10(Math.max(0.02, v)));
    const p = new Tone.PluckSynth({
      volume: 5 + db(vel),
      attackNoise: rnd(0.4, 1.8),
      dampening,
      resonance,
      release: rnd(0.1, 0.9) * 1.4,
    });
    // A per-note lowpass keeps it muted, and sweeps a little as it decays.
    const lp = new Tone.Filter(rnd(1200, 5200), 'lowpass');
    lp.Q.value = rnd(0.3, 2.2);
    lp.frequency.rampTo(rnd(500, 1600), rnd(0.3, 1.1), time);
    p.connect(lp);
    p.triggerAttack(freq, time);
    this.live('kalimba', lp, time, 2.2);
    window.setTimeout(
      () => p.dispose(),
      Math.max(0, (time - Tone.now() + 2.2) * 1000)
    );

    // Soft octave ghost, like a thumb catching the neighbouring tine.
    if (Math.random() < 0.18) {
      const g = new Tone.PluckSynth({
        volume: -3 + db(vel * 0.5),
        attackNoise: 0.6,
        dampening: dampening * 1.4,
        resonance: resonance * 0.8,
      });
      g.triggerAttack(freq * 2, time + rnd(0.01, 0.05));
      this.live('kalimba', g, time, 1.6);
    }
  }

  // ------------------------------------------------------------- ACID -----
  // A 303 in spirit: one saw or square through a steep resonant lowpass
  // that the envelope sweeps on every note. Two octaves below the grid, so
  // it sits under the other tracks as a bass.
  //
  // Resonance and cutoff are where the character lives, so they are what
  // gets rolled: Q from a polite growl to the edge of self-oscillation, and
  // a base cutoff plus envelope depth that decide how far the sweep opens.
  // Accents (loud cells) push both, the way the accent line on a real 303
  // feeds the filter as well as the amp.
  private acid(freq: number, vel: number, time: number): void {
    const accent = vel > 0.7;
    // How resonant the filter is. High Q with a low base is the squelch.
    const q = accent ? rnd(9, 15) : rnd(4, 11);
    // Where the sweep starts, and how many octaves it climbs.
    const base = rnd(90, 260) * (accent ? rnd(1.1, 1.6) : 1);
    const octaves = accent ? rnd(3, 4.6) : rnd(1.6, 3.4);
    // How fast it falls back — short is a blip, long is a wow.
    const sweep = rnd(0.09, 0.42);
    const dur = rnd(0.06, 0.22);
    const release = rnd(0.03, 0.14);

    const s = new Tone.MonoSynth({
      // Bass carries far more energy than the other voices at the same
      // nominal level; measured against MACHINE rather than set by ear.
      volume: -11,
      oscillator: { type: pick(['sawtooth', 'square']) } as never,
      filter: { type: 'lowpass', rolloff: -24, Q: q },
      envelope: {
        attack: 0.002,
        decay: rnd(0.05, 0.3),
        sustain: accent ? rnd(0.25, 0.5) : rnd(0.05, 0.25),
        release,
      },
      filterEnvelope: {
        attack: rnd(0.002, 0.014),
        decay: sweep,
        sustain: rnd(0.02, 0.22),
        release: rnd(0.05, 0.25),
        baseFrequency: base,
        octaves,
        exponent: 2,
      },
      detune: rnd(-6, 6),
    });
    s.triggerAttackRelease(freq / 4, dur, time, accent ? 1 : vel * 0.85);
    this.live('acid', s, time, dur + release + 0.5);
  }

  // ----------------------------------------------------------- RHODES -----
  // FM electric piano: a bell-ish attack over a warm body, with a slow
  // tremolo shimmer so held notes keep moving.
  private rhodes(freq: number, vel: number, time: number): void {
    const dur = rnd(0.12, 0.45);
    const release = rnd(0.4, 1.8);
    const s = new Tone.FMSynth({
      volume: 0,
      harmonicity: pick([1, 2, 3, 3.01, 4]),
      modulationIndex: rnd(3, 11),
      oscillator: { type: 'sine' },
      envelope: {
        attack: rnd(0.002, 0.012),
        decay: rnd(0.25, 0.9),
        sustain: rnd(0.05, 0.28),
        release,
      },
      modulation: { type: pick(['sine', 'triangle']) } as never,
      modulationEnvelope: {
        attack: rnd(0.002, 0.02),
        decay: rnd(0.1, 0.5),
        sustain: rnd(0, 0.2),
        release: rnd(0.2, 0.8),
      },
      detune: rnd(-8, 8),
    });
    // Rhodes shimmer: gentle amplitude wobble, rate rolled per note.
    const trem = new Tone.Tremolo({
      frequency: rnd(2.5, 7),
      depth: rnd(0.15, 0.55),
      spread: 180,
    }).start();
    s.connect(trem);
    s.triggerAttackRelease(freq, dur, time, vel);
    this.live('rhodes', trem, time, dur + release + 0.4);
    window.setTimeout(
      () => s.dispose(),
      Math.max(0, (time - Tone.now() + dur + release + 0.4) * 1000)
    );

    // Occasional fifth or octave, the way a Rhodes bar rings sympathetically.
    if (Math.random() < 0.16) {
      const g = new Tone.FMSynth({
        volume: -12,
        harmonicity: pick([2, 3]),
        modulationIndex: rnd(2, 6),
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.05, release: 0.9 },
      });
      g.triggerAttackRelease(
        freq * pick([1.5, 2]),
        dur * 0.7,
        time + rnd(0.01, 0.06),
        vel * 0.4
      );
      this.live('rhodes', g, time, dur + 1.4);
    }
  }

  // ---------------------------------------------------------- MACHINE -----
  // Synthesised drums. The column's register picks the instrument — low
  // columns are kicks and toms, the middle is snare/clap, the top is metal —
  // and the exact pitch tunes it, so drawing melodies draws grooves.
  private machine(midi: number, vel: number, time: number): void {
    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    const kind = midi % 12;

    // kick | tom | snare | clap | hat  — chosen by scale degree
    if (kind < 3) {
      const k = new Tone.MembraneSynth({
        volume: -3,
        pitchDecay: rnd(0.02, 0.09),
        octaves: rnd(3, 8),
        oscillator: { type: pick(['sine', 'triangle']) } as never,
        envelope: {
          attack: 0.001,
          decay: rnd(0.18, 0.6),
          sustain: 0,
          release: rnd(0.05, 0.3),
        },
      });
      k.triggerAttackRelease(freq / 4, rnd(0.08, 0.3), time, vel);
      this.live('machine', k, time, 1.4);
      return;
    }

    if (kind < 6) {
      const t = new Tone.MembraneSynth({
        volume: -7,
        pitchDecay: rnd(0.04, 0.14),
        octaves: rnd(1.5, 4),
        envelope: {
          attack: 0.001,
          decay: rnd(0.12, 0.45),
          sustain: 0,
          release: rnd(0.05, 0.2),
        },
      });
      t.triggerAttackRelease(freq / 2, rnd(0.06, 0.24), time, vel);
      this.live('machine', t, time, 1.2);
      return;
    }

    if (kind < 9) {
      // Snare: noise burst plus a tuned body.
      const n = new Tone.NoiseSynth({
        volume: -9,
        noise: { type: pick(['white', 'pink']) } as never,
        envelope: {
          attack: 0.001,
          decay: rnd(0.08, 0.3),
          sustain: 0,
          release: rnd(0.02, 0.12),
        },
      });
      const bp = new Tone.Filter(rnd(1200, 3600), 'bandpass');
      bp.Q.value = rnd(0.6, 2.4);
      n.connect(bp);
      n.triggerAttackRelease(rnd(0.05, 0.2), time, vel);
      this.live('machine', bp, time, 1);
      window.setTimeout(
        () => n.dispose(),
        Math.max(0, (time - Tone.now() + 1) * 1000)
      );

      const body = new Tone.MembraneSynth({
        volume: -15,
        pitchDecay: 0.03,
        octaves: 2,
        envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
      });
      body.triggerAttackRelease(freq / 2, 0.06, time, vel * 0.7);
      this.live('machine', body, time, 0.8);
      return;
    }

    if (kind < 11) {
      // Clap: a few noise slaps in quick succession.
      const hits = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < hits; i++) {
        const c = new Tone.NoiseSynth({
          volume: -13,
          noise: { type: 'white' },
          envelope: {
            attack: 0.001,
            decay: rnd(0.03, 0.12),
            sustain: 0,
            release: 0.02,
          },
        });
        const bp = new Tone.Filter(rnd(900, 2200), 'bandpass');
        bp.Q.value = rnd(1, 3);
        c.connect(bp);
        c.triggerAttackRelease(0.03, time + i * rnd(0.008, 0.02), vel * 0.8);
        this.live('machine', bp, time, 0.7);
        window.setTimeout(
          () => c.dispose(),
          Math.max(0, (time - Tone.now() + 0.7) * 1000)
        );
      }
      return;
    }

    // Metal: hats and cymbals, open or closed at random.
    const open = Math.random() < 0.25;
    const m = new Tone.MetalSynth({
      volume: -21,
      envelope: {
        attack: 0.001,
        decay: open ? rnd(0.3, 0.9) : rnd(0.03, 0.14),
        release: rnd(0.02, 0.2),
      },
      harmonicity: rnd(3, 9),
      modulationIndex: rnd(12, 42),
      resonance: rnd(2000, 7000),
      octaves: rnd(0.5, 2),
    } as never);
    m.frequency.value = freq * rnd(0.9, 1.6);
    m.triggerAttackRelease(open ? rnd(0.2, 0.6) : rnd(0.02, 0.1), time, vel);
    this.live('machine', m, time, 1.6);
  }

  // Called once per bar per preset in use; drifts that preset's patch.
  //
  // `time` is the scheduled moment of the downbeat, a lookahead ahead of
  // Tone.now(). Every change has to be anchored to it: starting the ramps
  // at "now" instead lands them roughly a tenth of a second early, so the
  // patch audibly shifts during the tail of the bar that is still playing.
  tick(id: SynthId, step: number, bpm: number, time: number): void {
    if (!this.ready || step !== 0) return;
    const chain = this.chains.get(id);
    if (!chain) return;
    const s = TONE_SETTINGS[id];
    const stepDur = 60 / bpm / 4;

    chain.filter.frequency.rampTo(
      rnd(s.cutoff[0], s.cutoff[1]),
      rnd(0.4, 2.5),
      time
    );
    chain.delay.feedback.rampTo(rnd(0.2, 0.55), 0.5, time);
    chain.send.gain.rampTo(rnd(s.reverbWet[0], s.reverbWet[1]), 1, time);

    // Chorus depth is a plain number, not a ramped parameter: assigning it
    // steps the modulation and clicks. Drift it instead.
    chain.chorus.depth = Math.min(
      0.8,
      Math.max(0.2, chain.chorus.depth + rnd(-0.09, 0.09))
    );

    this.retimeEcho(chain, s.delayWet, stepDur, time);
  }

  /**
   * Move the echo onto a new subdivision of the beat.
   *
   * Retuning a delay line that is still ringing resamples whatever is in
   * its buffer, which pitch-warps the echoes — a gargle right at the turn
   * of the loop. So change it rarely, and mute the echoes across the change
   * so there is nothing left in the buffer to warp. A tempo change goes
   * through here too, for the same reason.
   */
  private retimeEcho(
    chain: Chain,
    wet: number,
    stepDur: number,
    time: number
  ): void {
    const reroll = chain.division === 0 || Math.random() < 0.25;
    const division = reroll ? pick([2, 3, 4, 6]) : chain.division;
    const next = stepDur * division;
    if (Math.abs(next - chain.echo) < 1e-3) return;
    chain.division = division;
    chain.echo = next;

    const duckFrom = Math.max(Tone.now(), time - 0.08);
    chain.delay.wet.rampTo(0, Math.max(0.01, time - duckFrom), duckFrom);
    chain.delay.delayTime.setValueAtTime(next, time);
    chain.delay.wet.rampTo(wet, 0.2, time + 0.02);
  }
}
