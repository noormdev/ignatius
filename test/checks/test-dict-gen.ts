import { parseModels } from '../../src/parse';
import { validateModel } from '../../src/validate';
import { generateDict } from '../../src/generators/dict';

const { model, globalErrors: parseGlobalErrors } = await parseModels('models/key-inherited');
const validation = validateModel(model);
const findings = {
  globalErrors: [...parseGlobalErrors, ...validation.globalErrors],
  entityErrors: validation.entityErrors,
};
const darkHtml = await generateDict(model, findings, 'dark', { modelsDir: 'models/key-inherited' });
const lightHtml = await generateDict(model, findings, 'light', { modelsDir: 'models/key-inherited' });

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

// 5. Theme handling: both files embed dark + light CSS blocks; the mode arg
//    only sets the initial data-theme on <html>, so the two outputs differ by
//    that attribute, and each file's dark/light blocks carry distinct palettes.
assert(darkHtml !== lightHtml, 'dark and light outputs differ');
assert(darkHtml.includes('data-theme="dark"'), 'dark mode sets initial data-theme="dark"');
assert(lightHtml.includes('data-theme="light"'), 'light mode sets initial data-theme="light"');

// Both theme blocks are emitted in either file (data-theme switching at runtime).
assert(darkHtml.includes(':root[data-theme="dark"]') && darkHtml.includes(':root[data-theme="light"]'),
  'output embeds both dark and light :root[data-theme] blocks');

// The two palettes use different background values (proves themes are structurally distinct).
const bgValues = [...darkHtml.matchAll(/--color-background:\s*([^;]+);/g)].map(m => m[1]?.trim());
const distinctBgs = new Set(bgValues);
assert(distinctBgs.size >= 2, `dark and light blocks use different --color-background (got ${[...distinctBgs].join(', ')})`);

// 5b. Alternate-key marker in the attributes table. key-inherited's Product.sku
//     is an AK column that is neither PK nor FK, so its key cell is exactly "AK".
assert(darkHtml.includes('<td>AK</td>'), 'AK marker rendered in attributes key cell');

// 6. Markdown body content rendered (bodyHtml inlined)
// Party body bolds **Party** → renders to <strong>Party</strong>, proving markdown is inlined AND processed.
assert(darkHtml.includes('<strong>Party</strong>'), 'markdown body content rendered in dark output');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll assertions passed. FK anchor count: ${fkMatches.length}`);
}
