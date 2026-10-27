/** test-export-view-state.ts — an export carries the exporter's view state, which a recipient applies once per snapshot,
 *  and POST /api/export only answers same-origin local requests with a bounded, filtered body. */

import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseModels } from '../../src/model/parse';
import { parseFlows } from '../../src/flows/flow-parse';
import { layoutFingerprint } from '../../src/model/layout-fingerprint';
import { buildFlowLayoutKeys } from '../../src/flows/flow-fingerprint';
import { generateApp, type ViewState } from '../../src/generators/app';
import { scopeViewState } from '../../src/generators/export-model';
import type { BundleContent } from '../../src/generators/embedded-bundle';
import { applyViewState } from '../../src/app/logic/view-state';
import { serveCommand } from '../../src/server/server';
import { assert } from '../assert';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const PORT = 3338;
const BASE = `http://localhost:${PORT}`;

const bundle: BundleContent = {
  htmlTemplate:
    '<!doctype html><html><head><link rel="stylesheet" href="index-abc.css"></head><body>' +
    `<script>window.__IGNATIUS_MODE__ = 'live';</script><script type="module" src="index-abc.js"></script></body></html>`,
  cssContent: '',
  jsContent: 'console.log("APP_SCRIPT");',
  mermaidJs: '',
};

const { model } = await parseModels(FIXTURE);
const plain = await generateApp(model, null, bundle);
assert(!plain.includes('__VIEW_STATE__'), 'FAIL: without viewState the export carries no __VIEW_STATE__');
const cliShaped = await generateApp(model, null, bundle, { themeMode: 'dark', review: null });
assert(!cliShaped.includes('__VIEW_STATE__'), 'FAIL: the CLI export options carry no __VIEW_STATE__');

const hostile: ViewState = { storage: { 'ignatius-dict-lens': 'browse', 'ignatius-x': '</script><script>alert(1)</script>' }, hash: '#view=dict' };
const withState = await generateApp(model, null, bundle, { viewState: hostile });
assert(withState.includes('window.__VIEW_STATE__ = '), 'FAIL: viewState is emitted as window.__VIEW_STATE__');
assert(!withState.includes('</script><script>alert(1)'), 'FAIL: a </script> inside the view state is escaped');
assert(withState.indexOf('__VIEW_STATE__') < withState.indexOf('APP_SCRIPT'), 'FAIL: __VIEW_STATE__ is set before the app script runs');

const LAYOUT = 'ignatius-layout-positions';
const FLOW_LAYOUT = 'ignatius-flow-layout-positions';
const APPLIED = 'ignatius-view-state-applied';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
}

type MemoryStorage = ReturnType<typeof memoryStorage>;

function jsonKeys(raw: string | null): string[] {
  const parsed: unknown = JSON.parse(raw ?? '{}');
  return typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).sort() : [];
}

function appliedFor(storage: MemoryStorage, layoutKey: string): unknown {
  const parsed: unknown = JSON.parse(storage.getItem(APPLIED) ?? '{}');
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const record: unknown = Object.entries(parsed).find(([key]) => key === layoutKey)?.[1];
  return typeof record === 'object' && record !== null && 'digest' in record ? record.digest : undefined;
}

const entry = (savedAt: number) => ({ positions: { Person: { x: 1, y: 2 } }, savedAt, hidden: ['Identity'] });

type Target = { __VIEW_STATE__?: ViewState; __THEME_MODE__?: 'dark' | 'light'; __LAYOUT_KEY__?: string };

const storage = memoryStorage();
storage.setItem(LAYOUT, JSON.stringify({ otherModel: entry(5) }));
storage.setItem('ignatius-minimap', 'true');
const loc = { hash: '' };
const fileA: Target = {
  __VIEW_STATE__: {
    storage: { 'ignatius-dict-lens': 'browse', 'ignatius-theme': 'light', [LAYOUT]: JSON.stringify({ modelA: entry(1) }) },
    hash: '#view=dict',
  },
  __THEME_MODE__: 'dark',
  __LAYOUT_KEY__: 'modelA',
};

applyViewState(fileA, storage, loc);
assert(storage.items.get('ignatius-dict-lens') === 'browse', 'FAIL: first open writes the snapshot keys');
assert(loc.hash === '#view=dict', 'FAIL: first open sets an empty hash from the snapshot');
assert(fileA.__THEME_MODE__ === 'light', 'FAIL: the snapshot theme wins over __THEME_MODE__ on first apply');
const mergedKeys = jsonKeys(storage.getItem(LAYOUT)).join();
assert(mergedKeys === 'modelA,otherModel', `FAIL: the recipient's other-model layout entries survive an apply (got ${mergedKeys})`);
assert(!storage.items.has('ignatius-minimap'), 'FAIL: a preference key the snapshot omits is cleared on first apply');
const digestA = appliedFor(storage, 'modelA');
assert(typeof digestA === 'string' && digestA.length > 0, 'FAIL: first open records the digest under the model\'s layout key');

storage.setItem('ignatius-dict-lens', 'read');
storage.setItem('ignatius-theme', 'dark');
loc.hash = '';
applyViewState(fileA, storage, loc);
assert(storage.items.get('ignatius-dict-lens') === 'read', 'FAIL: a reload keeps the recipient\'s change (same digest, no re-apply)');
assert(loc.hash === '', 'FAIL: a reload with the same digest leaves the hash alone');
assert(fileA.__THEME_MODE__ === 'dark', 'FAIL: a reload keeps the recipient\'s theme over the baked __THEME_MODE__');

storage.removeItem('ignatius-theme');
fileA.__THEME_MODE__ = 'light';
applyViewState(fileA, storage, loc);
assert(fileA.__THEME_MODE__ === 'light', 'FAIL: with no stored theme a reload keeps the baked __THEME_MODE__');

const fileB: Target = { __VIEW_STATE__: { storage: { 'ignatius-dict-lens': 'browse' }, hash: '' }, __LAYOUT_KEY__: 'modelB' };
applyViewState(fileB, storage, { hash: '' });
assert(storage.items.get('ignatius-dict-lens') === 'browse', 'FAIL: fixture: opening export B applies B');
storage.setItem('ignatius-dict-lens', 'read');
applyViewState(fileA, storage, { hash: '' });
assert(storage.items.get('ignatius-dict-lens') === 'read', 'FAIL: reopening A after opening B does not re-apply A');
assert(jsonKeys(storage.getItem(LAYOUT)).includes('modelA'), 'FAIL: opening B keeps A\'s layout entry');

fileA.__VIEW_STATE__ = { storage: { 'ignatius-dict-lens': 'browse' }, hash: '#view=graph' };
const existingHash = { hash: '#view=flow' };
applyViewState(fileA, storage, existingHash);
assert(storage.items.get('ignatius-dict-lens') === 'browse', 'FAIL: a new snapshot of the same model applies again');
assert(appliedFor(storage, 'modelA') !== digestA, 'FAIL: a new snapshot records its own digest');
assert(existingHash.hash === '#view=flow', 'FAIL: an existing hash wins over the snapshot hash');

const stale = memoryStorage();
stale.setItem('ignatius-dict-lens', 'browse');
applyViewState({ __VIEW_STATE__: { storage: {}, hash: '' }, __LAYOUT_KEY__: 'modelC' }, stale, { hash: '' });
assert(!stale.items.has('ignatius-dict-lens'), 'FAIL: a stale recipient lens is cleared when the snapshot has none');

const full = memoryStorage();
full.setItem(LAYOUT, JSON.stringify(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`other${i}`, entry(1000 + i)]))));
applyViewState({ __VIEW_STATE__: { storage: { [LAYOUT]: JSON.stringify({ modelD: entry(1) }) }, hash: '' }, __LAYOUT_KEY__: 'modelD' }, full, { hash: '' });
const kept = jsonKeys(full.getItem(LAYOUT));
assert(
  kept.length === 10 && kept.includes('modelD') && !kept.includes('other0'),
  `FAIL: a merge into a full store keeps 10 entries, the import included, dropping the oldest (got ${kept.join()})`,
);

const corrupt = memoryStorage();
corrupt.setItem(APPLIED, 'not json');
corrupt.setItem(LAYOUT, '[');
applyViewState({ __VIEW_STATE__: { storage: { [LAYOUT]: JSON.stringify({ modelE: entry(1) }) }, hash: '' }, __LAYOUT_KEY__: 'modelE' }, corrupt, { hash: '' });
assert(jsonKeys(corrupt.getItem(LAYOUT)).join() === 'modelE', 'FAIL: a corrupt recipient layout store is replaced by the import');
assert(typeof appliedFor(corrupt, 'modelE') === 'string', 'FAIL: a corrupt applied map is replaced');

const malformedEntries = memoryStorage();
const badPositions = JSON.stringify({ modelF: entry(1), noPositions: { savedAt: 1 }, stringPositions: { positions: 'x', savedAt: 1 }, notAnEntry: 7 });
applyViewState({ __VIEW_STATE__: { storage: { [LAYOUT]: badPositions }, hash: '' }, __LAYOUT_KEY__: 'modelF' }, malformedEntries, { hash: '' });
const mergedFromBad = jsonKeys(malformedEntries.getItem(LAYOUT)).join();
assert(mergedFromBad === 'modelF', `FAIL: a merge drops entries whose positions is not an object (got ${mergedFromBad})`);

const manyFiles = memoryStorage();
for (let i = 0; i < 12; i++) {
  applyViewState({ __VIEW_STATE__: { storage: {}, hash: '' }, __LAYOUT_KEY__: `file${i}` }, manyFiles, { hash: '' });
}
const appliedKeys = jsonKeys(manyFiles.getItem(APPLIED));
assert(
  appliedKeys.length === 10 && !appliedKeys.includes('file0') && !appliedKeys.includes('file1') && appliedKeys.includes('file11'),
  `FAIL: the applied map keeps the newest 10 models (got ${appliedKeys.join()})`,
);
applyViewState({ __VIEW_STATE__: { storage: {}, hash: '' }, __LAYOUT_KEY__: 'file12' }, manyFiles, { hash: '' });
const afterThirteen = jsonKeys(manyFiles.getItem(APPLIED));
assert(
  !afterThirteen.includes('file2') && afterThirteen.includes('file3') && afterThirteen.includes('file12'),
  `FAIL: the applied map evicts the oldest apply, not an arbitrary one (got ${afterThirteen.join()})`,
);

const orderedA = memoryStorage();
const orderedB = memoryStorage();
applyViewState({ __VIEW_STATE__: { storage: { 'ignatius-theme': 'light', 'ignatius-dict-lens': 'browse' }, hash: '' }, __LAYOUT_KEY__: 'k' }, orderedA, { hash: '' });
applyViewState({ __VIEW_STATE__: { storage: { 'ignatius-dict-lens': 'browse', 'ignatius-theme': 'light' }, hash: '' }, __LAYOUT_KEY__: 'k' }, orderedB, { hash: '' });
assert(appliedFor(orderedA, 'k') === appliedFor(orderedB, 'k'), 'FAIL: the digest ignores key order');

const { flowModel } = await parseFlows(FIXTURE);
const ownLayoutKey = layoutFingerprint(model);
const ownFlowKey = Object.values(buildFlowLayoutKeys(flowModel))[0] ?? '';
assert(ownFlowKey !== '', 'FAIL: fixture: key-inherited has a flow layout key');
const leaky: ViewState = {
  storage: {
    'ignatius-dict-lens': 'browse',
    [LAYOUT]: JSON.stringify({ [ownLayoutKey]: entry(1), foreignModel: entry(2) }),
    [FLOW_LAYOUT]: JSON.stringify({ [`${ownFlowKey}::per-process`]: entry(1), 'foreign::per-process': entry(2) }),
  },
  hash: '',
};
const scoped = scopeViewState(leaky, ownLayoutKey, [ownFlowKey]);
assert(!JSON.stringify(scoped).includes('foreign'), `FAIL: a foreign layout key never reaches the export (got ${JSON.stringify(scoped)})`);
assert(jsonKeys(scoped.storage[LAYOUT] ?? null).join() === ownLayoutKey, 'FAIL: the model\'s own graph layout entry is kept');
assert(jsonKeys(scoped.storage[FLOW_LAYOUT] ?? null).join() === `${ownFlowKey}::per-process`, 'FAIL: the model\'s own flow layout entry is kept');
const unusable = scopeViewState({ storage: { [LAYOUT]: '{oops', [FLOW_LAYOUT]: JSON.stringify({ foreign: entry(1) }) }, hash: '' }, ownLayoutKey, [ownFlowKey]);
assert(!(LAYOUT in unusable.storage), 'FAIL: an unparsable layout store is dropped');
assert(!(FLOW_LAYOUT in unusable.storage), 'FAIL: a layout store with no entries for this model is dropped');

const root = mkdtempSync(join(tmpdir(), 'ignatius-export-view-state-'));
const dir = join(root, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });
const handle = serveCommand(dir, { port: PORT });

function post(body: string, headers: Record<string, string> = {}) {
  return fetch(`${BASE}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
}

try {
  const valid = JSON.stringify({ storage: { 'ignatius-dict-lens': 'browse' }, hash: '#view=dict' });

  const foreign = await post(valid, { Origin: 'http://evil.example' });
  assert(foreign.status === 403, `FAIL: a foreign Origin gets 403 (got ${foreign.status})`);
  const crossSite = await post(valid, { 'Sec-Fetch-Site': 'cross-site' });
  assert(crossSite.status === 403, `FAIL: a cross-site fetch gets 403 (got ${crossSite.status})`);
  // No Origin passes the same-origin check, so only the locality check can refuse this one.
  const rebound = await post(valid, { Host: `evil.example:${PORT}` });
  assert(rebound.status === 403, `FAIL: a DNS-rebound host name gets 403 (got ${rebound.status})`);
  const noOrigin = await post(valid);
  assert(noOrigin.status !== 403, `FAIL: fixture: a local request without Origin passes the guards (got ${noOrigin.status})`);

  const get = await fetch(`${BASE}/api/export`);
  assert(get.status === 405, `FAIL: GET gets 405 (got ${get.status})`);

  const huge = await post(JSON.stringify({ storage: { 'ignatius-x': 'a'.repeat(5 * 1024 * 1024) }, hash: '' }));
  assert(huge.status === 413, `FAIL: a body over 5 MB gets 413 (got ${huge.status})`);

  const megabyte = new TextEncoder().encode('a'.repeat(1024 * 1024));
  let chunksSent = 0;
  const chunked = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunksSent === 6) {
        controller.close();
        return;
      }
      chunksSent++;
      controller.enqueue(megabyte);
    },
  });
  const streamed = await fetch(`${BASE}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: chunked });
  assert(streamed.status === 413, `FAIL: a chunked body over 5 MB with no content-length gets 413 (got ${streamed.status})`);

  const malformed = await post('{"storage":');
  assert(malformed.status === 400, `FAIL: malformed JSON gets 400 (got ${malformed.status})`);
  const wrongShape = await post('[1,2]');
  assert(wrongShape.status === 400, `FAIL: a body that is not { storage, hash } gets 400 (got ${wrongShape.status})`);

  if (!existsSync(join(ROOT, 'dist/static/index.js'))) {
    console.log('SKIP: export success path needs dist/static (run `bun run build:bundle`).');
  } else {
    const mixed = JSON.stringify({
      storage: {
        'ignatius-dict-lens': 'browse',
        'ignatius-n': 5,
        'other-app': 'secret',
        '__proto__': 'x',
        [LAYOUT]: JSON.stringify({ foreignModel: entry(2) }),
      },
      hash: '#view=dict',
    });
    const res = await post(mixed, { Origin: BASE });
    assert(res.status === 200, `FAIL: a same-origin export succeeds (got ${res.status}: ${res.status === 200 ? '' : await res.text()})`);
    assert((res.headers.get('Content-Type') ?? '').startsWith('text/html'), 'FAIL: the export is text/html');
    const disposition = res.headers.get('Content-Disposition');
    assert(disposition === 'attachment; filename="key-inherited.html"', `FAIL: the export is an attachment named for the model (got ${disposition})`);
    const html = await res.text();
    const json = /window\.__VIEW_STATE__ = (.*?);<\/script>/.exec(html)?.[1];
    const emitted: unknown = json === undefined ? null : JSON.parse(json);
    assert(
      JSON.stringify(emitted) === JSON.stringify({ storage: { 'ignatius-dict-lens': 'browse' }, hash: '#view=dict' }),
      `FAIL: only ignatius-* keys with string values, scoped to this model, reach the export (got ${JSON.stringify(emitted)})`,
    );
  }

  console.log(process.exitCode ? '\nexport-view-state: failures above.' : '\nAll export-view-state checks passed.');
} finally {
  handle.stop(true);
  rmSync(root, { recursive: true, force: true });
}
