// Walks every synth preset, plays a dense pattern for a few loops on each,
// and measures master-bus RMS so a silent or dying voice is caught.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5240/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
  if (m.type() === 'warning' && /polyphony|dropped/i.test(m.text()))
    errors.push('WARN: ' + m.text());
});

await page.goto(URL);
await page.click('#boot-btn');
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
await page.click('#rndm');

// analyser on the master bus
await page.evaluate(() => {
  const ctx = window.__dbg.audio.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  window.__dbg.audio.output.connect(an);
  window.__an = an;
  window.__buf = new Float32Array(an.fftSize);
});

const measure = (secs) =>
  page.evaluate(async (secs) => {
    let peak = 0;
    const until = performance.now() + secs * 1000;
    while (performance.now() < until) {
      await new Promise((r) => setTimeout(r, 60));
      window.__an.getFloatTimeDomainData(window.__buf);
      let sum = 0;
      for (const v of window.__buf) sum += v * v;
      peak = Math.max(peak, Math.sqrt(sum / window.__buf.length));
    }
    return Number(peak.toFixed(4));
  }, secs);

const SYNTH_COUNT = 5;
const results = [];
for (let i = 0; i < SYNTH_COUNT; i++) {
  const label = await page.$eval('#sample', (e) => e.textContent);
  // measure across ~2 loops (4s at 120bpm), split early vs late
  const early = await measure(2);
  const late = await measure(2.5);
  results.push({ label, early, late });
  console.log(`${label.padEnd(9)} early=${early} late=${late}`);
  if (i < SYNTH_COUNT - 1) {
    await page.click('#sample');
    await page.waitForFunction(
      () => !document.getElementById('sample').classList.contains('loading'),
      { timeout: 10000 }
    );
    await page.waitForTimeout(300);
  }
}

const dead = results.filter((r) => r.early < 0.004 || r.late < r.early * 0.08);
if (dead.length) console.log('FAIL silent/dying:', dead.map((d) => d.label).join(', '));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || dead.length ? 1 : 0);
