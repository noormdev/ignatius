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
// Right side - Identity subtypes
await page.screenshot({
  path: 'tmp/detail2.png',
  clip: { x: 700, y: 300, width: 500, height: 250 }
});
// Left side - Payment chain
await page.screenshot({
  path: 'tmp/detail3.png',
  clip: { x: 0, y: 280, width: 350, height: 300 }
});

await browser.close();
console.log('Screenshots saved');
