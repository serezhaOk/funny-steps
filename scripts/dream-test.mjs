import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:5214/');
await page.click('#boot-btn');
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });

// one tap -> REVERIE (dream init incl. reverb generate)
await page.click('#sample');
await page.waitForFunction(
  () => document.getElementById('sample').textContent === 'REVERIE' &&
        !document.getElementById('sample').classList.contains('loading'),
  { timeout: 10000 }
);
console.log('VOICE:', await page.$eval('#sample', (e) => e.textContent));

// paint some notes and let the dream play for 2 bars
const box = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
for (const [fx, fy] of [[0.2,0.15],[0.5,0.3],[0.7,0.5],[0.35,0.7],[0.85,0.85]]) {
  await page.mouse.click(box.x + box.w*fx, box.y + box.h*fy);
}
await page.waitForTimeout(4200);
console.log('FILLED:', await page.evaluate(() => window.__dbg.filled()));
console.log('CTX:', await page.evaluate(() => window.__dbg.ctx()));

// back to a sample voice, make sure switching is clean
await page.click('#sample');
await page.waitForTimeout(600);
console.log('NEXT_VOICE:', await page.$eval('#sample', (e) => e.textContent));
await page.waitForTimeout(1000);

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
