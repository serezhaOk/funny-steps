// Low end must not reach the reverb: a kick smeared over a seven-second tail
// is what turns a mix to mud.
//
// Measured as an A/B on the same signal — the low band entering the reverb
// with the send filter open versus at its real corner. Two things this test
// learned the hard way: a share-of-spectrum figure will not do, because a
// kick has almost no high end and the ratio stays high even when the low end
// is well down; and the tap has to sit at the reverb's input, because seven
// seconds of tail at its output carries the previous pass into the next one.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5300/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL);
await page.evaluate(() => window.__showProjects());
await page.waitForSelector('.p-empty, .p-card', { timeout: 15000 });
await page.click('.p-empty, .p-card');
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
await page.waitForTimeout(400);

/**
 * Low-band power reaching the reverb for `voice`, with the send filter
 * forced to `hz`. Reaches into the chain directly — privacy is compile-time
 * only, and an A/B needs to move the corner the app does not expose.
 */
async function lowAtReverb(voice, midi, hz, splitHz) {
  return page.evaluate(
    async ([voice, midi, hz, splitHz]) => {
      const { synths, audio } = window.__dbg;
      const ctx = audio.ctx;
      // Chains are built lazily on first use.
      synths.trigger(voice, midi, 1, ctx.currentTime + 0.02);
      await new Promise((r) => setTimeout(r, 60));
      const chain = synths.chains.get(voice);
      const restore = chain.sendHp.frequency.value;
      chain.sendHp.frequency.value = hz;

      const an = ctx.createAnalyser();
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0;
      chain.sendHp.connect(an);
      const bins = new Float32Array(an.frequencyBinCount);
      const binHz = ctx.sampleRate / 2 / an.frequencyBinCount;

      let peak = 0;
      const until = performance.now() + 2400;
      while (performance.now() < until) {
        synths.trigger(voice, midi, 1, ctx.currentTime + 0.02);
        await new Promise((r) => setTimeout(r, 170));
        an.getFloatFrequencyData(bins);
        let low = 0;
        for (let i = 1; i * binHz < splitHz; i++) {
          low += Math.pow(10, bins[i] / 10);
        }
        peak = Math.max(peak, low);
      }
      an.disconnect();
      chain.sendHp.frequency.value = restore;
      return peak;
    },
    [voice, midi, hz, splitHz]
  );
}

const db = (a, b) => (10 * Math.log10(b / a)).toFixed(1);
const results = [];

for (const [voice, midi, split, corner] of [
  ['machine', 36, 380, 380], // kick
  ['acid', 40, 320, 320], // bass
  ['rhodes', 45, 220, 220], // low keys
]) {
  const open = await lowAtReverb(voice, midi, 20, split);
  const filtered = await lowAtReverb(voice, midi, corner, split);
  const cut = Number(db(filtered, open));
  results.push({ voice, cut });
  console.log(
    `${voice.padEnd(8)} low band into reverb: ${cut} dB down at ${corner}Hz`
  );
}

// The dry path must keep its bottom — only the send is filtered.
const dryLow = await page.evaluate(async () => {
  const { synths, audio } = window.__dbg;
  const ctx = audio.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 4096;
  an.smoothingTimeConstant = 0;
  audio.output.connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const binHz = ctx.sampleRate / 2 / an.frequencyBinCount;
  let peak = 0;
  const until = performance.now() + 1600;
  while (performance.now() < until) {
    synths.trigger('machine', 36, 1, ctx.currentTime + 0.02);
    await new Promise((r) => setTimeout(r, 170));
    an.getFloatFrequencyData(bins);
    let low = 0;
    for (let i = 1; i * binHz < 380; i++) low += Math.pow(10, bins[i] / 10);
    peak = Math.max(peak, low);
  }
  an.disconnect();
  return peak;
});
console.log('kick low band on the dry master:', dryLow.toExponential(2));

const ok =
  results.every((r) => r.cut >= 12) &&
  // a floor well above the analyser's noise: the kick still has its weight
  dryLow > 1e-4;
if (!ok) console.log('FAIL: reverb send is still taking low end');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
