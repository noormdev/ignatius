/**
 * test-dfd-stack-dialogs.ts — CI-runnable Playwright check for the stack node
 * (docs/spec/dfd-store-clusters.md): the SVG stack box, StackDialog, search
 * dimming over stack membership, and the flow-view wiring that makes the
 * per-process view the app's default rendering.
 *
 * Covers:
 *  - the default (per-process) view renders stack nodes with visible rows
 *    on hub-diagram, with no duplicate-store marker drawn anywhere in it
 *  - clicking a stack opens StackDialog with rows at the "clusters" collapse
 *    level (a subtype family collapses to one toggle row, capped "C" not a D#)
 *  - a subtype row with no basetype member reads "<Basetype> subtypes"
 *    (test/fixtures/subtype-no-basetype, where Base is never read directly)
 *  - the connected view's adjacency stack reads "2 stores" and lists its
 *    writer process
 *  - opening a member entity from StackDialog closes it first
 *  - a search for a member name leaves its stack at full opacity and dims
 *    an unrelated one
 *  - a stack-edge chip click opens EdgeContractDialog listing every member
 *    store (CP6)
 *  - an ext: edge's contract dialog shows label lines only, with no
 *    group/store/type columns (CP6)
 *  - models/llm-memory-db-mssql's tag-administration: the Merge Tag cluster
 *    edge chip reads exactly "Tag junctions" (CP6)
 *  - models/llm-memory-db-mssql's tag-administration, default per-process
 *    view: every plain store node's D# matches assignStoreNumbers (CP6 round 2)
 *  - the FAB menu's view toggle and collapse-level cycle change hub-diagram's
 *    rendering, write flowview=/collapse= into the hash, and survive a reload
 *  - a position saved under the per-process view's key does not apply to the
 *    connected view
 *  - Back restores an older flowview=/collapse= snapshotted by a pushed
 *    history entry (useHashRoute's popstate reconcile)
 *  - toggling the collapse level while drilled into a sub-DFD keeps the
 *    active diagram at the leaf, not its top-level ancestor
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds
 * before running checks.
 */

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';
import { parseFlows } from '../../src/flows/flow-parse';
import { assignStoreNumbers } from '../../src/flow-view/flow-layout';

const ROOT = resolve(import.meta.dir, '../..');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:cli`). CI builds it before checks.');
  process.exit(0);
}

let failures = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
    failures++;
  }
}

async function waitForFlowReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as { __IGNATIUS_FLOW_READY__?: unknown }).__IGNATIUS_FLOW_READY__, { timeout: 20_000 });
  await page.waitForSelector('[data-ignatius="flow-svg"]', { timeout: 10_000 });
}

/** Clicks a stack's outer wrapper <g data-token="<stackId>">, opening StackDialog
 *  through the same click-vs-drag path a real pointer drag uses (no movement
 *  between down and up, so it registers as a click, not a drag). */
async function clickStack(page: Page, stackId: string): Promise<void> {
  await page.locator(`g[data-token="${stackId}"]`).first().click();
}

// ---------------------------------------------------------------------------
// hub-diagram: default per-process view, connected-view adjacency, search
// ---------------------------------------------------------------------------

const HUB_MODEL = join(ROOT, 'test/fixtures/hub-dfd');
const HUB_PORT = 3301;
const hubHandle = serveCommand(HUB_MODEL, { port: HUB_PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// React logs "Attempted to synchronously unmount a root while React was
// already rendering" when FlowsView's nested SVG root unmounts synchronously
// mid-render. This page's own sequence below already drives a diagram switch,
// several collapse-level/view toggles, and an entity-dialog open/close — every
// trigger the warning was reported on — so capturing console output here
// proves the fix across all of them in one run.
const consoleMessages: string[] = [];
page.on('console', msg => consoleMessages.push(msg.text()));

const RECORD_STACK = 'stack:db:HubStoreA+db:HubStoreB+db:RecordBase+db:RecordTypeA+db:RecordTypeB--read';
const ADJACENCY_STACK = 'stack:db:LogStoreOne+db:LogStoreTwo--write';
const FOUR_STACK = 'stack:db:HubStoreA+db:HubStoreB+db:PrivateStore4Read--read';
const SIX_STACK = 'stack:db:HubStoreA+db:HubStoreB+db:PrivateStore6Read--read';

try {
  // ---------------------------------------------------------------------
  // Default view: stack nodes render with visible rows.
  // ---------------------------------------------------------------------
  await page.goto(`http://localhost:${HUB_PORT}/#view=flow&dfd=hub-diagram`, { waitUntil: 'load' });
  await waitForFlowReady(page);

  const stackCount = await page.locator('g[data-node-type="stack"]').count();
  assert(stackCount > 0, 'default per-process view renders at least one stack node', `got ${stackCount}`);

  // Every hub-dfd entry authors a label: (docs/spec/dfd-store-clusters.md
  // SC1) — an authored label is never truncated (resolveChipLines), so no
  // chip on hub-diagram should carry the "hidden"/truncated marker.
  const truncatedChipCount = await page.locator('[data-ignatius="flow-svg"] [data-contract-type="hidden"]').count();
  assert(truncatedChipCount === 0, 'no chip on hub-diagram shows a truncated preview', `got ${truncatedChipCount}`);

  // Per-process view: HubStoreA/HubStoreB repeat in nearly every stack by
  // design, so the duplicate marker is never drawn here (docs/guides/flows.md).
  const perProcessDupMarkerCount = await page.locator('[data-ignatius="dup-marker"]').count();
  assert(perProcessDupMarkerCount === 0, 'the duplicate-store marker is not drawn in the per-process view', `got ${perProcessDupMarkerCount}`);

  // .textContent(), not .innerText() — the stack node is an SVG <g>, not an
  // HTMLElement, and Playwright's innerText() requires one.
  const recordStackRowText = await page.locator(`g[data-token="${RECORD_STACK}"]`).first().textContent() ?? '';
  assert(
    recordStackRowText.includes('RecordBase') && recordStackRowText.includes('Hub Store A') && recordStackRowText.includes('Hub Store B'),
    'the 5-member read stack draws a visible row per its clusters-level breakdown',
    recordStackRowText,
  );

  // ---------------------------------------------------------------------
  // Clicking a stack opens StackDialog with rows at the "clusters" level:
  // the subtype family collapses to one toggle row instead of three tables.
  // ---------------------------------------------------------------------
  await clickStack(page, RECORD_STACK);
  await page.waitForSelector('.modal', { timeout: 5000 });

  const dialogText = await page.locator('.modal').first().innerText();
  assert(dialogText.includes('Read stack'), 'StackDialog title reads "Read stack" for a per-process stack', dialogText.slice(0, 200));
  assert(dialogText.includes('RecordBase') && dialogText.includes('(3)'), 'StackDialog shows the RecordBase subtype row collapsed to one entry with its count', dialogText);
  assert(!dialogText.includes('RecordTypeA'), 'RecordTypeA is not a loose row at the clusters level (it is inside the collapsed subtype row)', dialogText);

  // D means data store — the subtype row caps with a plain "C", never a D#
  // (only a member store row is one).
  const subtypeRowHeading = (await page.locator('.stack-dialog-row-toggle summary').first().textContent()) ?? '';
  assert(
    subtypeRowHeading.trim() === 'C RecordBase (3)',
    'the subtype row caps with "C", not a D#',
    subtypeRowHeading,
  );
  assert(
    await page.locator('.modal a.entity-link', { hasText: 'Record Base' }).count() === 0,
    'collapsed subtype rows do not render their member links',
  );

  // Expand the subtype row — its members appear with D#s.
  const subtypeToggle = page.locator('.stack-dialog-row-toggle summary').first();
  await subtypeToggle.click();
  await page.waitForFunction(() => document.body.textContent?.includes('Record Type A'), { timeout: 5000 });
  const expandedText = await page.locator('.modal').first().innerText();
  assert(expandedText.includes('Record Type A') && expandedText.includes('Record Type B'), 'expanding the subtype row reveals its members', expandedText);
  await subtypeToggle.click();
  await page.waitForFunction(() => !document.body.textContent?.includes('Record Type A'), { timeout: 5000 });
  assert(
    await page.locator('.modal a.entity-link', { hasText: 'Record Base' }).count() === 0,
    'collapsing the subtype row removes its member links again',
  );
  await subtypeToggle.click();

  // ---------------------------------------------------------------------
  // Opening a member entity from StackDialog closes it first.
  // ---------------------------------------------------------------------
  await page.locator('.modal a.entity-link', { hasText: 'Record Base' }).first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.modal').length === 1 && (document.querySelector('.modal h1')?.textContent ?? '') === 'RecordBase',
    { timeout: 5000 },
  );
  const modalCountAfterEntityOpen = await page.locator('.modal').count();
  assert(modalCountAfterEntityOpen === 1, 'exactly one dialog remains open — the stack dialog closed before the entity dialog opened', `got ${modalCountAfterEntityOpen}`);
  const entityTitle = await page.locator('.modal h1').first().innerText();
  assert(entityTitle === 'RecordBase', 'the surviving dialog is the RecordBase entity dialog', entityTitle);

  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  // ---------------------------------------------------------------------
  // Search dimming: a member's name keeps its stack lit; an unrelated stack dims.
  // ---------------------------------------------------------------------
  await page.waitForSelector('.viewer-search-bar--flow', { timeout: 10_000 });
  // Move the pointer off the canvas first — a hovered node/edge wins over
  // search dimming (same focus-tier precedence graph-flow-search relies on),
  // and the cursor may still rest over a node from the entity-dialog close above.
  await page.mouse.move(20, 20);
  await page.fill('.viewer-search-input', 'PrivateStore4Read');
  try {
    await page.waitForFunction(
      ([four, six]) =>
        document.querySelector(`g[data-token="${four}"]`)?.getAttribute('opacity') === '1' &&
        document.querySelector(`g[data-token="${six}"]`)?.getAttribute('opacity') === '0.3',
      [FOUR_STACK, SIX_STACK],
      { timeout: 5000 },
    );
    assert(true, 'a stack containing the searched member stays at full opacity; an unrelated stack dims');
  } catch {
    const opac = await page.evaluate(([f, s]) => ({
      four: document.querySelector(`g[data-token="${f}"]`)?.getAttribute('opacity'),
      six: document.querySelector(`g[data-token="${s}"]`)?.getAttribute('opacity'),
    }), [FOUR_STACK, SIX_STACK]);
    assert(false, 'a stack containing the searched member stays at full opacity; an unrelated stack dims', JSON.stringify(opac));
  }
  await page.fill('.viewer-search-input', '');


  // Grabbing a label away from its centre must preserve that grab offset.
  // The first drag frame used to project the pointer itself onto the route,
  // snapping the chip centre to the cursor.
  const allChips = page.locator('[data-ignatius="flow-chip"]');
  let tallestChipIndex = -1;
  let tallestChipBox: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < await allChips.count(); i++) {
    const box = await allChips.nth(i).boundingBox();
    if (box && (!tallestChipBox || box.height > tallestChipBox.height)) {
      tallestChipIndex = i;
      tallestChipBox = box;
    }
  }
  if (tallestChipIndex < 0 || !tallestChipBox) throw new Error('no flow chip available for drag check');
  const draggedChip = allChips.nth(tallestChipIndex);
  await page.mouse.move(tallestChipBox.x + tallestChipBox.width / 2, tallestChipBox.y + 1);
  await page.mouse.down();
  await page.mouse.move(tallestChipBox.x + tallestChipBox.width / 2 + 6, tallestChipBox.y + 7, { steps: 3 });
  await page.mouse.up();
  const draggedChipBox = await draggedChip.boundingBox();
  const dragDistance = draggedChipBox
    ? Math.hypot(
        draggedChipBox.x + draggedChipBox.width / 2 - (tallestChipBox.x + tallestChipBox.width / 2),
        draggedChipBox.y + draggedChipBox.height / 2 - (tallestChipBox.y + tallestChipBox.height / 2),
      )
    : Infinity;
  assert(
    dragDistance > 1 && dragDistance < 10,
    'an off-centre label grab follows the pointer without an initial jump',
    `chip moved ${dragDistance.toFixed(2)}px for a 6px diagonal pointer move`,
  );

  // ---------------------------------------------------------------------
  // CP6: a stack-edge chip click opens EdgeContractDialog with one row per
  // member store's column.
  // ---------------------------------------------------------------------
  const recordStackChip = page.locator('[data-ignatius="flow-chip"]').filter({ hasText: 'hub id' }).filter({ hasText: 'base id' }).first();
  await recordStackChip.waitFor({ timeout: 10_000 });
  await recordStackChip.click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  const contractRowCount = await page.locator('.modal table.dict-io-table tbody tr').count();
  assert(contractRowCount === 5, 'a stack-edge chip click opens EdgeContractDialog with one row per member column', `got ${contractRowCount} rows`);
  const contractText = await page.locator('.modal').first().innerText();
  assert(
    ['HubStoreA', 'HubStoreB', 'RecordBase', 'RecordTypeA', 'RecordTypeB'].every(name => contractText.includes(name)),
    'the stack-edge contract dialog lists every member store',
    contractText,
  );
  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  // ---------------------------------------------------------------------
  // CP6: an ext: edge's contract dialog shows label lines only — a single
  // Data column, no group/store/type columns.
  // ---------------------------------------------------------------------
  const extChip = page.locator('[data-ignatius="flow-chip"]').filter({ hasText: 'status' }).first();
  await extChip.waitFor({ timeout: 10_000 });
  await extChip.click();
  await page.waitForSelector('.modal', { timeout: 5000 });
  const extDialogHeaders = await page.locator('.modal thead th').allInnerTexts();
  assert(
    extDialogHeaders.length === 1 && (extDialogHeaders[0] ?? '').toLowerCase() === 'item',
    'an ext: edge dialog shows a single Item column, not the group/store/column/type contract table',
    JSON.stringify(extDialogHeaders),
  );
  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  // ---------------------------------------------------------------------
  // Connected view + clusters level: the adjacency stack reads "2 stores"
  // and lists its writer process.
  // ---------------------------------------------------------------------
  // App reads flowview=/collapse= from the hash on mount and reconciles them
  // live on Back/Forward (popstate) — but a plain page.goto to a new hash is
  // a same-document navigation, not a popstate event, so it doesn't retrigger
  // either path. Force a real reload via an intermediate blank page so the
  // app re-mounts and re-reads the hash.
  await page.goto('about:blank');
  await page.goto(`http://localhost:${HUB_PORT}/#view=flow&dfd=hub-diagram&flowview=connected&collapse=clusters`, { waitUntil: 'load' });
  await waitForFlowReady(page);
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });

  await clickStack(page, ADJACENCY_STACK);
  await page.waitForSelector('.modal', { timeout: 5000 });
  const adjacencyText = await page.locator('.modal').first().innerText();
  assert(adjacencyText.includes('2 stores'), 'the adjacency stack dialog title reads "2 stores"', adjacencyText.slice(0, 200));
  assert(adjacencyText.includes('1.3 Process Three'), 'the adjacency stack dialog lists its writer as a dotted-number label, not a raw process id', adjacencyText);
  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  // ---------------------------------------------------------------------
  // View + collapse-level FAB toggles, hash reflection, and persistence
  // across reload.
  // ---------------------------------------------------------------------
  await page.goto('about:blank');
  await page.goto(`http://localhost:${HUB_PORT}/#view=flow&dfd=hub-diagram`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.removeItem('ignatius-flow-view'); localStorage.removeItem('ignatius-flow-collapse'); });
  await page.reload({ waitUntil: 'load' });
  await waitForFlowReady(page);

  // Cycle the collapse level twice: clusters -> groups -> stores. At "stores"
  // every table is its own row — Record Type A is visible with no expand click.
  // The action label names the target level (finding 4): "Collapse to groups"
  // from clusters, "Expand to stores" from groups (un-collapsing).
  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await page.locator('.fab-menu-item', { hasText: 'Collapse to groups' }).click();
  await waitForFlowReady(page);
  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await page.locator('.fab-menu-item', { hasText: 'Expand to stores' }).click();
  await waitForFlowReady(page);

  await clickStack(page, RECORD_STACK);
  await page.waitForSelector('.modal', { timeout: 5000 });
  const storesLevelText = await page.locator('.modal').first().innerText();
  assert(
    storesLevelText.includes('Record Type A') && storesLevelText.includes('Record Type B'),
    'cycling the collapse level to "stores" via the FAB menu shows every table as its own row, no expand needed',
    storesLevelText,
  );
  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  // Toggle the view — per-process to connected — via the FAB menu.
  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await page.locator('.fab-menu-item', { hasText: 'Connected view' }).click();
  await waitForFlowReady(page);
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });

  const hashAfterToggle = await page.evaluate(() => location.hash);
  assert(hashAfterToggle.includes('flowview=connected'), 'the hash reflects the view change after toggling', hashAfterToggle);
  assert(hashAfterToggle.includes('collapse=stores'), 'the hash reflects the collapse-level change after cycling', hashAfterToggle);

  // Both settings survive a real reload.
  await page.reload({ waitUntil: 'load' });
  await waitForFlowReady(page);
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });

  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await page.locator('.fab-menu-item', { hasText: 'Per-process view' }).click();
  await waitForFlowReady(page);
  await clickStack(page, RECORD_STACK);
  await page.waitForSelector('.modal', { timeout: 5000 });
  const persistedLevelText = await page.locator('.modal').first().innerText();
  assert(
    persistedLevelText.includes('Record Type A'),
    'the collapse level survives the reload and the view toggle back to per-process',
    persistedLevelText,
  );
  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  // ---------------------------------------------------------------------
  // Positions are stored per view — a saved position under the
  // per-process view's key does not apply in the connected view.
  // ---------------------------------------------------------------------
  // A process node's `data-token` (`proc:<id>`) lives on its outer wrapper
  // <g>, one level above the nested ProcessNode's own `data-node-type` <g>.
  const procToken = await page.evaluate(() => document.querySelector('g[data-token^="proc:"]')?.getAttribute('data-token') ?? null);
  if (!procToken) throw new Error('no process node found on hub-diagram');
  const perProcessBox = await page.locator(`g[data-token="${procToken}"]`).first().boundingBox();

  const baseKey = await page.evaluate(() => window.__FLOW_LAYOUT_KEYS__?.['hub-diagram'] ?? '');
  assert(baseKey !== '', 'hub-diagram has a fingerprint key in window.__FLOW_LAYOUT_KEYS__', baseKey);

  await page.evaluate(({ key, token }) => {
    localStorage.setItem('ignatius-flow-layout-positions', JSON.stringify({
      [key]: { positions: { [token]: { x: 900, y: 700 } }, savedAt: Date.now() },
    }));
  }, { key: `${baseKey}::per-process`, token: procToken });

  await page.reload({ waitUntil: 'load' });
  await waitForFlowReady(page);
  const movedBox = await page.locator(`g[data-token="${procToken}"]`).first().boundingBox();
  assert(
    !!movedBox && !!perProcessBox && (Math.abs(movedBox.x - perProcessBox.x) > 5 || Math.abs(movedBox.y - perProcessBox.y) > 5),
    'a saved position keyed to the per-process view moves the process node off its ELK position',
    JSON.stringify({ perProcessBox, movedBox }),
  );

  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await page.locator('.fab-menu-item', { hasText: 'Connected view' }).click();
  await waitForFlowReady(page);
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });
  const connectedBox = await page.locator(`g[data-token="${procToken}"]`).first().boundingBox();
  assert(
    !!connectedBox && !(Math.abs(connectedBox.x - 900) < 5 && Math.abs(connectedBox.y - 700) < 5),
    'the per-process-view saved position does not carry over to the connected view',
    JSON.stringify(connectedBox),
  );

  // ---------------------------------------------------------------------
  // Back/Forward reconciles flowview=/collapse= (useHashRoute's
  // popstate handler), not just dfd=. Opening an entity dialog pushes a
  // history entry that snapshots the CURRENT flowview=/collapse=. Closing
  // the dialog and toggling the view afterward only replaceState the SAME
  // (pushed) entry in place — the entry BELOW it on the stack (the initial
  // load) still carries the earlier flowview. Back must restore it.
  // ---------------------------------------------------------------------
  const RECORDBASE_SUBTYPE_STACK = 'subtype:RecordBase--read';
  await page.goto('about:blank');
  await page.goto(`http://localhost:${HUB_PORT}/#view=flow&dfd=hub-diagram&flowview=connected&collapse=clusters`, { waitUntil: 'load' });
  await waitForFlowReady(page);
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });

  await clickStack(page, RECORDBASE_SUBTYPE_STACK);
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.locator('.stack-dialog-row-toggle summary').first().click();
  await page.locator('.modal a.entity-link', { hasText: 'Record Base' }).first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.modal').length === 1 && (document.querySelector('.modal h1')?.textContent ?? '') === 'RecordBase',
    { timeout: 5000 },
  );
  await page.locator('.modal-close').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.modal').length === 0, { timeout: 5000 });

  await page.locator('.fab').click();
  await page.waitForSelector('.fab-menu', { timeout: 5000 });
  await page.locator('.fab-menu-item', { hasText: 'Per-process view' }).click();
  await waitForFlowReady(page);

  const hashBeforeBack = await page.evaluate(() => location.hash);
  assert(hashBeforeBack.includes('flowview=per-process'), 'toggling after closing the entity dialog updates the hash to per-process', hashBeforeBack);

  await page.goBack();
  await waitForFlowReady(page);
  await page.waitForSelector(`g[data-token="${ADJACENCY_STACK}"]`, { timeout: 10_000 });
  const hashAfterBack = await page.evaluate(() => location.hash);
  assert(hashAfterBack.includes('flowview=connected'), 'Back restores flowview=connected from the popped history entry (useHashRoute popstate reconcile)', hashAfterBack);

  // ---------------------------------------------------------------------
  // No console message from the sequence above ever warned about unmounting
  // a nested root mid-render.
  // ---------------------------------------------------------------------
  const unmountWarning = consoleMessages.find(m => m.includes('Attempted to synchronously unmount a root'));
  assert(unmountWarning === undefined, 'no console message warns about unmounting a root while React was rendering', unmountWarning);
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await page.close();
  await browser.close();
  hubHandle.stop();
}

// ---------------------------------------------------------------------------
// subtype-no-basetype: a subtype row with no basetype member.
// ---------------------------------------------------------------------------

const SUBTYPE_MODEL = join(ROOT, 'test/fixtures/subtype-no-basetype');
const SUBTYPE_PORT = 3302;
const subtypeHandle = serveCommand(SUBTYPE_MODEL, { port: SUBTYPE_PORT });
await new Promise<void>(r => setTimeout(r, 400));

const subtypeBrowser = await chromium.launch();
const subtypePage = await subtypeBrowser.newPage({ viewport: { width: 1440, height: 900 } });

const NO_BASETYPE_STACK = 'stack:db:SubA+db:SubB--read';

try {
  await subtypePage.goto(`http://localhost:${SUBTYPE_PORT}/#view=flow&dfd=diagram`, { waitUntil: 'load' });
  await waitForFlowReady(subtypePage);
  await subtypePage.waitForSelector(`g[data-token="${NO_BASETYPE_STACK}"]`, { timeout: 10_000 });

  await subtypePage.locator(`g[data-token="${NO_BASETYPE_STACK}"]`).first().click();
  await subtypePage.waitForSelector('.modal', { timeout: 5000 });
  const noBasetypeText = await subtypePage.locator('.modal').first().innerText();
  assert(
    noBasetypeText.includes('Base subtypes'),
    'a subtype family whose basetype is never touched reads "<Basetype> subtypes"',
    noBasetypeText,
  );
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await subtypePage.close();
  await subtypeBrowser.close();
  subtypeHandle.stop();
}

// ---------------------------------------------------------------------------
// CP6: models/llm-memory-db-mssql's tag-administration — the Merge Tag
// cluster edge chip reads exactly "Tag junctions".
// ---------------------------------------------------------------------------

const TAG_MODEL = join(ROOT, 'models/llm-memory-db-mssql');
const TAG_PORT = 3305;
const tagHandle = serveCommand(TAG_MODEL, { port: TAG_PORT });
await new Promise<void>(r => setTimeout(r, 400));

const tagBrowser = await chromium.launch();
const tagPage = await tagBrowser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  // Default per-process view: every plain store node's D# must match
  // assignStoreNumbers — a rendered node id can be a split `--read`/`--write`
  // copy, but the cap number always keys off the base store id.
  const { flowModel } = await parseFlows(TAG_MODEL);
  function findDiagram(diagrams: typeof flowModel.diagrams, id: string): typeof flowModel.diagrams[number] | undefined {
    for (const d of diagrams) {
      if (d.id === id) return d;
      const found = findDiagram(d.subDfds, id);
      if (found) return found;
    }
    return undefined;
  }
  const tagDiagram = findDiagram(flowModel.diagrams, 'tag-administration');
  if (!tagDiagram) throw new Error('tag-administration diagram not found in models/llm-memory-db-mssql');
  const expectedStoreNums = assignStoreNumbers(tagDiagram);

  await tagPage.goto(`http://localhost:${TAG_PORT}/#view=flow&dfd=tag-administration`, { waitUntil: 'load' });
  await waitForFlowReady(tagPage);
  for (const [storeId, expectedNum] of expectedStoreNums) {
    const box = tagPage.locator(`g[data-token="${storeId}"]`).first();
    if (await box.count() === 0) continue; // this store renders only inside the stack, not as a plain node
    const text = (await box.textContent()) ?? '';
    assert(text.includes(`D${expectedNum}`), `plain store node ${storeId} shows D${expectedNum}`, text);
  }

  await tagPage.goto('about:blank');
  await tagPage.goto(`http://localhost:${TAG_PORT}/#view=flow&dfd=tag-administration&flowview=connected&collapse=clusters`, { waitUntil: 'load' });
  await waitForFlowReady(tagPage);
  const tagChip = tagPage.locator('[data-ignatius="flow-chip"]', { hasText: 'Tag junctions' }).first();
  await tagChip.waitFor({ timeout: 10_000 });
  // .textContent(), not .innerText() — the chip is an SVG <g>, not an HTMLElement.
  const tagChipText = ((await tagChip.textContent()) ?? '').trim();
  assert(tagChipText === 'Tag junctions', 'the Merge Tag cluster edge chip reads exactly "Tag junctions"', tagChipText);

  await tagChip.click();
  await tagPage.waitForSelector('.modal', { timeout: 5000 });
  const tagDialogText = await tagPage.locator('.modal').first().innerText();
  assert(
    ['Project Tag', 'Artifact Tag', 'Milestone Tag', 'Task Tag'].every(name => tagDialogText.includes(name)),
    'the cluster edge dialog lists all four junction tables by display name',
    tagDialogText,
  );
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await tagPage.close();
  await tagBrowser.close();
  tagHandle.stop();
}

// ---------------------------------------------------------------------------
// models/key-inherited: toggling the collapse level while drilled into a
// sub-DFD keeps the active diagram at the leaf, not its top-level ancestor
// (the render-time onActiveDiagramChange callback fires with the drilled
// diagram's own id on every re-render, including the one the toggle triggers).
// ---------------------------------------------------------------------------

const KEY_INHERITED_MODEL = join(ROOT, 'models/key-inherited');
const KEY_INHERITED_PORT = 3306;
const keyInheritedHandle = serveCommand(KEY_INHERITED_MODEL, { port: KEY_INHERITED_PORT });
await new Promise<void>(r => setTimeout(r, 400));

const keyInheritedBrowser = await chromium.launch();
const keyInheritedPage = await keyInheritedBrowser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  await keyInheritedPage.goto(`http://localhost:${KEY_INHERITED_PORT}/#view=flow&dfd=order-to-cash`, { waitUntil: 'load' });
  await waitForFlowReady(keyInheritedPage);

  // Drill into the Create-Sales-Order sub-DFD (FlowDiagramSvg renders a
  // drillable process as <g data-token="proc:<processId>">).
  await keyInheritedPage.locator('[data-token="proc:Create-Sales-Order"]').first().click({ force: true });
  await keyInheritedPage.waitForFunction(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__ === 'Create-Sales-Order',
    { timeout: 10_000 },
  );

  // Toggle the collapse level via the FAB — this rebuilds the flow renderer
  // (flowView/collapseLevel are effect deps); the active diagram must stay
  // at the drilled leaf, not fall back to order-to-cash (its top-level ancestor).
  await keyInheritedPage.locator('.fab').click();
  await keyInheritedPage.waitForSelector('.fab-menu', { timeout: 5000 });
  await keyInheritedPage.locator('.fab-menu-item', { hasText: /^(Collapse to|Expand to)/ }).click();
  await waitForFlowReady(keyInheritedPage);

  const activeDfdAfterToggle = await keyInheritedPage.evaluate(
    () => (window as { __IGNATIUS_ACTIVE_FLOW_DFD__?: string }).__IGNATIUS_ACTIVE_FLOW_DFD__,
  );
  assert(
    activeDfdAfterToggle === 'Create-Sales-Order',
    'toggling the collapse level while drilled into a sub-DFD keeps the active diagram at the leaf',
    `got '${activeDfdAfterToggle}'`,
  );
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await keyInheritedPage.close();
  await keyInheritedBrowser.close();
  keyInheritedHandle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nDFD stack dialogs: all assertions passed.');
process.exit(0);
