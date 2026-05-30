/**
 * CP-3 visual verification: dict findings surface.
 *
 * Generates dict HTML from the real models/ dir (which has 18 entity errors,
 * 0 global errors) and takes a Playwright screenshot for the orchestrator to
 * inspect. Confirms:
 *   - No global banner (models/ has 0 global errors)
 *   - Entity sections with issues show the ⚠ triangle
 *
 * Output: tmp/dict-cp3.png
 */

import { chromium } from 'playwright';
import { resolve } from 'path';
import { parseModels } from '../../src/parse';
import { validateModel } from '../../src/validate';
import { generateDict } from '../../src/generators/dict';

const modelsDir = resolve(import.meta.dir, '../../models');
const tmpDir = resolve(import.meta.dir, '../../tmp');

const { model, globalErrors: parseGlobalErrors } = await parseModels(modelsDir);
const validation = validateModel(model);
const findings = {
  globalErrors: [...parseGlobalErrors, ...validation.globalErrors],
  entityErrors: validation.entityErrors,
};

const html = await generateDict(model, findings, 'dark', { modelsDir });
const htmlPath = resolve(tmpDir, 'dict-cp3.html');
await Bun.write(htmlPath, html);
console.log(`Wrote ${htmlPath}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`file://${htmlPath}`);
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(tmpDir, 'dict-cp3.png') });
console.log('Saved: tmp/dict-cp3.png');

await browser.close();
console.log('Done.');
