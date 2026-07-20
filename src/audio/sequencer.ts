// Lookahead sequencer (Chris Wilson's "A Tale of Two Clocks" pattern):
// a coarse setTimeout loop schedules precise Web Audio events ~120ms ahead.

import type { AudioEngine } from './engine';
import type { Pattern, Track } from '../state/pattern';
import { STEPS, stepParam, PARAM_DEFS } from '../state/pattern';
import { Chopper, Granular, Wavetable } from './voices';

const LOOKAHEAD_MS = 25;
const AHEAD_S = 0.12;

export class Sequencer {
  chopper: Chopper;
  granular: Granular;
  wavetable: Wavetable;

  private nextStepTime = 0;
  private nextStep = 0;
  private timer: number | null = null;
  onStep: ((step: number, time: number) => void) | null = null;

  constructor(private engine: AudioEngine, private pattern: Pattern) {
    this.chopper = new Chopper(engine);
    this.granular = new Granular(engine);
    this.wavetable = new Wavetable(engine);
  }

  setPattern(p: Pattern): void {
    this.pattern = p;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextStep = 0;
    this.nextStepTime = this.engine.now + 0.06;
    const loop = () => {
      while (this.nextStepTime < this.engine.now + AHEAD_S) {
        this.scheduleStep(this.nextStep, this.nextStepTime);
        this.advance();
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

  private stepDur(): number {
    return 60 / this.pattern.bpm / 4; // 16th notes
  }

  private advance(): void {
    this.nextStepTime += this.stepDur();
    this.nextStep = (this.nextStep + 1) % STEPS;
  }

  private scheduleStep(step: number, baseTime: number): void {
    const dur = this.stepDur();
    // swing pushes odd 16ths late
    const time = step % 2 === 1 ? baseTime + dur * this.pattern.swing : baseTime;
    this.onStep?.(step, time);

    for (const track of this.pattern.tracks) {
      const s = track.steps[step];
      if (!s.on) continue;
      if (s.prob < 1 && Math.random() > s.prob) continue;

      const params: Record<string, number> = {};
      for (const d of PARAM_DEFS[track.kind]) {
        params[d.id] = stepParam(track, step, d.id);
      }

      const hits = Math.max(1, Math.round(s.retrig));
      const sub = dur / hits;
      for (let h = 0; h < hits; h++) {
        this.fire(track, time + h * sub, params, sub);
      }
    }
  }

  private fire(
    track: Track,
    time: number,
    params: Record<string, number>,
    stepDur: number
  ): void {
    switch (track.kind) {
      case 'chop':
        this.chopper.trigger(time, params, track.gain);
        break;
      case 'grain':
        this.granular.trigger(time, params, track.gain, stepDur);
        break;
      case 'wave':
        this.wavetable.trigger(time, params, track.gain);
        break;
    }
  }
}
