// The per-bar patch drift must not be audible as a glitch at the turn of
// the loop: changes land on the downbeat rather than a lookahead early, and
// the echo is only retimed while it is muted.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5300/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL);
await page.evaluate(() => window.__showProjects());
await page.waitForSelector('.p-empty, .p-card', { timeout: 15000 });
await page.click('.p-empty, .p-card');
await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
await page.waitForTimeout(500);

// A patch change scheduled half a second out must not take effect now.
const anchored = await page.evaluate(async () => {
  const { synths, audio } = window.__dbg;
  synths.trigger('reverie', 60, 0.8, audio.ctx.currentTime); // builds the chain
  const before = synths.snapshot('reverie');
  synths.tick('reverie', 0, 120, audio.ctx.currentTime + 0.8);
  // Sample midway to the downbeat. A ramp started at "now" would already be
  // moving here; one anchored to the downbeat has not begun.
  await new Promise((r) => setTimeout(r, 400));
  const midway = synths.snapshot('reverie');
  await new Promise((r) => setTimeout(r, 1800));
  const later = synths.snapshot('reverie');
  return {
    cutoffBefore: Math.round(before.cutoff),
    cutoffMidway: Math.round(midway.cutoff),
    cutoffLater: Math.round(later.cutoff),
    fbBefore: +before.feedback.toFixed(3),
    fbMidway: +midway.feedback.toFixed(3),
  };
});
console.log('ANCHORED:', JSON.stringify(anchored));

// Across many bars the echo should be retimed rarely, and every time it is,
// the delay must be muted through the change.
const echo = await page.evaluate(async () => {
  const { synths, audio } = window.__dbg;
  let changes = 0;
  let worstWet = 1; // lowest wet seen while an echo change was in flight
  let unmuted = 0; // changes that happened with the delay still audible
  for (let bar = 0; bar < 40; bar++) {
    const before = synths.snapshot('reverie').echo;
    const at = audio.ctx.currentTime + 0.25;
    synths.tick('reverie', 0, 120, at);
    const after = synths.snapshot('reverie').echo;
    if (after !== before) {
      changes++;
      let low = 1;
      while (audio.ctx.currentTime < at + 0.02) {
        low = Math.min(low, synths.snapshot('reverie').wet);
        await new Promise((r) => setTimeout(r, 8));
      }
      worstWet = Math.min(worstWet, low);
      if (low > 0.02) unmuted++;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  const settled = synths.snapshot('reverie');
  return {
    bars: 40,
    changes,
    unmuted,
    quietestWet: +worstWet.toFixed(4),
    wetRestored: +settled.wet.toFixed(3),
  };
});
console.log('ECHO:', JSON.stringify(echo));

const ok =
  // the ramp waited for its scheduled time...
  anchored.cutoffMidway === anchored.cutoffBefore &&
  anchored.fbMidway === anchored.fbBefore &&
  // ...and then actually happened
  anchored.cutoffLater !== anchored.cutoffBefore &&
  // retimed sometimes, but nowhere near every bar
  echo.changes > 0 &&
  echo.changes < echo.bars / 2 &&
  // and never while the echoes were audible
  echo.unmuted === 0 &&
  echo.wetRestored > 0.05;
if (!ok) console.log('FAIL: bar-boundary patch drift');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
