import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5204/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});

await page.goto(URL);
await page.click('#boot-btn');
await page.waitForTimeout(600);

const state = await page.evaluate(() => ({
  appVisible: !document.getElementById('app').hidden,
  bootErr: document.getElementById('boot-err').hidden
    ? null
    : document.getElementById('boot-err').textContent,
  playing: document.querySelector('.play-btn').classList.contains('playing'),
  ctxState: window.__dbg?.ctxState,
}));
console.log('STATE:', JSON.stringify(state));

await page.waitForTimeout(900);
const ph = await page.evaluate(() =>
  [...document.querySelectorAll('.pad')].findIndex((p) =>
    p.classList.contains('playhead')
  )
);
console.log('PLAYHEAD_AT:', ph);
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || state?.bootErr ? 1 : 0);
