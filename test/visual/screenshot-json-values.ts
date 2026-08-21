/**
 * Visual verification: structured (`json`) example values and highlighted code.
 *
 * Serves models/key-inherited, whose PaymentMethod entity carries a `json`
 * column (`details`) with two populated rows and one null, plus a ```sql fence
 * in its body. Walks both themes and captures, per theme:
 *
 *   - tmp/json-<theme>-dict-cell.png      dictionary table, truncated previews
 *   - tmp/json-<theme>-body-fence.png     highlighted sql fence in the body
 *   - tmp/json-<theme>-stacked-modal.png  expanded over the entity modal
 *
 * The stacked capture is the one worth looking at: the JSON dialog must sit
 * above the entity dialog, and the entity dialog must still be there behind it.
 *
 * The two highlight paths are deliberately different — body fences are
 * highlighted at parse time on the server, the JSON document in the browser —
 * so this script is what proves they land on the same theme colours.
 *
 * NOT run by `bun run test` — manual only.
 */

import { chromium, type Page } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models', 'key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3296;
const BASE = `http://localhost:${PORT}`;

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

const handle = serveCommand(MODEL, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();

/** Resolved token colour of the first highlighted span, to prove the theme took. */
async function firstTokenColor(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const span = document.querySelector(`${sel} span[style*="--shiki"]`);
    return span === null ? '' : getComputedStyle(span).color;
  }, selector);
}

async function walk(theme: 'light' | 'dark') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  try {
    await page.goto(`${BASE}/#view=dict`);
    await page.evaluate((t) => localStorage.setItem('ignatius-theme', t), theme);
    await page.reload();
    await page.waitForSelector('.json-value-preview', { timeout: 20_000 });

    const previews = await page.locator('.json-value-preview').count();
    if (previews === 0) fail(`${theme}: no .json-value-preview rendered`);

    const preview = await page.locator('.json-value-preview').first().innerText();
    if (preview.length > 48) fail(`${theme}: preview exceeded the 48-char budget (${preview.length})`);

    await page.locator('.json-value-preview').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(TMP, `json-${theme}-dict-cell.png`) });
    note(`Saved tmp/json-${theme}-dict-cell.png (${previews} structured cells)`);

    // Body code fence — highlighted at parse time, so it is already in bodyHtml.
    const fence = page.locator('.shiki').first();
    if (await fence.count() === 0) fail(`${theme}: no highlighted code fence in any body`);
    else {
      await fence.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(TMP, `json-${theme}-body-fence.png`) });
      const color = await firstTokenColor(page, '.shiki');
      if (color === '' || color === 'rgb(0, 0, 0)') fail(`${theme}: fence tokens have no resolved colour (${color})`);
      else note(`Saved tmp/json-${theme}-body-fence.png — first token colour ${color}`);
    }

    // Graph surface: the expander stacks a dialog over the entity dialog.
    await page.goto(`${BASE}/#view=graph&entity=PaymentMethod`);
    await page.waitForSelector('.modal-backdrop', { timeout: 20_000 });
    const examples = page.locator('.modal-backdrop .modal-examples');
    await examples.first().waitFor({ state: 'visible', timeout: 20_000 });

    const inModal = page.locator('.modal-backdrop .modal-examples .json-value-expand');
    if (await inModal.count() === 0) { fail(`${theme}: entity modal has no JSON expander`); return; }
    await inModal.first().click();
    await page.waitForSelector('.modal-backdrop-stacked', { timeout: 5_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(TMP, `json-${theme}-stacked-modal.png`) });

    const jsonColor = await firstTokenColor(page, '.json-value-full .shiki');
    if (jsonColor === '') fail(`${theme}: JSON document tokens are not highlighted`);
    else note(`Saved tmp/json-${theme}-stacked-modal.png — first token colour ${jsonColor}`);

    // The opener must survive, and ESC must peel exactly one layer.
    if (await page.locator('.modal-backdrop').count() < 2) {
      fail(`${theme}: entity modal did not stay open behind the JSON dialog`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    if (await page.locator('.modal-backdrop-stacked').count() !== 0) fail(`${theme}: ESC did not close the stacked dialog`);
    if (await examples.count() === 0) fail(`${theme}: ESC closed the entity modal too`);
    note(`${theme}: ESC peeled exactly one layer`);
  } catch (err) {
    fail(`${theme}: ${String(err)}`);
  } finally {
    await page.close();
  }
}

await walk('dark');
await walk('light');

await browser.close();
handle.stop();

console.log(ok ? 'screenshot-json-values: OK' : 'screenshot-json-values: FAILURES ABOVE');
process.exit(ok ? 0 : 1);
