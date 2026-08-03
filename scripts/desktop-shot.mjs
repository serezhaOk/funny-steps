import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const rows = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'p' + i, name: ['Vorticella','Choanoflagellate','Motile Volvox','Stentor','A long name blabla chekallo lorem ipsum'][i % 5],
  bpm: 120, root_pc: 9, scale: 'minor', tracks: [], updated_at: '',
}));

for (const [w, h, tag, n] of [[1280, 800, 'desktop', 5], [768, 900, 'edge', 3], [390, 844, 'mobile', 3]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5296/');
  await page.evaluate(() => window.__showProjects());
  await page.waitForSelector('#projects:not([hidden])');
  await page.evaluate((r) => window.__setRows(r), rows(n));
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    const c = document.querySelector('.p-card').getBoundingClientRect();
    const b = document.getElementById('create-new').getBoundingClientRect();
    return { card: [Math.round(c.width), Math.round(c.height)], btn: Math.round(b.width) };
  });
  console.log(`${tag} ${w}px -> card ${m.card[0]}x${m.card[1]}, button ${m.btn}px wide`);
  await page.screenshot({ path: `scripts/proj-${tag}.png` });
  await page.close();
}
await browser.close();
