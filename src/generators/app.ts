/**
 * generateApp — unified single-file export for all three views (Graph, Dictionary, Flows).
 *
 * Injects the UNION of globals needed by the unified React SPA so all three views
 * work offline from a single self-contained file:
 *   - window.__IGNATIUS_MODE__ = "static"
 *   - window.__MODEL__            (entity model — ERD graph + dictionary)
 *   - window.__FLOW_MODEL__       (flow diagrams array — may be empty/undefined)
 *   - window.__CHANGE_REVIEW__    (change review against the approved baseline — only when one exists)
 *   - window.__LAYOUT_KEY__       (ERD position-restore fingerprint)
 *   - window.__FLOW_LAYOUT_KEYS__ (per-diagram fingerprint map — may be undefined)
 *   - window.__FLOW_CLUSTERS__    (model-root clusters/ registry — may be undefined)
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

import type { Model } from '../model/parse';
import type { FlowModel } from '../flows/flow-parse';
import type { ChangeReview } from '../model/change-review';
import { layoutFingerprint } from '../model/layout-fingerprint';
import { buildFlowLayoutKeys } from '../flows/flow-fingerprint';
import type { BundleContent } from './embedded-bundle';
import { loadBundleFromDir } from './embedded-bundle';

export type GenerateAppOpts = {
  /** dark | light (default: dark) */
  themeMode?: 'dark' | 'light';
  /** Change review to bake in so the static page shows what changed; null or omitted when no baseline exists. */
  review?: ChangeReview | null;
};

/**
 * Make a JSON payload inert inside an inline <script>: every `<` becomes `\u003c`, which the
 * JS runtime reads as `<` but the HTML parser never sees as `</script` or `<!--<script`.
 * WHY: flow body HTML is rendered markdown, and change-note titles are agent-written.
 */
function escapeScriptClose(s: string): string {
  return s.replace(/</g, () => '\\u003c');
}

/**
 * Escape a string for use as HTML text content (e.g. inside <title>…</title>).
 * A model name can contain &, <, >, so it must be escaped to avoid breaking the
 * document or injecting markup. This is distinct from escapeScriptClose, which
 * only neutralizes </script in script bodies.
 */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  // Order: mode → model → flows → change review → layout keys → theme → surface (seed).
  let injection = `<script>` +
    `window.__IGNATIUS_MODE__ = "static"; ` +
    `window.__MODEL__ = ${escapeScriptClose(JSON.stringify(model))}; `;

  if (flowModel !== null && flowModel.diagrams.length > 0) {
    const flowLayoutKeys = buildFlowLayoutKeys(flowModel);
    injection +=
      `window.__FLOW_MODEL__ = ${escapeScriptClose(JSON.stringify(flowModel.diagrams))}; ` +
      `window.__FLOW_LAYOUT_KEYS__ = ${escapeScriptClose(JSON.stringify(flowLayoutKeys))}; ` +
      `window.__FLOW_CLUSTERS__ = ${escapeScriptClose(JSON.stringify(flowModel.clusters))}; `;
  }

  injection +=
    (opts.review ? `window.__CHANGE_REVIEW__ = ${escapeScriptClose(JSON.stringify(opts.review))}; ` : '') +
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
  // dist/static/index.html retains the inline script from src/app/index.html that sets
  // window.__IGNATIUS_MODE__ = 'live'. That runs AFTER the head injection, so we
  // must remove it. The pattern matches both the old form (mode only) and the new
  // form (mode + surface) for robustness across bundle rebuilds.
  html = html.replace(/<script>window\.__IGNATIUS_MODE__ = 'live';[\s\S]*?<\/script>/g, '');

  // Set the document <title> from the model display name, falling back to the
  // hardcoded "Ignatius" when the model has no name. The name is HTML text
  // content, so escape &, <, > to keep the document well-formed.
  const docTitle = model._meta?.name ?? 'Ignatius';
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escapeHtmlText(docTitle)}</title>`,
  );

  return html;
}
