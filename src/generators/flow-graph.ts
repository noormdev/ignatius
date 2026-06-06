import type { Model } from '../parse';
import type { FlowModel, FlowDiagram } from '../flow-parse';
import { layoutFlowFingerprint } from '../flow-fingerprint';
import type { BundleContent } from './graph';
import { loadBundleFromDir } from './graph';

export type FlowGraphOpts = {
    flowLayoutKeys: Record<string, string>;
    themeMode?: 'dark' | 'light';
    /** Href to the sibling process-dictionary HTML. When present, injected as
     *  window.__FLOW_DICT_HREF__ so the flow viewer can link to the dictionary. */
    dictHref?: string;
};

/**
 * Recursively collect layout fingerprints for a diagram and all its sub-DFDs.
 * Returns a flat id→fingerprint map covering every diagram in the tree.
 */
function collectFlowLayoutKeys(diagram: FlowDiagram): Record<string, string> {
    const keys: Record<string, string> = {};
    keys[diagram.id] = layoutFlowFingerprint(diagram);
    for (const sub of diagram.subDfds) {
        const subKeys = collectFlowLayoutKeys(sub);
        for (const [id, key] of Object.entries(subKeys)) {
            keys[id] = key;
        }
    }
    return keys;
}

/**
 * Build the complete id→fingerprint map for every diagram in a FlowModel
 * (top-level DFDs and all sub-DFDs recursively).
 *
 * Exported for use by src/server.ts (R3).
 */
export function buildFlowLayoutKeys(flowModel: FlowModel): Record<string, string> {
    const keys: Record<string, string> = {};
    for (const diagram of flowModel.diagrams) {
        const subKeys = collectFlowLayoutKeys(diagram);
        for (const [id, key] of Object.entries(subKeys)) {
            keys[id] = key;
        }
    }
    return keys;
}

/**
 * Generate a self-contained flow-graph HTML file by injecting the entire
 * FlowModel (all top-level DFDs) and a per-diagram fingerprint map into
 * the existing bundled React app.
 *
 * Mirrors generateGraph (src/generators/graph.ts) in structure:
 *  1. Escape </script> in the JS bundle.
 *  2. Build a synchronous injection script before the React module script.
 *  3. Inline CSS + JS from the bundle.
 *  4. Strip the live-mode body script so the static injection wins.
 *
 * WHY __IGNATIUS_SURFACE__ = "flow": the spec chose a separate surface
 * discriminator over a third __IGNATIUS_MODE__ value so all existing
 * === 'static' / === 'live' checks in App.tsx and src/index.html stay
 * untouched. The flow render path reads __IGNATIUS_SURFACE__ separately.
 *
 * WHY array + map (not single diagram + single key): one viewer carries ALL
 * of a model's DFDs; in-app navigation swaps between them. Each diagram
 * persists its positions independently, keyed by its structural fingerprint.
 *
 * entityModel is passed for parity / future cross-nav; the flow surface
 * does not serialise it — it is available on the same host as the entity graph.
 *
 * Accepts either a bundleDir string (reads from disk) or explicit BundleContent
 * (compiled binary embeds it via loadEmbeddedBundle).
 */
export async function generateFlowGraph(
    flowModel: FlowModel,
    _entityModel: Model,
    _mode: 'static' | 'live',
    opts: FlowGraphOpts,
    sourceOrDir: string | BundleContent = 'dist/static',
): Promise<string> {
    const bundle: BundleContent =
        typeof sourceOrDir === 'string'
            ? await loadBundleFromDir(sourceOrDir)
            : sourceOrDir;

    const { htmlTemplate, cssContent, jsContent: jsRaw } = bundle;

    // Escape </script> occurrences in the JS bundle so the browser HTML parser
    // doesn't prematurely close the inline <script> tag.
    // WHY: same rationale as in generateGraph — React's source contains this
    // string intentionally. Replacing </script> with <\/script> breaks the
    // end-tag detection without altering the runtime value.
    const jsContent = jsRaw.replace(/<\/script>/gi, () => '<\\/script>');

    const themeMode = opts.themeMode ?? 'dark';

    // Escape </script> sequences in serialised JSON values so they cannot
    // terminate the enclosing <script> tag prematurely. The HTML parser
    // treats </script> (case-insensitive) as an end-tag; replacing the `<`
    // with `<\/` breaks that detection while keeping the JS runtime value
    // identical — the backslash is legal inside a JS string literal and
    // JSON.parse ignores it, so round-trip fidelity is preserved.
    // WHY here (not only on the bundle): process body HTML is rendered
    // markdown and can legitimately contain `</script>` in code fences.
    function escapeScriptClose(s: string): string {
        return s.replace(/<\/script/gi, () => '<\\/script');
    }

    // Build the synchronous injection script. Order matches generateGraph:
    // mode → model → theme → layout keys map → surface discriminator.
    // WHY before the module script: the module script (type="module") is deferred;
    // synchronous scripts run in document order, so placing the injection
    // immediately before it guarantees it executes first.
    //
    // __FLOW_MODEL__ is the array of top-level FlowDiagrams (each carries its
    // subDfds recursively). __FLOW_LAYOUT_KEYS__ is the id→fingerprint map
    // for every diagram (top-level and sub-DFD) so the frontend can persist
    // positions per navigated diagram without importing the fingerprint module.
    const dictHrefFragment = opts.dictHref !== undefined
        ? `window.__FLOW_DICT_HREF__ = ${escapeScriptClose(JSON.stringify(opts.dictHref))}; `
        : '';

    // Live mode: only inject mode + surface + theme + dictHref.
    // The live branch in initFlowGraph fetches /api/flow for diagrams + keys,
    // so __FLOW_MODEL__ and __FLOW_LAYOUT_KEYS__ are NOT injected here.
    // Static mode: inject everything so the viewer is fully self-contained.
    const injection = _mode === 'live'
        ? `<script>` +
          `window.__IGNATIUS_MODE__ = "live"; ` +
          `window.__THEME_MODE__ = ${escapeScriptClose(JSON.stringify(themeMode))}; ` +
          `window.__IGNATIUS_SURFACE__ = "flow"; ` +
          dictHrefFragment +
          `</script>`
        : `<script>` +
          `window.__IGNATIUS_MODE__ = "static"; ` +
          `window.__FLOW_MODEL__ = ${escapeScriptClose(JSON.stringify(flowModel.diagrams))}; ` +
          `window.__FLOW_LAYOUT_KEYS__ = ${escapeScriptClose(JSON.stringify(opts.flowLayoutKeys))}; ` +
          `window.__THEME_MODE__ = ${escapeScriptClose(JSON.stringify(themeMode))}; ` +
          `window.__IGNATIUS_SURFACE__ = "flow"; ` +
          dictHrefFragment +
          `</script>`;

    // Replace external CSS link with inlined <style>.
    // Function replacement prevents $ signs in cssContent from being
    // interpreted as replacement pattern references.
    let html = htmlTemplate.replace(
        /<link rel="stylesheet"[^>]*href="[^"]*index-[^"]+\.css"[^>]*>/,
        () => `<style>${cssContent}</style>`,
    );

    // Replace external JS script with injection + inlined <script type="module">.
    // Function replacement required: minified JS bundle contains $ patterns.
    const inlinedScript = `${injection}<script type="module">${jsContent}</script>`;
    html = html.replace(
        /<script type="module"[^>]*src="[^"]*index-[^"]+\.js"[^>]*><\/script>/,
        () => inlinedScript,
    );

    // Strip the body live-mode script that Bun bundles from src/index.html.
    // WHY: dist/static/index.html retains the body script from src/index.html.
    // That script runs AFTER the head injection, so it would overwrite 'static'
    // back to 'live'. Remove the entire script tag so the injection's 'static' wins.
    // The pattern matches either the old form (mode only) or the new form (mode +
    // surface) so this stays robust across rebuilds of the bundle.
    html = html.replace(/<script>window\.__IGNATIUS_MODE__ = 'live';[\s\S]*?<\/script>/g, '');

    return html;
}
