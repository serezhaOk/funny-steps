// Sample utilities: procedural default break, file decode, mic recording.

// Synthesize a 16-slot breakbeat-ish loop directly into an AudioBuffer so the
// machine makes noise before the user loads anything.
export function makeDefaultBreak(ctx: BaseAudioContext): AudioBuffer {
  const bpm = 150;
  const dur = (60 / bpm) * 4; // one bar
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(dur * sr), sr);
  const slot = dur / 16;

  const kick = (t: number) => {
    const f = 120 * Math.exp(-t * 30) + 45;
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 18);
  };
  const snare = (t: number) =>
    ((Math.random() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * 0.4) *
    Math.exp(-t * 25);
  const hat = (t: number) => (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.5;

  const hits: Array<[number, (t: number) => number, number]> = [];
  [0, 10].forEach((s) => hits.push([s, kick, 1]));
  [4, 12].forEach((s) => hits.push([s, snare, 0.9]));
  for (let s = 0; s < 16; s += 2) hits.push([s, hat, 0.5]);
  hits.push([7, snare, 0.4]);
  hits.push([15, hat, 0.8]);

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (const [s, fn, amp] of hits) {
      const start = Math.floor(s * slot * sr);
      const len = Math.min(Math.floor(0.22 * sr), data.length - start);
      for (let i = 0; i < len; i++) {
        data[start + i] += fn(i / sr) * amp * 0.8;
      }
    }
  }
  return buf;
}

export async function decodeFile(
  ctx: AudioContext,
  file: File
): Promise<AudioBuffer> {
  const ab = await file.arrayBuffer();
  return ctx.decodeAudioData(ab);
}

export class MicRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  async begin(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false },
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.recorder.start();
  }

  async finish(ctx: AudioContext): Promise<AudioBuffer> {
    const rec = this.recorder!;
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.chunks, { type: rec.mimeType });
    const ab = await blob.arrayBuffer();
    return ctx.decodeAudioData(ab);
  }
}
