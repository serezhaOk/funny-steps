// The three voices. Each trigger() schedules everything at an exact time with
// the step's resolved params (p-locks already applied by the sequencer).

import type { AudioEngine } from './engine';

export interface HitParams {
  [id: string]: number;
}

const semis = (n: number) => Math.pow(2, n / 12);

// ---------------------------------------------------------------- Chopper ---
// Slices a buffer into 16 pieces; each hit plays one slice with pitch/decay,
// optionally reversed. Beat-repeat comes from retrigs in the sequencer.
export class Chopper {
  buffer: AudioBuffer | null = null;
  private reversed: AudioBuffer | null = null;

  constructor(private engine: AudioEngine) {}

  setBuffer(buf: AudioBuffer): void {
    this.buffer = buf;
    this.reversed = null; // lazily rebuilt
  }

  private getReversed(): AudioBuffer {
    if (!this.reversed && this.buffer) {
      const src = this.buffer;
      const rev = this.engine.ctx.createBuffer(
        src.numberOfChannels,
        src.length,
        src.sampleRate
      );
      for (let ch = 0; ch < src.numberOfChannels; ch++) {
        const a = src.getChannelData(ch);
        const b = rev.getChannelData(ch);
        for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
      }
      this.reversed = rev;
    }
    return this.reversed!;
  }

  trigger(time: number, p: HitParams, gain: number): void {
    if (!this.buffer) return;
    const ctx = this.engine.ctx;
    const nSlices = 16;
    const sliceDur = this.buffer.duration / nSlices;
    const slice = Math.floor(p.slice) % nSlices;
    const rev = p.reverse >= 0.5;

    const src = ctx.createBufferSource();
    src.buffer = rev ? this.getReversed() : this.buffer;
    src.playbackRate.value = semis(p.pitch);
    const offset = rev
      ? this.buffer.duration - (slice + 1) * sliceDur
      : slice * sliceDur;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + p.decay);
    src.connect(env);
    this.engine.routeHit(env, p.delaySend);
    src.start(time, Math.max(0, offset), sliceDur * 2);
    src.stop(time + p.decay + 0.05);
  }
}

// ---------------------------------------------------------------- Granular --
// Clouds of tiny grains read from a position in the buffer. Time-stretch for
// free: position moves independently of pitch.
export class Granular {
  buffer: AudioBuffer | null = null;

  constructor(private engine: AudioEngine) {}

  setBuffer(buf: AudioBuffer): void {
    this.buffer = buf;
  }

  // Fires a burst of grains covering stepDur seconds starting at `time`.
  trigger(time: number, p: HitParams, gain: number, stepDur: number): void {
    if (!this.buffer) return;
    const ctx = this.engine.ctx;
    const interval = 1 / p.density;
    const nGrains = Math.min(64, Math.ceil(stepDur / interval));
    const out = ctx.createGain();
    out.gain.value = gain * 0.8;
    this.engine.routeHit(out, p.delaySend);

    for (let i = 0; i < nGrains; i++) {
      const gTime = time + i * interval;
      const jitter = (Math.random() * 2 - 1) * p.spray;
      const pos = Math.min(
        Math.max(0, p.position + jitter),
        1 - p.size / this.buffer.duration
      );
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = semis(p.pitch);

      // Hann-ish grain envelope: quick fade in/out to avoid clicks.
      const env = ctx.createGain();
      const half = p.size / 2;
      env.gain.setValueAtTime(0, gTime);
      env.gain.linearRampToValueAtTime(1, gTime + half);
      env.gain.linearRampToValueAtTime(0, gTime + p.size);
      src.connect(env);
      env.connect(out);
      src.start(gTime, pos * this.buffer.duration, p.size + 0.01);
    }
  }
}

// ---------------------------------------------------------------- Wavetable -
// Morphing wavetable voice: crossfades between PeriodicWaves, through a
// screaming resonant lowpass with an envelope. The acid department.
export class Wavetable {
  private waves: PeriodicWave[] = [];
  baseFreq = 65.41; // C2

  constructor(private engine: AudioEngine) {
    this.buildTables();
  }

  private buildTables(): void {
    const ctx = this.engine.ctx;
    const N = 32;
    const zeros = new Float32Array(N);
    const mk = (fn: (n: number) => number) => {
      const imag = new Float32Array(N);
      for (let n = 1; n < N; n++) imag[n] = fn(n);
      return ctx.createPeriodicWave(zeros, imag, {
        disableNormalization: false,
      });
    };
    this.waves = [
      mk((n) => (n === 1 ? 1 : 0)), // sine
      mk((n) => 1 / n), // saw
      mk((n) => (n % 2 === 1 ? 1 / n : 0)), // square
      mk((n) => (n % 2 === 1 ? 1 / (n * n) : 0.3 / n)), // odd/gritty hybrid
    ];
  }

  trigger(time: number, p: HitParams, gain: number): void {
    const ctx = this.engine.ctx;
    const freq = this.baseFreq * semis(p.note);
    const end = time + p.decay + 0.05;

    // morph 0..1 sweeps across the 4 tables via two crossfaded oscillators
    const m = p.morph * (this.waves.length - 1);
    const ia = Math.min(this.waves.length - 1, Math.floor(m));
    const ib = Math.min(this.waves.length - 1, ia + 1);
    const frac = m - ia;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.res;
    filter.frequency.setValueAtTime(Math.min(12000, p.cutoff * 3), time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(60, p.cutoff * 0.4),
      time + p.decay
    );

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain * 0.55, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, end);

    for (const [idx, amp] of [
      [ia, 1 - frac],
      [ib, frac],
    ] as Array<[number, number]>) {
      if (amp < 0.01) continue;
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(this.waves[idx]);
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g);
      g.connect(filter);
      osc.start(time);
      osc.stop(end);
    }
    filter.connect(env);
    this.engine.routeHit(env, p.delaySend);
  }
}
