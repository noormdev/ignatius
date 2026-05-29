import { parseModels } from '../src/parse';
import { generateDict } from '../src/generators/dict';

const model = await parseModels('models');
const darkHtml = await generateDict(model, 'dark', { modelsDir: 'models' });
const lightHtml = await generateDict(model, 'light', { modelsDir: 'models' });

// Write output files for manual inspection
await Bun.write('tmp/dict-default.html', darkHtml);
await Bun.write('tmp/dict-light.html', lightHtml);

let failures = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// 1. Valid doctype
assert(darkHtml.toLowerCase().includes('<!doctype html>'), 'contains <!doctype html>');

// 2. Has <style> block with CSS variables
assert(darkHtml.includes('<style>'), 'contains <style> block');
assert(darkHtml.includes('--color-background'), 'style block contains --color-background');

// 3. All 24 entity ids present as anchor targets
const entityIds = model.nodes.map(n => n.id);
assert(entityIds.length === 24, `model has 24 entities (got ${entityIds.length})`);

for (const id of entityIds) {
  assert(darkHtml.includes(`id="entity-${id}"`), `entity anchor id="entity-${id}" present`);
}

// 4. FK anchor references — count href="#entity-" occurrences
const fkMatches = darkHtml.match(/href="#entity-/g) ?? [];
assert(fkMatches.length >= 27, `at least 27 FK anchor refs (got ${fkMatches.length})`);

// 5. Light theme produces different output (different CSS variable values)
assert(darkHtml !== lightHtml, 'dark and light outputs differ');

// Confirm themes actually differ structurally — both contain --color-background: but with different values
assert(darkHtml.includes('--color-background:'), 'dark html contains --color-background: CSS var');
assert(lightHtml.includes('--color-background:'), 'light html contains --color-background: CSS var');
// Extract each theme's background value and verify they differ
const darkBgMatch = darkHtml.match(/--color-background:\s*([^;]+);/);
const lightBgMatch = lightHtml.match(/--color-background:\s*([^;]+);/);
assert(darkBgMatch !== null, 'dark html has --color-background value');
assert(lightBgMatch !== null, 'light html has --color-background value');
assert(darkBgMatch?.[1] !== lightBgMatch?.[1], 'dark and light --color-background values differ');

// 6. Markdown body content rendered (bodyHtml inlined)
// Party has a bodyHtml with "Anyone the system transacts with"
assert(darkHtml.includes('Anyone the system transacts with'), 'markdown body content rendered in dark output');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll assertions passed. FK anchor count: ${fkMatches.length}`);
}
