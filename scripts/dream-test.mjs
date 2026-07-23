// Regression test for the "REVERIE goes silent on the second loop" bug:
// run the dream voice for ~6 loops and assert the master bus still carries
// energy in the late loops (not just the first one).
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5216/';
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
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });

// switch to REVERIE (one tap) and wait until initialized
await page.click('#sample');
await page.waitForFunction(
  () =>
    document.getElementById('sample').textContent === 'REVERIE' &&
    !document.getElementById('sample').classList.contains('loading'),
  { timeout: 10000 }
);
console.log('VOICE:', await page.$eval('#sample', (e) => e.textContent));

// dense pattern
await page.click('#rndm');
console.log('FILLED:', await page.evaluate(() => window.__dbg.filled()));

// attach analyser to the master bus and sample RMS once per second for 12s
// (~6 loops at 120bpm) — the bug killed output by loop 2 (t≈2-4s).
const rms = await page.evaluate(async () => {
  const dbg = window.__dbg;
  const ctx = dbg.audio.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  dbg.audio.output.connect(an);
  const buf = new Float32Array(an.fftSize);
  const out = [];
  for (let s = 0; s < 12; s++) {
    let peak = 0;
    // sample the window a few times per second, keep the peak RMS
    for (let k = 0; k < 8; k++) {
      await new Promise((r) => setTimeout(r, 125));
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
    }
    out.push(Number(peak.toFixed(4)));
  }
  return out;
});
console.log('RMS_PER_SEC:', JSON.stringify(rms));

const early = Math.max(...rms.slice(0, 3));
const late = Math.max(...rms.slice(6));
console.log('EARLY_PEAK:', early, 'LATE_PEAK:', late);

const silentLate = late < early * 0.1 || late < 0.001;
if (silentLate) console.log('FAIL: output died in later loops');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || silentLate ? 1 : 0);
