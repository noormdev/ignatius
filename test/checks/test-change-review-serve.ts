// docs/spec/model-change-review.md SC3–SC6. Runs on a temp copy of models/key-inherited:
// serve and approve write `.ignatius/` and `.gitignore` into the model folder.

import { resolve, join } from 'path';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { serveCommand } from '../../src/server/server';
import { ensureGitignore } from '../../src/model/change-store';
import type { ChangeReview } from '../../src/model/change-review';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');
const PORT = 3321;
const NO_FLOWS_PORT = 3322;
const READ_ONLY_PORT = 3323;

const WATCHDOG_MS = 60_000;
const watchdog = setTimeout(() => {
  console.error(`FAIL: test-change-review-serve.ts exceeded its ${WATCHDOG_MS}ms watchdog`);
  process.exit(1);
}, WATCHDOG_MS);

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

const tempRoots: string[] = [];

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ignatius-change-review-'));
  tempRoots.push(root);
  const dir = join(root, 'model');
  // The committed .gitignore is dropped so the create path runs; .ignatius/ is
  // left behind by other checks that serve models/key-inherited in place.
  const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
  cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });
  return dir;
}

async function fetchDiff(port: number): Promise<ChangeReview> {
  const res = await fetch(`http://localhost:${port}/api/model`, { signal: AbortSignal.timeout(10_000) });
  const payload: { diff: ChangeReview } = await res.json();
  return payload.diff;
}

async function waitForDiff(port: number, done: (diff: ChangeReview) => boolean): Promise<ChangeReview> {
  const deadline = Date.now() + 5000;
  let diff = await fetchDiff(port);
  while (!done(diff) && Date.now() < deadline) {
    await sleep(150);
    diff = await fetchDiff(port);
  }
  return diff;
}

async function waitForFile(path: string): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (!existsSync(path) && Date.now() < deadline) await sleep(50);
  return existsSync(path);
}

/** Opens `/events` before returning so a later edit cannot slip past; `arrived` resolves true on `model-changed` within `ms`. */
async function nextModelChanged(port: number, ms: number): Promise<{ arrived: Promise<boolean> }> {
  const controller = new AbortController();
  const res = await fetch(`http://localhost:${port}/events`, { signal: controller.signal });
  const reader = res.body?.getReader();
  const arrived = new Promise<boolean>(done => {
    const timer = setTimeout(() => {
      controller.abort();
      done(false);
    }, ms);
    const decoder = new TextDecoder();
    let buffer = '';
    const pump = async (): Promise<void> => {
      if (!reader) return;
      try {
        while (true) {
          const { value, done: ended } = await reader.read();
          if (ended) return;
          buffer += decoder.decode(value);
          if (buffer.includes('event: model-changed')) {
            clearTimeout(timer);
            controller.abort();
            done(true);
            return;
          }
        }
      } catch {
        // aborted
      }
    };
    void pump();
  });
  return { arrived };
}

function setPersonColumn(dir: string, column: string): void {
  const file = join(dir, 'data/identity/Person.md');
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.replace('  birthdate:\n', `  ${column}:\n    type: text\n    desc: "Added."\n  birthdate:\n`));
}

function writeNote(dir: string, name: string, text: string): void {
  mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
  writeFileSync(join(dir, '.ignatius/changes', name), text);
}

{
  const dir = copyFixture();
  await ensureGitignore(dir);
  assert(readFileSync(join(dir, '.gitignore'), 'utf8') === '.ignatius/\n', 'SC3: .gitignore created with the .ignatius/ line');

  writeFileSync(join(dir, '.gitignore'), 'node_modules');
  await ensureGitignore(dir);
  await ensureGitignore(dir);
  assert(readFileSync(join(dir, '.gitignore'), 'utf8') === 'node_modules\n.ignatius/\n', 'SC3: line appended once to an existing .gitignore',
    JSON.stringify(readFileSync(join(dir, '.gitignore'), 'utf8')));

  for (const variant of ['.ignatius', '/.ignatius/', '.ignatius/']) {
    writeFileSync(join(dir, '.gitignore'), `dist\n${variant}\n`);
    await ensureGitignore(dir);
    assert(readFileSync(join(dir, '.gitignore'), 'utf8') === `dist\n${variant}\n`, `SC3: "${variant}" counts as present`);
  }
}

const dir = copyFixture();
writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
const handle = serveCommand(dir, { port: PORT });

try {
  const racing = await fetch(`http://localhost:${PORT}/api/model`, { signal: AbortSignal.timeout(10_000) });
  assert(racing.status === 200, 'SC3: /api/model racing the startup baseline write → 200', `got ${racing.status}`);
  const ignatiusLines = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n').filter(line => line === '.ignatius/');
  assert(ignatiusLines.length === 1, 'SC3: racing baseline writes add one .ignatius/ line', `found ${ignatiusLines.length}`);

  const baselinePath = join(dir, '.ignatius/baseline.json');
  assert(await waitForFile(baselinePath), 'SC3: serve writes .ignatius/baseline.json at startup');
  const baseline: { version: unknown; model: unknown; flows: unknown } = await Bun.file(baselinePath).json();
  assert(baseline.version === 1 && typeof baseline.model === 'object' && Array.isArray(baseline.flows),
    'SC3: baseline is { version: 1, model, flows }');
  assert(Array.isArray(baseline.flows) && baseline.flows.length > 0, 'SC3: baseline carries the model\'s flows');
  assert(readFileSync(join(dir, '.gitignore'), 'utf8') === 'node_modules\n.ignatius/\n', 'SC3: serve appends .ignatius/ to an existing .gitignore');

  const res = await fetch(`http://localhost:${PORT}/api/model`);
  const payload: Record<string, unknown> = await res.json();
  for (const key of ['model', 'parseGlobalErrors', 'validation', 'layoutKey', 'diff']) {
    assert(key in payload, `SC4: /api/model has "${key}"`);
  }

  const fresh = await fetchDiff(PORT);
  assert(fresh.items.length === 0, 'SC4: unedited model has no change items', JSON.stringify(fresh.items));
  for (const key of ['items', 'claims', 'notes', 'noteErrors', 'removedNodes', 'removedEdges'] as const) {
    assert(Array.isArray(fresh[key]), `SC4: diff.${key} is an array`);
  }

  rmSync(join(dir, '.ignatius'), { recursive: true });
  await fetchDiff(PORT);
  assert(existsSync(baselinePath), 'SC3: /api/model recreates a missing baseline');

  writeFileSync(baselinePath, '{"version": 1, "mod');
  const corruptRes = await fetch(`http://localhost:${PORT}/api/model`, { signal: AbortSignal.timeout(10_000) });
  assert(corruptRes.status === 200, 'SC3: /api/model on an unparseable baseline → 200', `got ${corruptRes.status}`);
  const rebuilt: { version: unknown } = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assert(rebuilt.version === 1, 'SC3: /api/model rewrites an unparseable baseline');

  writeFileSync(baselinePath, '{}');
  const wrongShapeRes = await fetch(`http://localhost:${PORT}/api/model`, { signal: AbortSignal.timeout(10_000) });
  assert(wrongShapeRes.status === 200, 'SC4: /api/model on a wrong-shape baseline → 200', `got ${wrongShapeRes.status}`);
  const reshaped: { version: unknown } = JSON.parse(readFileSync(baselinePath, 'utf8'));
  assert(reshaped.version === 1, 'SC4: /api/model rewrites a wrong-shape baseline');

  const sse = await nextModelChanged(PORT, 8000);
  setPersonColumn(dir, 'nickname');
  const edited = await waitForDiff(PORT, d => d.items.length > 0);
  const column = edited.items.find(i => i.scope === 'column' && i.entity === 'Person' && i.column === 'nickname');
  assert(column?.kind === 'added', 'SC5: added column appears as a column item', JSON.stringify(edited.items));
  assert(column?.status === 'unexplained', 'SC4: item with no note is unexplained');
  if (!(await sse.arrived)) console.log('  NOTE  model-changed SSE did not arrive within 8s (fs.watch latency; diff assertions above do not depend on it)');

  writeNote(dir, 'nickname.md', [
    '---',
    'title: Add nickname',
    'entities:',
    '  Person: [nickname]',
    '  Party: []',
    '---',
    '',
    'People asked to be addressed by nickname.',
    '',
  ].join('\n'));
  const noted = await waitForDiff(PORT, d => d.notes.length > 0);
  const explained = noted.items.find(i => i.scope === 'column' && i.column === 'nickname');
  assert(explained?.status === 'explained' && explained.notes.includes('nickname.md'), 'SC5: note edit explains the column item',
    JSON.stringify(explained));
  assert(noted.notes[0]?.title === 'Add nickname' && noted.notes[0].bodyHtml.includes('nickname'), 'SC4: notes carry title and body HTML');
  assert(noted.claims.some(c => 'entity' in c && c.entity === 'Party' && c.note === 'nickname.md'), 'SC4: untouched entity is an unchanged claim',
    JSON.stringify(noted.claims));

  writeNote(dir, 'broken.md', '---\ntitle: [unclosed\n---\n');
  const broken = await waitForDiff(PORT, d => d.noteErrors.length > 0);
  assert(broken.noteErrors.some(e => e.file === 'broken.md'), 'SC4: bad note lands in noteErrors', JSON.stringify(broken.noteErrors));
  assert(broken.notes.length === 1, 'SC4: bad note is otherwise ignored');

  const getApprove = await fetch(`http://localhost:${PORT}/api/approve`);
  assert(getApprove.status === 405, 'SC6: GET /api/approve → 405', `got ${getApprove.status}`);

  const crossSite = await fetch(`http://localhost:${PORT}/api/approve`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert(crossSite.status === 403, 'SC6: cross-site POST /api/approve → 403', `got ${crossSite.status}`);
  const foreignOrigin = await fetch(`http://localhost:${PORT}/api/approve`, { method: 'POST', headers: { Origin: 'http://evil.example' } });
  assert(foreignOrigin.status === 403, 'SC6: POST /api/approve from a foreign Origin → 403', `got ${foreignOrigin.status}`);
  const rebound = await fetch(`http://localhost:${PORT}/api/approve`, {
    method: 'POST',
    headers: { Host: `evil.example:${PORT}`, Origin: `http://evil.example:${PORT}`, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert(rebound.status === 403, 'SC6: POST /api/approve under a non-local Host → 403', `got ${rebound.status}`);
  assert(readdirSync(join(dir, '.ignatius/changes')).length === 2, 'SC6: rejected approve leaves notes in place');

  const approveSse = await nextModelChanged(PORT, 3000);
  const approveRes = await fetch(`http://localhost:${PORT}/api/approve`, {
    method: 'POST',
    headers: { Origin: `http://localhost:${PORT}`, 'Sec-Fetch-Site': 'same-origin' },
  });
  assert(approveRes.status === 200, 'SC6: POST /api/approve → 200', `got ${approveRes.status}`);
  assert(await approveSse.arrived, 'SC6: POST /api/approve broadcasts model-changed');
  assert(readdirSync(join(dir, '.ignatius/changes')).length === 0, 'SC6: POST /api/approve deletes every note');
  const approved = await fetchDiff(PORT);
  assert(approved.items.length === 0 && approved.notes.length === 0 && approved.noteErrors.length === 0,
    'SC6: after POST approve, diff is empty', JSON.stringify(approved));
  assert(readFileSync(join(dir, '.gitignore'), 'utf8') === 'node_modules\n.ignatius/\n', 'SC3: .gitignore line never duplicated');
} finally {
  handle.stop(true);
}

{
  setPersonColumn(dir, 'alias');
  writeNote(dir, 'alias.md', '---\ntitle: Add alias\nentities:\n  Person: [alias]\n---\n');
  writeNote(dir, 'other.md', '---\ntitle: Unrelated\n---\n');
  writeNote(dir, '.DS_Store', 'not a note');

  const proc = spawnSync('bun', [join(ROOT, 'src/cli/cli.ts'), 'approve', dir], { timeout: 30_000, encoding: 'utf8' });
  const stdout = proc.stdout;
  assert(proc.status === 0, 'SC6: approve exits 0', `exit ${proc.status}; stderr: ${proc.stderr}`);
  assert(stdout.includes('Approved 1 change(s), cleared 2 note(s).'), 'SC6: approve prints item and note counts', stdout);
  assert(readdirSync(join(dir, '.ignatius/changes')).length === 0, 'SC6: approve deletes every note');

  const reserve = serveCommand(dir, { port: PORT });
  try {
    const after = await fetchDiff(PORT);
    assert(after.items.length === 0, 'SC6: after CLI approve, diff.items is empty', JSON.stringify(after.items));
  } finally {
    reserve.stop(true);
  }
  assert(readFileSync(join(dir, '.gitignore'), 'utf8') === 'node_modules\n.ignatius/\n', 'SC3: second serve does not duplicate the line');
}

{
  setPersonColumn(dir, 'handle');
  const watched = serveCommand(dir, { port: PORT });
  try {
    const pending = await fetchDiff(PORT);
    assert(pending.items.length > 0 && pending.notes.length === 0, 'SC6: unexplained-only edit is pending before CLI approve', JSON.stringify(pending.items));
    const sse = await nextModelChanged(PORT, 3000);
    const proc = spawnSync('bun', [join(ROOT, 'src/cli/cli.ts'), 'approve', dir], { timeout: 30_000, encoding: 'utf8' });
    assert(proc.status === 0, 'SC6: approve with no notes exits 0', `exit ${proc.status}; stderr: ${proc.stderr}`);
    assert(await sse.arrived, 'SC6: CLI approve that deletes no notes broadcasts model-changed to open tabs');
  } finally {
    watched.stop(true);
  }
}

{
  const bare = copyFixture();
  rmSync(join(bare, 'flows'), { recursive: true });
  const bareHandle = serveCommand(bare, { port: NO_FLOWS_PORT });
  try {
    const diff = await fetchDiff(NO_FLOWS_PORT);
    assert(diff.items.length === 0, 'SC4: model without flows/ serves an empty diff', JSON.stringify(diff.items));
    assert(readFileSync(join(bare, '.gitignore'), 'utf8') === '.ignatius/\n', 'SC3: serve creates a missing .gitignore', JSON.stringify(readFileSync(join(bare, '.gitignore'), 'utf8')));
  } finally {
    bareHandle.stop(true);
  }

  const bareBaseline = join(bare, '.ignatius/baseline.json');
  writeFileSync(bareBaseline, 'not json');
  const proc = spawnSync('bun', [join(ROOT, 'src/cli/cli.ts'), 'approve', bare], { timeout: 30_000, encoding: 'utf8' });
  assert(proc.status === 0, 'SC6: approve on an unparseable baseline exits 0', `exit ${proc.status}; stderr: ${proc.stderr}`);
  assert(proc.stdout.includes('Approved 0 change(s), cleared 0 note(s).'), 'SC6: approve counts no items against an unparseable baseline', proc.stdout);
  const rewritten: { version: unknown } = JSON.parse(readFileSync(bareBaseline, 'utf8'));
  assert(rewritten.version === 1, 'SC6: approve rewrites an unparseable baseline');
}

{
  const readOnly = copyFixture();
  chmodSync(readOnly, 0o555);
  const readOnlyHandle = serveCommand(readOnly, { port: READ_ONLY_PORT });
  try {
    const res = await fetch(`http://localhost:${READ_ONLY_PORT}/api/model`, { signal: AbortSignal.timeout(10_000) });
    assert(res.status === 200, 'SC4: /api/model on a read-only model folder → 200', `got ${res.status}`);
    const payload: { model?: unknown; diff?: unknown } = res.status === 200 ? await res.json() : {};
    assert(typeof payload.model === 'object' && payload.diff === null, 'SC4: read-only model folder serves the model with diff null',
      JSON.stringify({ hasModel: 'model' in payload, diff: payload.diff ?? 'absent' }));
  } finally {
    readOnlyHandle.stop(true);
    chmodSync(readOnly, 0o755);
  }
}

for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
clearTimeout(watchdog);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll change-review serve checks passed.');
process.exit(0);
