import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5210/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto(URL);
await page.click('#boot-btn');
// wait for sample decode + app
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
await page.waitForTimeout(500);

const boot = await page.evaluate(() => ({
  bootErr: document.getElementById('boot-err').hidden
    ? null
    : document.getElementById('boot-err').textContent,
  ctx: window.__dbg?.ctx(),
  labels: {
    bpm: document.getElementById('bpm').textContent,
    root: document.getElementById('root').textContent,
    scale: document.getElementById('scale').textContent,
    sample: document.getElementById('sample').textContent,
  },
}));
console.log('BOOT:', JSON.stringify(boot));

// paint by tapping the canvas center
const box = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
await page.waitForTimeout(100);
const filledAfterPaint = await page.evaluate(() => window.__dbg.filled());
console.log('FILLED_AFTER_PAINT:', filledAfterPaint);

// playhead advances?
const s1 = await page.evaluate(() => window.__dbg.transport.playing);
await page.waitForTimeout(600);
// rndm fills several
await page.click('#rndm');
await page.waitForTimeout(50);
const filledAfterRndm = await page.evaluate(() => window.__dbg.filled());
console.log('PLAYING:', s1, 'FILLED_AFTER_RNDM:', filledAfterRndm);

// cycle scale + root + sample
await page.click('#root');
await page.click('#scale');
const labels2 = await page.evaluate(() => ({
  root: document.getElementById('root').textContent,
  scale: document.getElementById('scale').textContent,
}));
console.log('AFTER_CYCLE:', JSON.stringify(labels2));

// erase toggle + erase a region
await page.click('#erase');
const eraseActive = await page.$eval('#erase', (e) => e.classList.contains('active'));
await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
await page.waitForTimeout(50);
const filledAfterErase = await page.evaluate(() => window.__dbg.filled());
console.log('ERASE_ACTIVE:', eraseActive, 'FILLED_AFTER_ERASE:', filledAfterErase);

await page.screenshot({ path: 'scripts/shot.png' });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || boot.bootErr ? 1 : 0);
