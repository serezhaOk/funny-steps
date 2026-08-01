// Four-track checks: each track sounds, mute silences one, the mixer opens
// and tapping a quadrant makes that track active. Also samples the frame rate
// with all four playing.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5250/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL);
await page.click('#boot-btn');
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });

const box = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

// analyser on the master bus
await page.evaluate(() => {
  const ctx = window.__dbg.audio.ctx;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  window.__dbg.audio.output.connect(an);
  window.__an = an; window.__buf = new Float32Array(an.fftSize);
});
const rms = (secs) => page.evaluate(async (secs) => {
  let peak = 0; const until = performance.now() + secs * 1000;
  while (performance.now() < until) {
    await new Promise((r) => setTimeout(r, 60));
    window.__an.getFloatTimeDomainData(window.__buf);
    let s = 0; for (const v of window.__buf) s += v * v;
    peak = Math.max(peak, Math.sqrt(s / window.__buf.length));
  }
  return Number(peak.toFixed(4));
}, secs);

// Fill all four tracks via the mixer round trip
for (let i = 0; i < 4; i++) {
  await page.evaluate((i) => window.__dbg.tracks[i].grid.random(), i);
}
const labels = await page.evaluate(() =>
  window.__dbg.tracks.map((t) => t.grid.hasNotes)
);
console.log('ALL_HAVE_NOTES:', JSON.stringify(labels));

const all = await rms(2.5);
// Muting every track must fall silent (the master limiter evens out peaks,
// so "more tracks = louder" is not a meaningful assertion).
await page.evaluate(() => window.__dbg.tracks.forEach((t) => (t.muted = true)));
await page.waitForTimeout(3000); // long synth tails + a 7s reverb decay
const muted = await rms(2);
await page.evaluate(() => window.__dbg.tracks.forEach((t) => (t.muted = false)));
const back = await rms(2.5);
console.log('RMS playing=', all, ' allMuted=', muted, ' unmuted=', back);

// open the mixer
await page.click('#view-toggle');
await page.waitForTimeout(600);
const inMixer = await page.evaluate(() => window.__dbg.mixer());
const slots = await page.$$eval('.slot .name', (ns) =>
  ns.filter((n) => !n.hidden).map((n) => n.textContent)
);
console.log('MIXER_OPEN:', inMixer, 'LABELS:', JSON.stringify(slots));
await page.screenshot({ path: 'scripts/mixer.png' });

// frame rate with four tracks live in the mixer
const fps = await page.evaluate(async () => {
  let n = 0; const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => { n++; performance.now() - t0 < 1500 ? requestAnimationFrame(tick) : res(); };
    requestAnimationFrame(tick);
  });
  return Math.round((n / (performance.now() - t0)) * 1000);
});
console.log('FPS_MIXER_4_TRACKS:', fps);

// tap the bottom-right quadrant -> track 3 becomes active and view goes full
await page.mouse.click(box.x + box.w * 0.75, box.y + box.h * 0.75);
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({
  active: window.__dbg.activeTrack(),
  mixer: window.__dbg.mixer(),
  label: document.getElementById('sample').textContent,
}));
console.log('AFTER_TAP:', JSON.stringify(after));
await page.screenshot({ path: 'scripts/full.png' });

const ok = all > 0.01 && muted < all * 0.45 && back > all * 0.3 &&
  inMixer && !after.mixer && after.active === 3;
if (!ok) console.log('FAIL: track/mixer behaviour');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || !ok ? 1 : 0);
