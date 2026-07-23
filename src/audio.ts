// Audio engine: sample loading/caching, one-shot playback with a short
// envelope, and a lookahead transport that ticks 16 steps in a loop.

const LOOKAHEAD_MS = 25;
const AHEAD_S = 0.12;

export class Audio {
  ctx!: AudioContext;
  private master!: GainNode;
  private delayIn!: GainNode;
  private cache = new Map<string, AudioBuffer>();
  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.resume(); // inside the user gesture (iOS)

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    this.master.connect(limiter);
    limiter.connect(this.ctx.destination);

    // Barely-there space: a quiet, darkened slap delay every sample hit
    // feeds into. Subtle by design — felt more than heard.
    this.delayIn = this.ctx.createGain();
    this.delayIn.gain.value = 0.16;
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.17;
    const damp = this.ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.28;
    this.delayIn.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(this.master);

    this.started = true;
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  // Master bus (pre-limiter) — external voices route into this.
  get output(): GainNode {
    return this.master;
  }

  async load(file: string): Promise<AudioBuffer> {
    const cached = this.cache.get(file);
    if (cached) return cached;
    const url = `${import.meta.env.BASE_URL}samples/${file}`;
    const res = await fetch(url);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    this.cache.set(file, buf);
    return buf;
  }

  // Fire a pitched one-shot with a soft attack/decay so retriggers stay clean.
  // relScale (0..1) scales the tail so no two hits ring identically.
  trigger(
    buffer: AudioBuffer,
    rate: number,
    gain: number,
    time: number,
    relScale = 1
  ): void {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const env = this.ctx.createGain();
    const rel = Math.max(0.08, Math.min(1.5, buffer.duration / rate) * relScale);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, time + rel);

    src.connect(env);
    env.connect(this.master);
    env.connect(this.delayIn);
    src.start(time);
    src.stop(time + rel + 0.05);
  }
}

export class Transport {
  bpm = 120;
  steps = 16;
  onStep: ((step: number, time: number) => void) | null = null;

  private timer: number | null = null;
  private nextStep = 0;
  private nextTime = 0;

  constructor(private audio: Audio) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  private stepDur(): number {
    // 16 steps per bar of 4 beats -> a step is a 16th note.
    return 60 / this.bpm / 4;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextStep = 0;
    this.nextTime = this.audio.now + 0.08;
    const loop = () => {
      while (this.nextTime < this.audio.now + AHEAD_S) {
        this.onStep?.(this.nextStep, this.nextTime);
        this.nextTime += this.stepDur();
        this.nextStep = (this.nextStep + 1) % this.steps;
      }
      this.timer = window.setTimeout(loop, LOOKAHEAD_MS);
    };
    loop();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
