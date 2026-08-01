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
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL);
await page.click('#boot-btn');
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
