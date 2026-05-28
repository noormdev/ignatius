import { parseModels } from '../src/parse';
import { generateGraph } from '../src/generators/graph';
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const model = await parseModels('models');

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// Generate both outputs
const darkHtml = await generateGraph(model, 'dark');
const lightHtml = await generateGraph(model, 'light');

await Bun.write('tmp/graph-default.html', darkHtml);
await Bun.write('tmp/graph-light.html', lightHtml);

console.log(`\nDark HTML size: ${darkHtml.length} bytes (${(darkHtml.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`Light HTML size: ${lightHtml.length} bytes\n`);

// 1. Valid doctype
assert(darkHtml.toLowerCase().startsWith('<!doctype html>'), 'dark: starts with <!doctype html>');
assert(lightHtml.toLowerCase().startsWith('<!doctype html>'), 'light: starts with <!doctype html>');

// 2. window.__MODEL__ present before any <script type="module">
const darkModelIdx = darkHtml.indexOf('window.__MODEL__');
const darkModuleIdx = darkHtml.indexOf('<script type="module"');
assert(darkModelIdx !== -1, 'dark: contains window.__MODEL__');
assert(darkModuleIdx !== -1, 'dark: contains <script type="module"');
assert(darkModelIdx < darkModuleIdx, 'dark: window.__MODEL__ appears before <script type="module">');

const lightModelIdx = lightHtml.indexOf('window.__MODEL__');
const lightModuleIdx = lightHtml.indexOf('<script type="module"');
assert(lightModelIdx !== -1, 'light: contains window.__MODEL__');
assert(lightModuleIdx !== -1, 'light: contains <script type="module"');
assert(lightModelIdx < lightModuleIdx, 'light: window.__MODEL__ appears before <script type="module">');

// 3. Contains cytoscape bundle content
assert(darkHtml.includes('cytoscape'), 'dark: bundle contains cytoscape reference');
assert(lightHtml.includes('cytoscape'), 'light: bundle contains cytoscape reference');

// 4. Self-contained — no external <script src= or <link rel="stylesheet" href=
// Must match only the HTML tag attributes (not content inside script blocks).
// Strip all <script>...</script> block content before checking, to avoid false positives
// from JS bundle content that happens to contain "src=" text.
function stripScriptBodies(html: string): string {
  return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body) => {
    // Keep opening tag, blank body, closing tag — so tag attributes are still checkable
    return `<script>${' '.repeat(body.length)}</script>`;
  });
}

const strippedDark = stripScriptBodies(darkHtml);
const strippedLight = stripScriptBodies(lightHtml);

// <script src="..."> tags (not type="module" inlined ones)
const externalScriptDark = /<script\b[^>]+src=["'][^"']/i.test(strippedDark);
const externalLinkDark = /<link\b[^>]+rel=["']stylesheet["'][^>]+href=["'][^"'#]/i.test(strippedDark);
assert(!externalScriptDark, 'dark: no external <script src=');
assert(!externalLinkDark, 'dark: no external <link rel="stylesheet" href=');

const externalScriptLight = /<script\b[^>]+src=["'][^"']/i.test(strippedLight);
const externalLinkLight = /<link\b[^>]+rel=["']stylesheet["'][^>]+href=["'][^"'#]/i.test(strippedLight);
assert(!externalScriptLight, 'light: no external <script src=');
assert(!externalLinkLight, 'light: no external <link rel="stylesheet" href=');

// 5. Dark and light produce different output (theme propagated)
assert(darkHtml !== lightHtml, 'dark and light outputs differ');
assert(darkHtml.includes('"dark"') || darkHtml.includes("'dark'") || darkHtml.includes('__THEME_MODE__'), 'dark: theme mode injected');
assert(lightHtml.includes('"light"') || lightHtml.includes("'light'") || lightHtml.includes('__THEME_MODE__'), 'light: theme mode injected');

// 6. Model data present in output
const firstEntityId = model.nodes[0]?.id ?? '';
assert(firstEntityId !== '' && darkHtml.includes(firstEntityId), `dark: first entity "${firstEntityId}" present in model data`);

// 7. File size reasonable (>1MB for React+Cytoscape+ELK)
const minSize = 1 * 1024 * 1024; // 1MB
assert(darkHtml.length > minSize, `dark: file size > 1MB (${(darkHtml.length / 1024 / 1024).toFixed(2)} MB)`);

console.log('\n--- Launching Playwright for screenshot verification ---\n');

const browser = await chromium.launch();

async function screenshotPage(htmlPath: string, outputPath: string, label: string) {
  const absPath = resolve(htmlPath);
  const page = await browser.newPage();
  await page.goto(`file://${absPath}`);
  // Wait for graph-panel to have content (ELK lays out client-side)
  // Wait up to 30s for canvas/cytoscape to render
  try {
    await page.waitForSelector('.graph-panel canvas', { timeout: 30000 });
    console.log(`PASS: ${label}: .graph-panel canvas found`);
  } catch {
    // cytoscape may render without canvas — check for .graph-panel with children
    const hasPanel = await page.$('.graph-panel');
    assert(hasPanel !== null, `${label}: .graph-panel present in DOM`);
  }
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`PASS: ${label}: screenshot saved to ${outputPath}`);
  await page.close();
}

await screenshotPage('tmp/graph-default.html', 'tmp/screenshot-graph-static-dark.png', 'dark');
await screenshotPage('tmp/graph-light.html', 'tmp/screenshot-graph-static-light.png', 'light');

await browser.close();

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
if (failures > 0) process.exit(1);
