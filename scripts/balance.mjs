// Measures each voice on its own so REVERIE and MACHINE can be compared.
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://localhost:5254/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL);
// Sign-in is faked at the DOM level: these suites test the machine, not auth.
await page.evaluate(() => {
  document.getElementById('signed-out').hidden = true;
  document.getElementById('signed-in').hidden = false;
});
await page.click('#enter-btn');
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });

// only track 0 plays; identical pattern for every voice
await page.evaluate(() => {
  window.__dbg.tracks.forEach((t, i) => { t.muted = i !== 0; });
  const g = window.__dbg.tracks[0].grid;
  g.clear();
  for (let r = 0; r < 16; r += 2) g.brush(3 + (r % 5), r + 0.5);
  const ctx = window.__dbg.audio.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  window.__dbg.audio.output.connect(an);
  window.__an = an; window.__buf = new Float32Array(an.fftSize);
});
const rms = () => page.evaluate(async () => {
  let peak = 0; const until = performance.now() + 2600;
  while (performance.now() < until) {
    await new Promise((r) => setTimeout(r, 55));
    window.__an.getFloatTimeDomainData(window.__buf);
    let s = 0; for (const v of window.__buf) s += v * v;
    peak = Math.max(peak, Math.sqrt(s / window.__buf.length));
  }
  return Number(peak.toFixed(4));
});

// REVERIE re-rolls its timbre per note, so a single pass swings wildly —
// average a few runs per voice.
const REPEATS = 3;
const seen = [];
for (let i = 0; i < 4; i++) {
  const label = await page.$eval('#sample', (e) => e.textContent);
  const runs = [];
  for (let k = 0; k < REPEATS; k++) runs.push(await rms());
  const avg = runs.reduce((a, b) => a + b, 0) / runs.length;
  seen.push([label, Number(avg.toFixed(4)), runs.join('/')]);
  await page.click('#sample');
  await page.waitForFunction(
    () => !document.getElementById('sample').classList.contains('loading'),
    { timeout: 10000 }
  );
  await page.waitForTimeout(400);
}
for (const [l, v, runs] of seen) console.log(l.padEnd(9), 'avg', v, ' runs', runs);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
