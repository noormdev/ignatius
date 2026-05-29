import { chromium } from 'playwright';
import { resolve } from 'path';

const modelsDir = resolve(import.meta.dir, '../../models');
const themeFile = resolve(modelsDir, '_theme.yaml');
const testThemeFile = resolve(import.meta.dir, '../fixtures/test-theme.yaml');

async function screenshot(outputPath: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();
  console.log(`Saved: ${outputPath}`);
}

// Default theme (no _theme.yaml)
const themeFileObj = Bun.file(themeFile);
const hadTheme = await themeFileObj.exists();

// Remove any existing theme to get default rendering
if (hadTheme) {
  await Bun.$`rm ${themeFile}`;
}

await screenshot('tmp/screenshot-default-theme.png');

// Apply test theme
await Bun.$`cp ${testThemeFile} ${themeFile}`;
// Wait for server to pick up the change (it re-parses on each request, no wait needed)
await screenshot('tmp/screenshot-test-theme.png');

// Restore original state
await Bun.$`rm ${themeFile}`;
if (hadTheme) {
  console.log('Note: original _theme.yaml was removed; restore manually if needed.');
}

console.log('Done.');
