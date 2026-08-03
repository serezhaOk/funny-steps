// Projects screen: both states, card menu, account menu, and that entering a
// project boots the sequencer with two track dots.
import { chromium } from 'playwright';
const URL = process.env.SMOKE_URL || 'http://localhost:5280/';
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

// Supabase is not reachable from this sandbox, so stub the network layer:
// listProjects() fails -> empty state, and creates fall back to local play.
await page.goto(URL);
await page.evaluate(() => window.__showProjects());
await page.waitForSelector('#projects:not([hidden])', { timeout: 15000 });

const empty = await page.evaluate(() => ({
  title: document.querySelector('.p-title').textContent,
  emptyCard: document.querySelector('.p-empty')?.textContent ?? null,
  createHidden: document.getElementById('create-new').hidden,
  font: getComputedStyle(document.querySelector('.p-title')).fontFamily,
  tracking: getComputedStyle(document.body).letterSpacing,
}));
console.log('EMPTY_STATE:', JSON.stringify(empty));
await page.screenshot({ path: 'scripts/projects-empty.png' });

// account menu
await page.click('#profile-btn');
const acct = await page.evaluate(() => !document.getElementById('p-account').hidden);
console.log('ACCOUNT_MENU:', acct);
await page.screenshot({ path: 'scripts/projects-account.png' });
await page.click('.p-title');

// fake two rows to exercise the populated state
await page.evaluate(() => {
  const cells = new Array(192).fill(0);
  cells[10] = 1;
  window.__setRows([
    { id: 'a', name: 'Motile Volvox', bpm: 120, root_pc: 9, scale: 'minor', tracks: [{ voiceIdx: 0, muted: false, cells }], updated_at: '' },
    { id: 'b', name: 'A long name blabla chekallo lorem ipsum', bpm: 128, root_pc: 2, scale: 'dorian', tracks: [], updated_at: '' },
  ]);
});
const listed = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.p-card .p-name')].map((n) => n.textContent),
  createVisible: !document.getElementById('create-new').hidden,
  card: (() => { const r = document.querySelector('.p-card').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) }; })(),
}));
console.log('LISTED:', JSON.stringify(listed));
await page.screenshot({ path: 'scripts/projects-list.png' });

// card menu
await page.click('.p-card .p-more');
const cardMenu = await page.evaluate(() => !document.getElementById('p-menu').hidden);
console.log('CARD_MENU:', cardMenu);
await page.screenshot({ path: 'scripts/projects-menu.png' });
await page.keyboard.press('Escape');
await page.mouse.click(200, 700);

// open the first project -> sequencer with two dots
await page.click('.p-card');
await page.waitForSelector('#app:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(400);
const seq = await page.evaluate(() => ({
  dots: document.querySelectorAll('#view-toggle span').length,
  activeDot: [...document.querySelectorAll('#view-toggle span')].findIndex((d) => d.classList.contains('on')),
  bpm: document.getElementById('bpm').textContent,
  filled: window.__dbg.filled(),
  ctx: window.__dbg.ctx(),
}));
console.log('SEQUENCER:', JSON.stringify(seq));
await page.screenshot({ path: 'scripts/projects-seq.png' });

const ok = empty.title === 'Projects' && /Create first project/.test(empty.emptyCard) &&
  empty.createHidden && /Manrope/.test(empty.font) && acct &&
  listed.cards.length === 2 && listed.createVisible && listed.card.x === 20 &&
  cardMenu && seq.dots === 2 && seq.activeDot === 0 && seq.ctx === 'running' &&
  seq.filled > 0;
if (!ok) console.log('FAIL: projects flow');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length || !ok ? 1 : 0);
