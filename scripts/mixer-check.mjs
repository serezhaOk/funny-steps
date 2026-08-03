// Mixer view against the mockup (Figma 137:764, 375x812): two panels side by
// side, name + mute inside each, "Back to projects" pinned to the bottom.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5300/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL);
await page.evaluate(() => window.__showProjects());
await page.waitForSelector('.p-empty, .p-card', { timeout: 15000 });
await page.click('.p-empty, .p-card');
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });

// Both tracks need a part, otherwise their labels stay hidden.
await page.evaluate(() => window.__dbg.tracks.forEach((t) => t.grid.random()));

// The footer must still take taps while the mixer is closed.
await page.click('#rndm');

const stage = await page.$eval('#grid', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y };
});

await page.click('#view-toggle');
await page.waitForTimeout(600);

const geom = await page.evaluate(() => {
  const r = (el) => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  };
  const slots = [...document.querySelectorAll('.slot')];
  const tile = document.getElementById('save-tile');
  return {
    panels: window.__dbg.panels(),
    slots: slots.map((s) => r(s)),
    names: slots.map((s) => s.querySelector('.name').textContent),
    tile: r(tile),
    tileText: tile.textContent,
    tileRadius: getComputedStyle(tile).borderRadius,
  };
});
console.log('GEOM:', JSON.stringify(geom, null, 1));

await page.screenshot({ path: 'scripts/mixer.png' });

// Tapping a panel opens that track full screen.
const p = geom.panels[1];
await page.mouse.click(stage.x + p[0] + p[2] / 2, stage.y + p[1] + 20);
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({
  active: window.__dbg.activeTrack(),
  mixer: window.__dbg.mixer(),
}));
console.log('AFTER_TAP:', JSON.stringify(after));
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || after.active !== 1 || after.mixer ? 1 : 0);
