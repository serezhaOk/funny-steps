// Captures the colour ripple: fires one note and samples frames + pixel
// colours as the wave rolls yellow -> green -> violet -> white.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5232/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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
// Sign-in is faked at the DOM level: these suites test the machine, not auth.
await page.evaluate(() => {
  document.getElementById('signed-out').hidden = true;
  document.getElementById('signed-in').hidden = false;
});
await page.click('#enter-btn');
// Landing -> projects -> a fresh project boots the sequencer.
await page.waitForSelector('.p-empty, .p-card', { timeout: 15000 });
await page.click('.p-empty, .p-card');
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });

const dims = await page.evaluate(() => ({
  cols: window.__dbg.grid().cells.length / 16,
  cell: window.__dbg.grid().layout.cell,
}));
console.log('DIMS:', JSON.stringify(dims));

// quiet field, then one flash dead centre
await page.evaluate(() => {
  window.__dbg.transport.stop();
  window.__dbg.grid().clear();
  window.__dbg.grid().flash(8, 6, 1);
});

// sample the brightest non-grey pixel over time
const samples = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(45);
  const s = await page.evaluate(() => {
    const cv = document.getElementById('grid');
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let best = [0, 0, 0], bestSat = 0;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], gg = d[p + 1], b = d[p + 2], a = d[p + 3];
      if (a < 40) continue;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const sat = mx - mn;
      if (sat > bestSat) { bestSat = sat; best = [r, gg, b]; }
    }
    return { rgb: best, sat: bestSat };
  });
  samples.push(s);
  await page.screenshot({ path: `scripts/wave${i}.png` });
}
for (const [i, s] of samples.entries())
  console.log(`t=${((i + 1) * 0.045).toFixed(2)}s rgb=${s.rgb.join(',')} sat=${s.sat}`);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
