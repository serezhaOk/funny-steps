import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5290/privacy.html');
await page.screenshot({ path: 'scripts/privacy.png' });
await page.goto('http://localhost:5290/terms.html');
await page.screenshot({ path: 'scripts/terms.png' });
await browser.close();
