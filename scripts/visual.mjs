import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://localhost:5218/';
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
await page.click('#rndm');
await page.waitForTimeout(900);

// grab a few frames mid-playback to catch blooms
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(260);
  await page.screenshot({ path: `scripts/vis${i}.png` });
}

// verify hit-test still lands where you tap despite the lens
const box = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.evaluate(() => window.__dbg.grid().clear());
// tap a known cell centre (col 2, row 4) through the forward warp
const probe = await page.evaluate(({ }) => {
  const g = window.__dbg.grid();
  const L = g.layout ?? null;
  return L;
}, {});
await page.mouse.click(box.x + box.w * 0.25, box.y + box.h * 0.25);
const after = await page.evaluate(() => {
  const g = window.__dbg.grid();
  const out = [];
  for (let r = 0; r < 16; r++) for (let c = 0; c < 10; c++) {
    const v = g.cells[r * 10 + c];
    if (v >= 0.999) out.push([r, c]);
  }
  return out;
});
console.log('TAP_AT_25%_FULLCELLS:', JSON.stringify(after), 'probe:', probe ? 'layout-exposed' : 'n/a');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
