import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://localhost:3000');

// Wait for graph layout to complete (ELK lays out asynchronously)
await page.waitForTimeout(6000);

// Dark mode screenshot (default)
await page.screenshot({ path: 'tmp/screenshot-mode-dark.png', fullPage: false });
console.log('Saved: tmp/screenshot-mode-dark.png');

// Click the theme toggle
await page.click('.theme-toggle');

// Wait for re-render
await page.waitForTimeout(1500);

// Light mode screenshot
await page.screenshot({ path: 'tmp/screenshot-mode-light.png', fullPage: false });
console.log('Saved: tmp/screenshot-mode-light.png');

await browser.close();
console.log('Done.');
