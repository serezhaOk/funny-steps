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
// The sandbox blocks Supabase and Google Fonts; those failures are
// environmental, not app bugs.
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(t))
    errors.push('CONSOLE: ' + t);
});

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

// "What is SQIA?" points at the reel and opens in a new tab
const about = await page.evaluate(() => {
  const a = document.getElementById('about-btn');
  return { href: a.getAttribute('href'), target: a.getAttribute('target') };
});
console.log('ABOUT_LINK:', JSON.stringify(about));

// a fake session must flip the landing to its signed-in face
await page.evaluate(() => {
  document.getElementById('signed-out').hidden = true;
  document.getElementById('signed-in').hidden = false;
});
await page.click('#enter-btn');
// Enter now lands on the projects library, not straight in the sequencer.
await page.waitForSelector('#projects:not([hidden])', { timeout: 15000 });
const entered = await page.evaluate(() => ({
  projects: !document.getElementById('projects').hidden,
  landing: !document.getElementById('landing').hidden,
  ctx: window.__dbg?.ctx(),
}));
console.log('AFTER_ENTER:', JSON.stringify(entered));

const ok = state.landing && !state.app && state.signedOut && !state.signedIn &&
  state.wordmark === 'SQIA' && revealed && /valid email/i.test(msg) &&
  /instagram\.com\/reel\//.test(about.href) && about.target === '_blank' && entered.projects && !entered.landing && entered.ctx === 'running';
if (!ok) console.log('FAIL: landing flow');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || !ok ? 1 : 0);
