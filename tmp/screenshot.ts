import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:3000');
await page.waitForTimeout(4000);
await page.screenshot({ path: 'tmp/current.png', fullPage: false });

// Zoom into the Party → SalesOrder area for detail
await page.evaluate(() => {
  const cy = (window as unknown as { cy?: unknown }).cy;
  // Scroll/zoom to center the graph
});
await page.screenshot({
  path: 'tmp/detail.png',
  clip: { x: 300, y: 250, width: 500, height: 300 }
});
// Zoomed-in view via browser zoom
await page.evaluate(() => {
  const cy = (document.querySelector('.graph-panel') as any)?.__cy;
  if (cy) { cy.zoom(2); cy.center(); }
});
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tmp/zoomed.png' });

await browser.close();
console.log('Screenshots saved');
