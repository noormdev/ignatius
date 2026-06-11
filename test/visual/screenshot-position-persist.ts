/**
 * Visual verification: graph node positions persist across page reloads,
 * and "Reset layout" clears saved positions and returns to ELK auto-layout.
 *
 * Flow (persist):
 *   1. Load the graph (models/key-inherited).
 *   2. Wait for layout to settle and record a node's ELK-assigned position.
 *   3. Drag that node to a new position via the Cytoscape API and fire the
 *      'free' event so the drag-save listener triggers.
 *   4. Wait for the debounce (~400ms) to flush to localStorage.
 *   5. Reload the page.
 *   6. Wait for layoutstop to fire (positions restored) and for the app to settle.
 *   7. Assert the node is at (approximately) the dragged position, not the
 *      ELK-assigned one — proving the restore path worked.
 *
 * Flow (reset):
 *   8. On the same reloaded page, record current position (dragged).
 *   9. Click the FAB "Reset layout" button via Playwright.
 *  10. Wait for ELK re-layout to settle.
 *  11. Record position after reset — assert it is close to the original ELK position.
 *  12. Reload the page again.
 *  13. Assert the node is still at the ELK position (store was cleared — no restore).
 *
 * Screenshots saved to tmp/:
 *   - position-persist-before.png   — ELK layout, no drag
 *   - position-persist-dragged.png  — after drag, before reload
 *   - position-persist-after.png    — after reload, restored position
 *   - position-reset-after.png      — after FAB reset, node back at ELK position
 *   - position-reset-reload.png     — after reload following reset (must still be ELK)
 */

import { chromium } from 'playwright';
import { resolve, join } from 'path';
import { mkdirSync } from 'fs';
import { serveCommand } from '../../src/server/server';

const ROOT = resolve(import.meta.dir, '../..');
const MODELS = join(ROOT, 'models', 'key-inherited');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

const PORT = 3297;

const handle = serveCommand(MODELS, { port: PORT });
await Bun.sleep(400);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let ok = true;
const note = (m: string) => console.log(m);
const fail = (m: string) => { console.error('FAIL:', m); ok = false; };

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
  // Wait for the graph to settle (ELK layout + markers + API response)
  await page.waitForTimeout(3000);

  // Record ELK-assigned position of 'Party' node
  const elkPos = await page.evaluate(() => {
    const cy = window.__IGNATIUS_CY__!;
    const node = cy.$id('Party');
    if (node.empty()) return null;
    const p = node.position();
    return { x: Math.round(p.x), y: Math.round(p.y) };
  });

  if (!elkPos) {
    fail('Party node not found in graph');
  } else {
    note(`ELK position of Party: ${JSON.stringify(elkPos)}`);
    await page.screenshot({ path: join(TMP, 'position-persist-before.png') });
    note('Saved tmp/position-persist-before.png');

    // Drag Party to a new position (offset by 300,300 from ELK position)
    const dragTarget = { x: elkPos.x + 300, y: elkPos.y + 300 };

    await page.evaluate((target) => {
      const cy = window.__IGNATIUS_CY__!;
      const node = cy.$id('Party');
      node.position(target);
      // Fire 'free' to trigger the drag-save listener
      node.emit('free');
      // Also move a subtype-cluster MEMBER (compound child) so the regression
      // guard below covers compound-parent restore — a plain node like Party
      // can't catch the compound-translation bug.
      const member = cy.$id('License');
      if (!member.empty()) {
        const mp = member.position();
        member.position({ x: mp.x + 120, y: mp.y - 160 });
        member.emit('free');
      }
    }, dragTarget);

    await page.waitForTimeout(100);
    await page.screenshot({ path: join(TMP, 'position-persist-dragged.png') });
    note(`Saved tmp/position-persist-dragged.png (Party moved to ${JSON.stringify(dragTarget)})`);

    // Wait for the debounce (400ms) + a small buffer
    await page.waitForTimeout(600);

    // Capture EVERY node's model position (the full arranged layout) so the
    // reload can be checked node-by-node — not just the single Party node.
    // This is the guard for the compound-parent restore regression.
    const arrangedAll = await page.evaluate(() => {
      const cy = window.__IGNATIUS_CY__!;
      const out: Record<string, { x: number; y: number }> = {};
      cy.nodes().forEach((n) => {
        const p = n.position();
        out[n.id()] = { x: Math.round(p.x), y: Math.round(p.y) };
      });
      return out;
    });

    // Reload
    await page.reload();
    await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
    // Wait for layoutstop + restore + app settle
    await page.waitForTimeout(3000);

    // Read position after reload
    const restoredPos = await page.evaluate(() => {
      const cy = window.__IGNATIUS_CY__!;
      const node = cy.$id('Party');
      if (node.empty()) return null;
      const p = node.position();
      return { x: Math.round(p.x), y: Math.round(p.y) };
    });

    await page.screenshot({ path: join(TMP, 'position-persist-after.png') });
    note('Saved tmp/position-persist-after.png');

    if (!restoredPos) {
      fail('Party node not found after reload');
    } else {
      note(`Restored position of Party: ${JSON.stringify(restoredPos)}`);

      // Allow a ±10px tolerance for rounding/fit adjustments.
      const TOLERANCE = 10;
      const xOk = Math.abs(restoredPos.x - dragTarget.x) <= TOLERANCE;
      const yOk = Math.abs(restoredPos.y - dragTarget.y) <= TOLERANCE;

      if (!xOk || !yOk) {
        fail(
          `Position not restored. Expected ~${JSON.stringify(dragTarget)}, got ${JSON.stringify(restoredPos)} ` +
          `(ELK was ${JSON.stringify(elkPos)})`
        );
      } else {
        note(`Party restored to dragged position within ±${TOLERANCE}px tolerance.`);
      }

      // Extra: confirm it's not just the ELK position (would be vacuously true if
      // the drag didn't move far enough)
      const distFromElk = Math.hypot(restoredPos.x - elkPos.x, restoredPos.y - elkPos.y);
      if (distFromElk < 50) {
        fail(`Position after reload is suspiciously close to ELK default (dist=${Math.round(distFromElk)}px) — restore may not have run`);
      } else {
        note(`Position is ${Math.round(distFromElk)}px from ELK default — confirmed not ELK layout.`);
      }

      // Regression guard: EVERY node must restore to its arranged position,
      // including subtype-cluster members (compound children). Catches the
      // compound-parent translation bug that a single-node check misses.
      const restoredAll = await page.evaluate(() => {
        const cy = window.__IGNATIUS_CY__!;
        const out: Record<string, { x: number; y: number }> = {};
        cy.nodes().forEach((n) => {
          const p = n.position();
          out[n.id()] = { x: Math.round(p.x), y: Math.round(p.y) };
        });
        return out;
      });
      const ALL_TOLERANCE = 3;
      const drifted: string[] = [];
      for (const [id, a] of Object.entries(arrangedAll)) {
        const r = restoredAll[id];
        if (!r) { drifted.push(`${id} (missing)`); continue; }
        if (Math.hypot(a.x - r.x, a.y - r.y) > ALL_TOLERANCE) {
          drifted.push(`${id} ${JSON.stringify(a)}→${JSON.stringify(r)}`);
        }
      }
      if (drifted.length > 0) {
        fail(`${drifted.length}/${Object.keys(arrangedAll).length} nodes did not restore to arranged positions: ${drifted.join('; ')}`);
      } else {
        note(`All ${Object.keys(arrangedAll).length} nodes restored to arranged positions (incl. compound cluster members).`);
      }
    }

    // ── Reset flow ──────────────────────────────────────────────────────────
    // At this point the page is loaded with the dragged (restored) position.
    // Invoke "Reset layout" via the FAB menu and verify the node returns to
    // the ELK position, and that a subsequent reload does NOT restore the drag.

    note('--- Reset layout flow ---');

    // Open the FAB menu and click "Reset layout"
    await page.click('button.fab');
    await page.waitForSelector('.fab-menu', { timeout: 5000 });
    await page.getByRole('menuitem', { name: 'Reset layout' }).click();

    // Wait for ELK re-layout to settle
    await page.waitForTimeout(3000);

    const resetPos = await page.evaluate(() => {
      const cy = window.__IGNATIUS_CY__!;
      const node = cy.$id('Party');
      if (node.empty()) return null;
      const p = node.position();
      return { x: Math.round(p.x), y: Math.round(p.y) };
    });

    await page.screenshot({ path: join(TMP, 'position-reset-after.png') });
    note('Saved tmp/position-reset-after.png');

    if (!resetPos) {
      fail('Party node not found after reset');
    } else {
      note(`Position after reset: ${JSON.stringify(resetPos)}`);

      // After reset, node should be back near the original ELK position (±80px
      // tolerance — fit may shift slightly depending on viewport).
      const RESET_TOLERANCE = 80;
      const distAfterReset = Math.hypot(resetPos.x - elkPos.x, resetPos.y - elkPos.y);
      if (distAfterReset > RESET_TOLERANCE) {
        fail(
          `After reset, Party (${JSON.stringify(resetPos)}) is ${Math.round(distAfterReset)}px from ELK (${JSON.stringify(elkPos)}) — ` +
          `expected within ±${RESET_TOLERANCE}px`
        );
      } else {
        note(`Party is ${Math.round(distAfterReset)}px from ELK default after reset — confirmed back at ELK position.`);
      }

      // Reload after reset — store was cleared so the node must NOT restore to dragged pos.
      await page.reload();
      await page.waitForSelector('.graph-panel canvas', { timeout: 20_000 });
      await page.waitForTimeout(3000);

      const postResetReloadPos = await page.evaluate(() => {
        const cy = window.__IGNATIUS_CY__!;
        const node = cy.$id('Party');
        if (node.empty()) return null;
        const p = node.position();
        return { x: Math.round(p.x), y: Math.round(p.y) };
      });

      await page.screenshot({ path: join(TMP, 'position-reset-reload.png') });
      note('Saved tmp/position-reset-reload.png');

      if (!postResetReloadPos) {
        fail('Party node not found after reload following reset');
      } else {
        note(`Position after reload following reset: ${JSON.stringify(postResetReloadPos)}`);

        // Must still be near ELK, not the dragged position.
        const distFromDrag = Math.hypot(postResetReloadPos.x - dragTarget.x, postResetReloadPos.y - dragTarget.y);
        if (distFromDrag < 50) {
          fail(
            `After reload following reset, Party (${JSON.stringify(postResetReloadPos)}) is suspiciously close to ` +
            `dragged position ${JSON.stringify(dragTarget)} (dist=${Math.round(distFromDrag)}px) — store clear may not have worked`
          );
        } else {
          note(`Party is ${Math.round(distFromDrag)}px from dragged position after reset+reload — confirmed store was cleared.`);
        }

        const distFromElkAfterResetReload = Math.hypot(postResetReloadPos.x - elkPos.x, postResetReloadPos.y - elkPos.y);
        if (distFromElkAfterResetReload > RESET_TOLERANCE) {
          fail(
            `After reload following reset, Party (${JSON.stringify(postResetReloadPos)}) is ${Math.round(distFromElkAfterResetReload)}px from ELK — ` +
            `expected within ±${RESET_TOLERANCE}px`
          );
        } else {
          note(`Party is ${Math.round(distFromElkAfterResetReload)}px from ELK default after reset+reload — confirmed ELK layout.`);
        }
      }
    }
  }

} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
  handle.stop();
}

if (!ok) { console.error('\nPosition-persist verification FAILED.'); process.exit(1); }
console.log('\nPosition-persist verification passed.');
