import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ root: process.cwd() });
await server.listen(5199);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto('http://localhost:5199/');
await page.click('#boot-btn');
await page.waitForTimeout(500);

const state = await page.evaluate(() => ({
  appVisible: !document.getElementById('app').hidden,
  pads: document.querySelectorAll('.pad').length,
  playing: document.querySelector('.play-btn').classList.contains('playing'),
  tracks: document.querySelectorAll('#tracks button').length,
  sliders: document.querySelectorAll('#sliders label').length,
}));
console.log('STATE:', JSON.stringify(state));

// let it run two bars, check playhead moves
await page.waitForTimeout(1200);
const ph1 = await page.evaluate(() =>
  [...document.querySelectorAll('.pad')].findIndex((p) => p.classList.contains('playhead'))
);
await page.waitForTimeout(300);
const ph2 = await page.evaluate(() =>
  [...document.querySelectorAll('.pad')].findIndex((p) => p.classList.contains('playhead'))
);
console.log('PLAYHEAD:', ph1, '->', ph2);

// switch to GRAIN track, tweak a param, toggle a pad
await page.evaluate(() => document.querySelectorAll('#tracks button')[1].click());
await page.waitForTimeout(200);
const grainState = await page.evaluate(() => ({
  title: document.getElementById('params-title').textContent,
  sliders: document.querySelectorAll('#sliders label').length,
}));
console.log('GRAIN:', JSON.stringify(grainState));

// toggle pad 0 on grain track
await page.evaluate(() => {
  const pad = document.querySelectorAll('.pad')[0];
  pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
});
const padOn = await page.evaluate(() =>
  document.querySelectorAll('.pad')[0].classList.contains('on')
);
console.log('PAD_TOGGLED:', padOn);

// wavetable tab hides sample tools
await page.evaluate(() => document.querySelectorAll('#tracks button')[2].click());
const waveHidden = await page.evaluate(() => document.getElementById('sample-tools').hidden);
console.log('WAVE_HIDES_SAMPLER:', waveHidden);

// audio context actually running + time advancing?
await page.waitForTimeout(400);
await page.screenshot({ path: 'scripts/app.png' });

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
