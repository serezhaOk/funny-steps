// The sign-up sheet gates tempo, key and saving while signed out.
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://localhost:5260/';
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

const sheetOpen = () => page.evaluate(() => !document.getElementById('auth').hidden);
const bpmText = () => page.$eval('#bpm', (e) => e.textContent);
const keyText = () => page.$eval('#root', (e) => e.textContent);

console.log('SHEET_AT_BOOT:', await sheetOpen());

// key change is gated
const key0 = await keyText();
await page.click('#root');
await page.waitForTimeout(200);
const gatedKey = await sheetOpen();
const key1 = await keyText();
console.log('KEY: sheet=', gatedKey, ' unchanged=', key0 === key1);
await page.screenshot({ path: 'scripts/auth.png' });

// close and try tempo
await page.click('#auth-close');
await page.waitForTimeout(150);
const bpm0 = await bpmText();
await page.click('#bpm');
await page.waitForTimeout(200);
const gatedBpm = await sheetOpen();
const bpm1 = await bpmText();
console.log('BPM: sheet=', gatedBpm, ' unchanged=', bpm0 === bpm1);

// close, open mixer, hit save tile
await page.click('#auth-close');
await page.waitForTimeout(150);
await page.click('#view-toggle');
await page.waitForTimeout(500);
await page.screenshot({ path: 'scripts/mixer-save.png' });
await page.click('#save-tile');
await page.waitForTimeout(250);
const gatedSave = await sheetOpen();
console.log('SAVE_TILE: sheet=', gatedSave);
await page.screenshot({ path: 'scripts/save-tile.png' });

// email validation path (no network round trip needed for the bad case)
await page.fill('#auth-email', 'nope');
await page.evaluate(() =>
  document.getElementById('auth-email-form').requestSubmit()
);
await page.waitForTimeout(200);
const msg = await page.$eval('#auth-msg', (e) => e.textContent);
console.log('BAD_EMAIL_MSG:', JSON.stringify(msg));

// painting must still work with the sheet closed — leave the mixer first
await page.click('#auth-close');
await page.waitForTimeout(150);
const box = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.25); // pick a track
await page.waitForTimeout(500);
await page.mouse.click(box.x + box.w * 0.5, box.y + box.h * 0.4);
const painted = await page.evaluate(() => window.__dbg.filled());
console.log('PAINT_STILL_WORKS:', painted > 0);

const ok = gatedKey && key0 === key1 && gatedBpm && bpm0 === bpm1 &&
  gatedSave && /valid email/i.test(msg) && painted > 0;
if (!ok) console.log('FAIL: auth gating');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || !ok ? 1 : 0);
