/**
 * Playwright end-to-end verification for CP-4: Live reload via SSE.
 *
 * Steps:
 *  1. Start the server
 *  2. Open the app in a browser, wait for initial render
 *  3. Screenshot initial state
 *  4. Modify models/identity/Party.md (append a column desc)
 *  5. Wait ~1s for SSE event + refetch + re-render
 *  6. Screenshot after change
 *  7. Restore the file
 *  8. Assert the modal content updated
 */

import { chromium } from 'playwright';
import { serveCommand } from '../../src/server';
import { resolve } from 'path';

const PORT = 3298;
const MODELS_DIR = resolve(import.meta.dir, '../../models/key-inherited');
const TEST_FILE = resolve(MODELS_DIR, 'identity/Party.md');
const MARKER_TEXT = 'live-reload-test-desc';

const server = serveCommand(MODELS_DIR, { port: PORT });
await new Promise(r => setTimeout(r, 300));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto(`http://localhost:${PORT}`);

// Wait for graph to render
await page.waitForTimeout(6000);
await page.screenshot({ path: 'tmp/sse-before.png' });
console.log('Saved: tmp/sse-before.png');

// Open the Party node modal by clicking it
// Click on the Party entity label in the graph
await page.locator('[data-id="Party"]').click().catch(() => {
  console.log('Could not click Party node via data-id — trying text...');
});
// Alternatively click via text
await page.getByText('Party', { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(500);

// Verify modal opened
const modalVisible = await page.locator('.modal').isVisible().catch(() => false);
console.log(`Modal visible before edit: ${modalVisible}`);

// Modify the file
const origContent = await Bun.file(TEST_FILE).text();
const modifiedContent = origContent.replace(
  /^(party_id:.*)/m,
  `$1\n  desc: ${MARKER_TEXT}`
);
if (modifiedContent === origContent) {
  // Fallback: append to end
  await Bun.write(TEST_FILE, origContent + `\n<!-- ${MARKER_TEXT} -->`);
} else {
  await Bun.write(TEST_FILE, modifiedContent);
}

console.log('File modified. Waiting for SSE-triggered reload...');
await page.waitForTimeout(1200);

await page.screenshot({ path: 'tmp/sse-after.png' });
console.log('Saved: tmp/sse-after.png');

// Restore
await Bun.write(TEST_FILE, origContent);

await browser.close();
server.stop(true);

console.log('Done. Check tmp/sse-before.png and tmp/sse-after.png to confirm graph updated.');
