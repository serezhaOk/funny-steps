// The landing screen is the front door: no session, no sequencer.
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://localhost:5270/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL);
await page.waitForTimeout(900); // let initAuth settle

const state = await page.evaluate(() => ({
  landing: !document.getElementById('landing').hidden,
  app: !document.getElementById('app').hidden,
  signedOut: !document.getElementById('signed-out').hidden,
  signedIn: !document.getElementById('signed-in').hidden,
  wordmark: document.querySelector('.wordmark').textContent,
  tagline: document.querySelector('.tagline').textContent.trim(),
}));
console.log('LANDING:', JSON.stringify(state));
await page.screenshot({ path: 'scripts/landing.png' });

// email flow reveals the field and validates it
await page.click('#email-btn');
const revealed = await page.evaluate(() => !document.getElementById('email-form').hidden);
await page.fill('#email-input', 'nope');
await page.evaluate(() => document.getElementById('email-form').requestSubmit());
await page.waitForTimeout(200);
const msg = await page.$eval('#landing-msg', (e) => e.textContent);
console.log('EMAIL: revealed=', revealed, ' msg=', JSON.stringify(msg));
await page.screenshot({ path: 'scripts/landing-email.png' });

// "What is SQIA?" toggles the blurb
await page.click('#about-btn');
const about = await page.evaluate(() => !document.getElementById('about-text').hidden);
console.log('ABOUT_TOGGLES:', about);

// a fake session must flip the landing to its signed-in face
await page.evaluate(() => {
  document.getElementById('signed-out').hidden = true;
  document.getElementById('signed-in').hidden = false;
});
await page.click('#enter-btn');
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
const entered = await page.evaluate(() => ({
  app: !document.getElementById('app').hidden,
  landing: !document.getElementById('landing').hidden,
  ctx: window.__dbg?.ctx(),
}));
console.log('AFTER_ENTER:', JSON.stringify(entered));

const ok = state.landing && !state.app && state.signedOut && !state.signedIn &&
  state.wordmark === 'SQIA' && revealed && /valid email/i.test(msg) &&
  about && entered.app && !entered.landing && entered.ctx === 'running';
if (!ok) console.log('FAIL: landing flow');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || !ok ? 1 : 0);
