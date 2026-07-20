// Bitcrusher + sample-rate reducer. Lo-fi dirt on the master bus.
class CrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16 },
      { name: 'reduction', defaultValue: 1, minValue: 1, maxValue: 50 },
      { name: 'wet', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.held = [0, 0];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const bits = parameters.bits[0];
    const reduction = Math.max(1, Math.floor(parameters.reduction[0]));
    const wet = parameters.wet[0];
    const levels = Math.pow(2, bits);

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || input[0];
      const out = output[ch];
      let phase = this.phase;
      let held = this.held[ch] || 0;
      for (let i = 0; i < out.length; i++) {
        if (phase % reduction === 0) {
          held = Math.round(inp[i] * levels) / levels;
        }
        phase++;
        out[i] = inp[i] * (1 - wet) + held * wet;
      }
      this.held[ch] = held;
      if (ch === output.length - 1) this.phase = phase;
    }
    return true;
  }
}

registerProcessor('crusher-processor', CrusherProcessor);
