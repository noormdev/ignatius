/**
 * test-graph-search.ts — CI-runnable Playwright check for the Graph search
 * bar (graph-flow-search CP2): dim/highlight classes, count readout, Enter
 * cycling, body-toggle opt-in, hover/layout-mode survival, and the SC9
 * no-persistence guarantee.
 *
 * Serves models/key-inherited, which has Party + PartyType (a two-entity
 * title match by id) and Person, whose markdown body contains "honest"
 * nowhere in any entity id — a clean body-only match fixture.
 *
 * Skips gracefully (exit 0) when dist/static/index.js is absent — CI builds
 * before running checks.
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODEL = join(ROOT, 'models/key-inherited');
const BUNDLE = join(ROOT, 'dist/static/index.js');

if (!existsSync(BUNDLE)) {
  console.log('SKIP: dist/static/index.js not built (run `bun run build:bundle`). CI builds it before checks.');
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

const PORT = 3297;
const handle = serveCommand(MODEL, { port: PORT });
await new Promise<void>(r => setTimeout(r, 400));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(`http://localhost:${PORT}/#view=graph`, { waitUntil: 'load' });
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await page.waitForSelector('.viewer-search-bar--graph', { timeout: 10_000 });
  await page.waitForTimeout(1500); // let the initial layout settle

  // graph-flow-search CP5 (SC5): the body-text opt-in is a labeled toggle
  // switch, not the old bare "Body" pill button — role="switch", aria-checked,
  // and a visible "Include descriptions" label.
  const bodySwitch = page.getByRole('switch', { name: 'Include descriptions' });
  await bodySwitch.waitFor({ state: 'visible', timeout: 5000 });
  assert(await bodySwitch.getAttribute('aria-checked') === 'false', 'SC5: body switch starts unchecked (aria-checked="false")');

  const totalEntities = await page.evaluate(() => window.__IGNATIUS_CY__!.nodes('[classification]').length);
  assert(totalEntities > 0, 'model has entity nodes to search', `got ${totalEntities}`);

  // ---------------------------------------------------------------------
  // SC9 (baseline) — capture hash + persisted layout positions BEFORE any
  // search interaction. Re-checked below after typing/toggling (not after
  // Enter, which legitimately writes pan/zoom via the pre-existing
  // navigateToEntity → cy.center() path — unrelated to search).
  // ---------------------------------------------------------------------
  const hashBefore = await page.evaluate(() => location.hash);
  const layoutPositionsBefore = await page.evaluate(() => localStorage.getItem('ignatius-layout-positions'));

  // ---------------------------------------------------------------------
  // SC1 + SC2 — "Party" matches Party + PartyType by id (verified against
  // the fixture: no other entity id in models/key-inherited contains
  // "party", and PaymentMethod — which FKs to Party — does not match).
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', 'Party');
  await page.waitForTimeout(400);

  const afterParty = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const entities = cy.nodes('[classification]');
    const matched = entities.filter(n => n.hasClass('search-match'));
    const dimmed = entities.filter(n => n.hasClass('search-dim'));
    const bothMatchEdge = cy.edges().filter(e =>
      (e.source().id() === 'Party' && e.target().id() === 'PartyType') ||
      (e.source().id() === 'PartyType' && e.target().id() === 'Party'));
    const mixedEdge = cy.edges().filter(e =>
      (e.source().id() === 'Party' && e.target().id() === 'PaymentMethod') ||
      (e.source().id() === 'PaymentMethod' && e.target().id() === 'Party'));
    return {
      matchedCount: matched.length,
      dimmedCount: dimmed.length,
      partyMatch: cy.$id('Party').hasClass('search-match'),
      partyTypeMatch: cy.$id('PartyType').hasClass('search-match'),
      bothMatchEdgeCount: bothMatchEdge.length,
      bothMatchEdgeDimmed: bothMatchEdge.hasClass('search-dim'),
      mixedEdgeCount: mixedEdge.length,
      mixedEdgeDimmed: mixedEdge.hasClass('search-dim'),
    };
  });

  assert(afterParty.matchedCount === 2, 'SC1: search-match applied to exactly 2 entities (Party, PartyType)', `got ${afterParty.matchedCount}`);
  assert(afterParty.dimmedCount === totalEntities - 2, 'SC1: search-dim applied to every non-matching entity', `dimmed=${afterParty.dimmedCount} total=${totalEntities}`);
  assert(afterParty.partyMatch, 'SC1: Party carries search-match');
  assert(afterParty.partyTypeMatch, 'SC1: PartyType carries search-match');
  assert(afterParty.bothMatchEdgeCount > 0, 'fixture sanity: a Party↔PartyType edge exists');
  assert(!afterParty.bothMatchEdgeDimmed, 'SC1: Party↔PartyType edge (both endpoints match) stays undimmed');
  assert(afterParty.mixedEdgeCount > 0, 'fixture sanity: a Party↔PaymentMethod edge exists');
  assert(afterParty.mixedEdgeDimmed, 'SC1: Party↔PaymentMethod edge (one endpoint matches) is dimmed');

  const countText = await page.locator('.viewer-search-count').textContent();
  assert(countText === `2 of ${totalEntities}`, 'SC2: count readout tracks the match set', `got "${countText}"`);

  // ---------------------------------------------------------------------
  // SC9 — hash/localStorage untouched by typing + toggling (no Enter yet).
  // ---------------------------------------------------------------------
  await bodySwitch.click(); // on
  await page.waitForTimeout(200);
  await bodySwitch.click(); // back off
  await page.waitForTimeout(200);

  const hashAfterSearch = await page.evaluate(() => location.hash);
  const layoutPositionsAfterSearch = await page.evaluate(() => localStorage.getItem('ignatius-layout-positions'));
  assert(hashAfterSearch === hashBefore, 'SC9: URL hash unchanged while searching', `before="${hashBefore}" after="${hashAfterSearch}"`);
  assert(layoutPositionsAfterSearch === layoutPositionsBefore, 'SC9: ignatius-layout-positions unchanged while searching');

  // ---------------------------------------------------------------------
  // SC3 — Enter cycles ascending-id matches, wrapping ("Party" < "PartyType").
  // ---------------------------------------------------------------------
  async function pressEnterAndGetSelection(): Promise<string[]> {
    await page.locator('.viewer-search-input').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    return page.evaluate(() => window.__IGNATIUS_CY__!.nodes(':selected').map(n => n.id()));
  }

  let selected = await pressEnterAndGetSelection();
  assert(selected.length === 1 && selected[0] === 'Party', 'SC3: first Enter selects "Party" (ascending id order)', JSON.stringify(selected));

  selected = await pressEnterAndGetSelection();
  assert(selected.length === 1 && selected[0] === 'PartyType', 'SC3: second Enter selects "PartyType"', JSON.stringify(selected));

  selected = await pressEnterAndGetSelection();
  assert(selected.length === 1 && selected[0] === 'Party', 'SC3: third Enter wraps back to "Party"', JSON.stringify(selected));

  // ---------------------------------------------------------------------
  // SC4 — hover in/out does not erase active search dimming.
  // ---------------------------------------------------------------------
  await page.evaluate(() => window.__IGNATIUS_CY__!.$id('Person').emit('mouseover'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__IGNATIUS_CY__!.$id('Person').emit('mouseout'));
  await page.waitForTimeout(200);

  const afterHover = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const entities = cy.nodes('[classification]');
    return {
      matched: entities.filter(n => n.hasClass('search-match')).length,
      dimmed: entities.filter(n => n.hasClass('search-dim')).length,
    };
  });
  assert(
    afterHover.matched === 2 && afterHover.dimmed === totalEntities - 2,
    'SC4: hover in/out leaves search classes intact',
    JSON.stringify(afterHover),
  );

  // Layout-mode toggle ('l' key) — blur the search input first so the
  // shortcut isn't swallowed by the editable guard. <body> has no tabindex,
  // so focusing it is a no-op when an input is currently focused — blur the
  // active element instead.
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  const layoutModeBefore = await page.evaluate(() => localStorage.getItem('ignatius-layout-mode') ?? 'organic');
  await page.keyboard.press('l');
  await page.waitForFunction(
    (before: string) => (localStorage.getItem('ignatius-layout-mode') ?? 'organic') !== before,
    layoutModeBefore,
    { timeout: 5000 },
  );
  await page.waitForTimeout(1500); // let the relayout settle

  const afterLayoutToggle = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const entities = cy.nodes('[classification]');
    return {
      matched: entities.filter(n => n.hasClass('search-match')).length,
      dimmed: entities.filter(n => n.hasClass('search-dim')).length,
    };
  });
  assert(
    afterLayoutToggle.matched === 2 && afterLayoutToggle.dimmed === totalEntities - 2,
    'SC4: layout-mode toggle leaves search classes intact',
    JSON.stringify(afterLayoutToggle),
  );

  // ---------------------------------------------------------------------
  // SC5 (graph half) — body toggle opt-in: "honest" appears only in
  // Person's markdown body, never in any entity id in this fixture.
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', 'honest');
  await page.waitForTimeout(400);

  const bodyOffMatches = await page.evaluate(() =>
    window.__IGNATIUS_CY__!.nodes('[classification]').filter(n => n.hasClass('search-match')).length);
  assert(bodyOffMatches === 0, 'SC5: body-only term does not match with the body toggle off', `got ${bodyOffMatches}`);

  await bodySwitch.click(); // on
  await page.waitForTimeout(200);
  assert(await bodySwitch.getAttribute('aria-checked') === 'true', 'SC5: body switch reports aria-checked="true" once on');

  const bodyOn = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    return {
      personMatch: cy.$id('Person').hasClass('search-match'),
      matchCount: cy.nodes('[classification]').filter(n => n.hasClass('search-match')).length,
    };
  });
  assert(bodyOn.personMatch && bodyOn.matchCount === 1, 'SC5: toggling body on matches Person via its prose body', JSON.stringify(bodyOn));

  // ---------------------------------------------------------------------
  // Clear restores everything.
  // ---------------------------------------------------------------------
  await page.fill('.viewer-search-input', '');
  await page.waitForTimeout(400);

  const clearedCount = await page.evaluate(() => window.__IGNATIUS_CY__!.elements('.search-match, .search-dim').length);
  assert(clearedCount === 0, 'clearing the term removes every search-match/search-dim class', `got ${clearedCount} still classed`);

  const countReadoutGone = await page.locator('.viewer-search-count').count();
  assert(countReadoutGone === 0, 'count readout hides once the term is cleared', `got ${countReadoutGone} elements`);

} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await page.close();
  await browser.close();
  handle.stop();
}

// ---------------------------------------------------------------------------
// Banner-collision regression — .viewer-search-bar was fully occluded by
// .graph-global-banner (full-width, top:0, z-index:200) whenever a model has
// global validation errors. models/broken-demo always renders that banner
// (parse.invalid_yaml, parse.missing_id, parse.empty_frontmatter), so it's
// the fixture for pinning "the bar sits below the banner, never under it".
// ---------------------------------------------------------------------------

const BANNER_MODEL = join(ROOT, 'models/broken-demo');
const BANNER_PORT = 3303;
const bannerHandle = serveCommand(BANNER_MODEL, { port: BANNER_PORT });
await new Promise<void>(r => setTimeout(r, 400));

const bannerBrowser = await chromium.launch();
const bannerPage = await bannerBrowser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await bannerPage.goto(`http://localhost:${BANNER_PORT}/#view=graph`, { waitUntil: 'load' });
  await bannerPage.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  await bannerPage.waitForSelector('.graph-global-banner', { timeout: 10_000 });
  await bannerPage.waitForSelector('.viewer-search-bar--graph', { timeout: 10_000 });
  await bannerPage.waitForTimeout(500); // let the banner-offset layout effect settle

  const barBox = await bannerPage.locator('.viewer-search-bar--graph').boundingBox();
  const bannerBox = await bannerPage.locator('.graph-global-banner').boundingBox();
  assert(barBox !== null, 'banner-collision: search bar has a bounding box');
  assert(bannerBox !== null, 'banner-collision: banner has a bounding box');

  if (barBox && bannerBox) {
    const intersects =
      barBox.x < bannerBox.x + bannerBox.width &&
      barBox.x + barBox.width > bannerBox.x &&
      barBox.y < bannerBox.y + bannerBox.height &&
      barBox.y + barBox.height > bannerBox.y;
    assert(
      !intersects,
      'banner-collision: search bar bounding box does not intersect the banner',
      `bar=${JSON.stringify(barBox)} banner=${JSON.stringify(bannerBox)}`,
    );
    assert(
      barBox.y >= bannerBox.y + bannerBox.height,
      'banner-collision: search bar sits fully below the banner',
      `bar.y=${barBox.y} banner.bottom=${bannerBox.y + bannerBox.height}`,
    );
  }

  // Playwright's click() actionability check fails if the target point is
  // covered by another element (e.g. the banner sitting on top of the bar) —
  // a successful click + type proves the bar is visible AND clickable, not
  // just geometrically clear.
  await bannerPage.locator('.viewer-search-input').click();
  await bannerPage.keyboard.type('Order');
  await bannerPage.waitForTimeout(400);
  const typedValue = await bannerPage.locator('.viewer-search-input').inputValue();
  assert(
    typedValue === 'Order',
    'banner-collision: search input is visible and clickable with the banner shown',
    `got "${typedValue}"`,
  );
} catch (err) {
  console.error('FAIL:', err instanceof Error ? err.message : String(err));
  failures++;
} finally {
  await bannerPage.close();
  await bannerBrowser.close();
  bannerHandle.stop();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nCP2 graph-search: all assertions passed.');
process.exit(0);
