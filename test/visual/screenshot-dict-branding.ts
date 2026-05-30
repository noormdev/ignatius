/**
 * Captures dict branding screenshots:
 *   - tmp/screenshot-dict-branding-dark.png  (default branding, dark mode)
 *   - tmp/screenshot-dict-branding-light.png (test-branding.yaml custom branding, light mode)
 *
 * Generates dict HTML, writes to tmp/, opens via file:// in Playwright.
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { parseModels } from '../../src/parse';
import { mergeBranding } from '../../src/branding-defaults';
import { generateDict } from '../../src/generators/dict';

const modelsDir = resolve(import.meta.dir, '../../models/key-inherited');
const tmpDir = resolve(import.meta.dir, '../../tmp');

// ── Dark mode — default branding ──────────────────────────────────────────────
const defaultModel = await parseModels(modelsDir);
const darkHtml = await generateDict(defaultModel, 'dark', { modelsDir });
const darkPath = resolve(tmpDir, 'dict-branding-dark.html');
await Bun.write(darkPath, darkHtml);
console.log(`Wrote ${darkPath}`);

// ── Light mode — custom branding (matches test-branding.yaml fixture) ─────────
const customBranding = mergeBranding({
  title: 'Acme Schema',
  subtitle: 'Your data, beautifully mapped',
  copyright: { holder: 'Acme Corp', year: new Date().getFullYear() },
  poweredBy: false,
});
const customModel = { ...defaultModel, branding: customBranding };
const lightHtml = await generateDict(customModel, 'light', { modelsDir });
const lightPath = resolve(tmpDir, 'dict-branding-light.html');
await Bun.write(lightPath, lightHtml);
console.log(`Wrote ${lightPath}`);

// ── Playwright screenshots ─────────────────────────────────────────────────────
const browser = await chromium.launch();

const darkPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await darkPage.goto(`file://${darkPath}`);
await darkPage.waitForTimeout(500);
await darkPage.screenshot({ path: resolve(tmpDir, 'screenshot-dict-branding-dark.png') });
await darkPage.close();
console.log('Saved: tmp/screenshot-dict-branding-dark.png');

const lightPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await lightPage.goto(`file://${lightPath}`);
await lightPage.waitForTimeout(500);
await lightPage.screenshot({ path: resolve(tmpDir, 'screenshot-dict-branding-light.png') });
await lightPage.close();
console.log('Saved: tmp/screenshot-dict-branding-light.png');

await browser.close();
console.log('Done.');
