// A device that has signed in before must open straight into the library,
// without the sign-in screen flashing past first — even when Supabase is
// unreachable (as it is in this sandbox).
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:5300/';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const errors = [];

const session = (ageSecs) =>
  JSON.stringify({
    access_token: 'header.payload.sig',
    refresh_token: 'stored-refresh-token',
    token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) - ageSecs + 3600,
    user: { id: '00000000-0000-0000-0000-000000000000', email: 'a@b.c' },
  });
const fakeSession = session(0);

/**
 * @param {string} key   which storage key the previous visit wrote to
 * @param {object} [opt] {value, refresh: 'down'|'rejected'}
 */
async function open(key, opt = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  if (opt.refresh === 'down') {
    await page.route('**/auth/v1/token*', (r) => r.abort('failed'));
  } else if (opt.refresh === 'rejected') {
    await page.route('**/auth/v1/token*', (r) =>
      r.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token: Already Used',
        }),
      })
    );
  }
  await page.goto(URL);
  if (key) {
    await page.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [key, opt.value ?? fakeSession]
    );
    await page.reload();
  }
  // Sample early: the point is that the sign-in screen is never shown at all.
  const early = await page.evaluate(() => ({
    landing: !document.getElementById('landing').hidden,
    projects: !document.getElementById('projects').hidden,
  }));
  await page.waitForTimeout(1500);
  const settled = await page.evaluate(() => ({
    landing: !document.getElementById('landing').hidden,
    projects: !document.getElementById('projects').hidden,
    migrated: !!localStorage.getItem('sqia-auth'),
    msg: document.getElementById('landing-msg').hidden
      ? ''
      : document.getElementById('landing-msg').textContent,
  }));
  await page.close();
  return { early, settled };
}

const cold = await open(null);
console.log('NO_SESSION:', JSON.stringify(cold));

const own = await open('sqia-auth');
console.log('CACHED_SESSION:', JSON.stringify(own));

const legacy = await open('sb-iayngkirvbjlsmgtymnl-auth-token');
console.log('LEGACY_SESSION:', JSON.stringify(legacy));

// An hour-old token has to be refreshed. If that request cannot reach the
// server, nothing has said the sign-in is bad — stay in the library.
const expired = session(2 * 3600);
const down = await open('sqia-auth', { value: expired, refresh: 'down' });
console.log('REFRESH_UNREACHABLE:', JSON.stringify(down));

// A server that actually rejects the token does sign the user out, and the
// reason has to reach the screen instead of vanishing.
const rejected = await open('sqia-auth', {
  value: expired,
  refresh: 'rejected',
});
console.log('REFRESH_REJECTED:', JSON.stringify(rejected));

const manifest = await (async () => {
  const page = await browser.newPage();
  const res = await page.goto(new global.URL('/manifest.webmanifest', URL).href);
  const body = await res.json();
  const icons = [];
  for (const i of body.icons) {
    const r = await page.goto(new global.URL(i.src, URL).href);
    icons.push([i.src, r.status()]);
  }
  await page.close();
  return { display: body.display, icons };
})();
console.log('MANIFEST:', JSON.stringify(manifest));

const ok =
  cold.early.landing &&
  !own.early.landing &&
  own.early.projects &&
  !legacy.early.landing &&
  legacy.settled.migrated &&
  !down.settled.landing &&
  down.settled.projects &&
  rejected.settled.landing &&
  /Already Used/.test(rejected.settled.msg) &&
  manifest.display === 'standalone' &&
  manifest.icons.every(([, s]) => s === 200);
if (!ok) console.log('FAIL: session persistence');
console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
