// AudioEngine: owns the AudioContext, master chain and FX sends.
// Chain: track gains -> masterBus -> crusher (worklet) -> limiter -> destination
// Send:  per-hit delaySend gain -> feedback delay -> masterBus

import crusherUrl from './worklets/crusher-processor.js?url';

export class AudioEngine {
  ctx!: AudioContext;
  masterBus!: GainNode;
  crusher: AudioWorkletNode | null = null;
  hasCrusher = false;
  delayIn!: GainNode;
  private started = false;

  async start(): Promise<void> {
    if (this.started) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.resume(); // must happen inside a user gesture on iOS

    this.masterBus = this.ctx.createGain();
    this.masterBus.gain.value = 0.85;

    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;

    // The bitcrusher is an AudioWorklet; some mobile browsers block/loading it
    // can fail. Keep it optional so the sequencer still plays without it.
    try {
      await this.ctx.audioWorklet.addModule(crusherUrl);
      this.crusher = new AudioWorkletNode(this.ctx, 'crusher-processor');
      this.masterBus.connect(this.crusher);
      this.crusher.connect(limiter);
      this.hasCrusher = true;
    } catch {
      this.masterBus.connect(limiter);
      this.hasCrusher = false;
    }
    limiter.connect(this.ctx.destination);

    // Dub delay send: delay with filtered feedback loop.
    this.delayIn = this.ctx.createGain();
    const delay = this.ctx.createDelay(2);
    delay.delayTime.value = 0.24; // dotted-ish at 150bpm, tweakable via FX panel
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.45;
    const fbFilter = this.ctx.createBiquadFilter();
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 2500;
    this.delayIn.connect(delay);
    delay.connect(fbFilter);
    fbFilter.connect(feedback);
    feedback.connect(delay);
    delay.connect(this.masterBus);
    this.delayNode = delay;
    this.feedbackGain = feedback;

    this.started = true;
  }

  delayNode!: DelayNode;
  feedbackGain!: GainNode;

  get now(): number {
    return this.ctx.currentTime;
  }

  setCrush(bits: number, reduction: number, wet: number): void {
    if (!this.crusher) return;
    const p = (name: string) => this.crusher!.parameters.get(name)!;
    p('bits').value = bits;
    p('reduction').value = reduction;
    p('wet').value = wet;
  }

  setDelay(time: number, feedback: number): void {
    this.delayNode.delayTime.setTargetAtTime(time, this.now, 0.05);
    this.feedbackGain.gain.setTargetAtTime(feedback, this.now, 0.05);
  }

  // Route a one-shot node into master + delay send at the given level.
  routeHit(node: AudioNode, delaySend: number): void {
    node.connect(this.masterBus);
    if (delaySend > 0.01) {
      const send = this.ctx.createGain();
      send.gain.value = delaySend;
      node.connect(send);
      send.connect(this.delayIn);
    }
  }
}
