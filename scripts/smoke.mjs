import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5212/';
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
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
await page.waitForTimeout(400);

const boot = await page.evaluate(() => ({
  bootErr: document.getElementById('boot-err').hidden
    ? null
    : document.getElementById('boot-err').textContent,
  ctx: window.__dbg?.ctx(),
  sample: document.getElementById('sample').textContent,
}));
console.log('BOOT:', JSON.stringify(boot));

const box = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});

// Drag diagonally across a few cells -> organic brush trail.
await page.mouse.move(box.x + box.w * 0.25, box.y + box.h * 0.3);
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(
    box.x + box.w * (0.25 + 0.05 * i),
    box.y + box.h * (0.3 + 0.03 * i)
  );
  await page.waitForTimeout(10);
}
await page.mouse.up();

const dist = await page.evaluate(() => {
  const cells = window.__dbg.grid.cells;
  let full = 0;
  let partial = 0;
  for (const v of cells) {
    if (v >= 0.999) full++;
    else if (v > 0) partial++;
  }
  return { full, partial };
});
console.log('BRUSH:', JSON.stringify(dist));

// cycle a couple samples (loads new wavs over the network)
await page.click('#sample');
await page.waitForTimeout(300);
await page.click('#sample');
await page.waitForTimeout(400);
const s2 = await page.evaluate(
  () => document.getElementById('sample').textContent
);
console.log('SAMPLE_AFTER_CYCLE:', s2);

await page.click('#rndm');
await page.waitForTimeout(50);
const rnd = await page.evaluate(() => window.__dbg.filled());
console.log('FILLED_AFTER_RNDM:', rnd);

await page.screenshot({ path: 'scripts/shot.png' });
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(
  errors.length || boot.bootErr || dist.partial === 0 || dist.full === 0 ? 1 : 0
);
