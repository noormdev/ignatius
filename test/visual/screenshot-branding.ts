/**
 * Captures 4 branding screenshots:
 *   - dark/light with default branding (no _branding.yaml)
 *   - dark/light with custom branding (tmp/test-branding.yaml)
 *
 * Starts its own server on port 3097 to avoid conflicts.
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { serveCommand } from '../../src/server';

const modelsDir = resolve(import.meta.dir, '../../models/key-inherited');
const brandingFile = resolve(modelsDir, '_branding.yaml');
const testBrandingFile = resolve(import.meta.dir, '../fixtures/test-branding.yaml');

const PORT = 3097;
const BASE_URL = `http://localhost:${PORT}`;

// Ensure no leftover _branding.yaml from a previous run
const existingBranding = Bun.file(brandingFile);
if (await existingBranding.exists()) {
  await Bun.$`rm ${brandingFile}`;
}

const handle = serveCommand(modelsDir, { port: PORT });

async function capture(outputPath: string, mode: 'dark' | 'light') {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(BASE_URL);
  // Wait for layout: ELK is async + SSE setup
  await page.waitForTimeout(5000);

  if (mode === 'light') {
    // Start from dark (default), click to switch to light
    await page.click('.theme-toggle');
    await page.waitForTimeout(800);
  }

  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();
  console.log(`Saved: ${outputPath}`);
}

// --- Default branding screenshots (no _branding.yaml) ---
console.log('Taking default branding screenshots...');
await capture('tmp/screenshot-branding-dark-default.png', 'dark');
await capture('tmp/screenshot-branding-light-default.png', 'light');

// --- Custom branding screenshots (with test-branding.yaml) ---
console.log('Copying test-branding.yaml to models/_branding.yaml...');
await Bun.$`cp ${testBrandingFile} ${brandingFile}`;

// Server re-parses on each request — no restart needed
console.log('Taking custom branding screenshots...');
await capture('tmp/screenshot-branding-dark-custom.png', 'dark');
await capture('tmp/screenshot-branding-light-custom.png', 'light');

// Cleanup: remove temporary _branding.yaml
await Bun.$`rm ${brandingFile}`;
console.log('Removed models/_branding.yaml');

handle.stop(true);
console.log('Done.');
