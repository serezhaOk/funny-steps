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
  // The sandbox blocks Supabase and Google Fonts; those are environmental.
  const t = m.text();
  if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(t))
    errors.push('CONSOLE: ' + t);
  if (m.type() === 'warning' && /polyphony|dropped/i.test(m.text()))
    errors.push('WARN: ' + m.text());
});

await page.goto(URL);
// No real session in the sandbox: jump straight to the library.
await page.evaluate(() => window.__showProjects());
// Landing -> projects -> a fresh project boots the sequencer.
await page.waitForSelector('.p-empty, .p-card', { timeout: 15000 });
await page.click('.p-empty, .p-card');
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

/** Pick the nth sound out of the bottom sheet. */
async function selectVoice(i) {
  await page.click('#sample');
  await page.waitForSelector('#voice-sheet:not([hidden])', { timeout: 5000 });
  await page.click(`#voice-list button:nth-child(${i + 1})`);
  await page.waitForFunction(
    () => !document.getElementById('sample').classList.contains('loading'),
    { timeout: 10000 }
  );
  await page.waitForTimeout(300);
}

await page.click('#sample');
await page.waitForSelector('#voice-sheet:not([hidden])', { timeout: 5000 });
const SYNTH_COUNT = await page.$$eval('#voice-list button', (b) => b.length);
await page.click('#sheet-back');

const results = [];
for (let i = 0; i < SYNTH_COUNT; i++) {
  await selectVoice(i);
  const label = await page.$eval('#sample', (e) => e.textContent);
  // measure across ~2 loops (4s at 120bpm), split early vs late
  const early = await measure(2);
  const late = await measure(2.5);
  results.push({ label, early, late });
  console.log(`${label.padEnd(9)} early=${early} late=${late}`);
}

const dead = results.filter((r) => r.early < 0.004 || r.late < r.early * 0.08);
if (dead.length) console.log('FAIL silent/dying:', dead.map((d) => d.label).join(', '));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || dead.length ? 1 : 0);
