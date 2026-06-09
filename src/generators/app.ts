/**
 * generateApp — unified single-file export for all three views (Graph, Dictionary, Flows).
 *
 * Injects the UNION of globals needed by the unified React SPA so all three views
 * work offline from a single self-contained file:
 *   - window.__IGNATIUS_MODE__ = "static"
 *   - window.__MODEL__            (entity model — ERD graph + dictionary)
 *   - window.__FLOW_MODEL__       (flow diagrams array — may be empty/undefined)
 *   - window.__LAYOUT_KEY__       (ERD position-restore fingerprint)
 *   - window.__FLOW_LAYOUT_KEYS__ (per-diagram fingerprint map — may be undefined)
 *   - window.__THEME_MODE__       (dark | light)
 *
 * WHY a single generator for all three views:
 * The unified SPA (App.tsx) renders Graph, Dictionary, and Flows from one bundle.
 * Injecting a partial subset (ERD-only or flows-only) would require callers to thread
 * optional flowModel / model through separate generators — adding coupling with no
 * benefit. app.ts is the sole static generator; it injects the full union.
 *
 * Helpers (escapeScriptClose, loadBundleFromDir) live here or in embedded-bundle.ts.
 * There is no graph.ts or flow-graph.ts to import from — both were removed when the
 * SPA was unified.
 */

import type { Model } from '../parse';
import type { FlowModel } from '../flow-parse';
import { layoutFingerprint } from '../layout-fingerprint';
import { buildFlowLayoutKeys } from '../flow-fingerprint';
import type { BundleContent } from './embedded-bundle';
import { loadBundleFromDir } from './embedded-bundle';

export type GenerateAppOpts = {
  /** dark | light (default: dark) */
  themeMode?: 'dark' | 'light';
};

/**
 * Escape </script> sequences so the HTML parser cannot prematurely close an
 * enclosing <script> tag. The backslash before / is invisible to the JS runtime
 * (treated as a plain /), but breaks the browser's end-tag detection.
 * WHY: flow body HTML is rendered markdown and can contain </script> in code fences.
 */
function escapeScriptClose(s: string): string {
  return s.replace(/<\/script/gi, () => '<\\/script');
}

/**
 * Generate a fully self-contained unified-app HTML file.
 *
 * Writes ONE file. Opened from file:// with no server:
 *  - Graph view shows the ERD, positions restored from __LAYOUT_KEY__.
 *  - Dictionary shows all entities (+ flows when present).
 *  - Flows view shows all DFDs, positions restored from __FLOW_LAYOUT_KEYS__.
 *  - Theme toggle, search, db:-store rich dialog — all offline.
 *
 * @param model       Parsed entity model (entities, edges, groups).
 * @param flowModel   Parsed flow model — pass null when no flows/ directory exists.
 * @param sourceOrDir Bundle content or path to dist/static/ directory.
 * @param opts        Optional theme and generation options.
 */
export async function generateApp(
  model: Model,
  flowModel: FlowModel | null,
  sourceOrDir: string | BundleContent = 'dist/static',
  opts: GenerateAppOpts = {},
): Promise<string> {
  const bundle: BundleContent =
    typeof sourceOrDir === 'string'
      ? await loadBundleFromDir(sourceOrDir)
      : sourceOrDir;

  const { htmlTemplate, cssContent, jsContent: jsRaw } = bundle;
  const themeMode = opts.themeMode ?? 'dark';

  // Escape </script> in the JS bundle to prevent premature <script> tag close.
  // WHY: same rationale as generateGraph — React's source contains this string.
  const jsContent = jsRaw.replace(/<\/script>/gi, () => '<\\/script>');

  // Compute the ERD position-restore fingerprint.
  const layoutKey = layoutFingerprint(model);

  // Build injection script with the full union of globals.
  // Order: mode → model → flows → layout keys → theme → surface (seed).
  let injection = `<script>` +
    `window.__IGNATIUS_MODE__ = "static"; ` +
    `window.__MODEL__ = ${escapeScriptClose(JSON.stringify(model))}; `;

  if (flowModel !== null && flowModel.diagrams.length > 0) {
    const flowLayoutKeys = buildFlowLayoutKeys(flowModel);
    injection +=
      `window.__FLOW_MODEL__ = ${escapeScriptClose(JSON.stringify(flowModel.diagrams))}; ` +
      `window.__FLOW_LAYOUT_KEYS__ = ${escapeScriptClose(JSON.stringify(flowLayoutKeys))}; `;
  }

  injection +=
    `window.__LAYOUT_KEY__ = ${escapeScriptClose(JSON.stringify(layoutKey))}; ` +
    `window.__THEME_MODE__ = ${escapeScriptClose(JSON.stringify(themeMode))}; ` +
    `</script>`;

  // Inline the CSS (function replacement: $ in cssContent must not be interpolated).
  let html = htmlTemplate.replace(
    /<link rel="stylesheet"[^>]*href="[^"]*index-[^"]+\.css"[^>]*>/,
    () => `<style>${cssContent}</style>`,
  );

  // Replace external JS script with injection + inlined module script.
  // Function replacement required: minified JS bundle contains $ patterns.
  const inlinedScript = `${injection}<script type="module">${jsContent}</script>`;
  html = html.replace(
    /<script type="module"[^>]*src="[^"]*index-[^"]+\.js"[^>]*><\/script>/,
    () => inlinedScript,
  );

  // Strip the body live-mode script so the injection's 'static' wins.
  // dist/static/index.html retains the inline script from src/index.html that sets
  // window.__IGNATIUS_MODE__ = 'live'. That runs AFTER the head injection, so we
  // must remove it. The pattern matches both the old form (mode only) and the new
  // form (mode + surface) for robustness across bundle rebuilds.
  html = html.replace(/<script>window\.__IGNATIUS_MODE__ = 'live';[\s\S]*?<\/script>/g, '');

  return html;
}
