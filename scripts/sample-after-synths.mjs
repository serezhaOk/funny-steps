// After the five synths the cycle reaches the sample pack: make sure the
// first sample voice actually loads and sounds.
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://localhost:5244/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
// The sandbox blocks Supabase and Google Fonts; those failures are
// environmental, not app bugs.
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(t))
    errors.push('CONSOLE: ' + t);
});

await page.goto(URL);
// No real session in the sandbox: jump straight to the library.
await page.evaluate(() => window.__showProjects());
// Landing -> projects -> a fresh project boots the sequencer.
await page.waitForSelector('.p-empty, .p-card', { timeout: 15000 });
await page.click('.p-empty, .p-card');
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
await page.click('#rndm');

for (let i = 0; i < 5; i++) {
  await page.click('#sample');
  await page.waitForFunction(
    () => !document.getElementById('sample').classList.contains('loading'),
    { timeout: 15000 }
  );
}
const label = await page.$eval('#sample', (e) => e.textContent);

const rms = await page.evaluate(async () => {
  const ctx = window.__dbg.audio.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  window.__dbg.audio.output.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  const until = performance.now() + 2500;
  while (performance.now() < until) {
    await new Promise((r) => setTimeout(r, 60));
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    peak = Math.max(peak, Math.sqrt(s / buf.length));
  }
  return Number(peak.toFixed(4));
});
console.log('SAMPLE_VOICE:', label, 'rms=', rms);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || rms < 0.004 ? 1 : 0);
