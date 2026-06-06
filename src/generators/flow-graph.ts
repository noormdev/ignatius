import type { Model } from '../parse';
import type { FlowDiagram } from '../flow-parse';
import type { BundleContent } from './graph';
import { loadBundleFromDir } from './graph';

export type FlowGraphOpts = {
    flowLayoutKey: string;
    themeMode?: 'dark' | 'light';
};

/**
 * Generate a self-contained flow-graph HTML file by injecting the parsed
 * FlowDiagram and surface discriminator into the existing bundled React app.
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
 * entityModel is passed for parity / future cross-nav; currently only
 * flowDiagram is serialised into __FLOW_MODEL__.
 *
 * Accepts either a bundleDir string (reads from disk) or explicit BundleContent
 * (compiled binary embeds it via loadEmbeddedBundle).
 */
export async function generateFlowGraph(
    flowDiagram: FlowDiagram,
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
    // mode → model → theme → layout key → surface discriminator.
    // WHY before the module script: the module script (type="module") is deferred;
    // synchronous scripts run in document order, so placing the injection
    // immediately before it guarantees it executes first.
    const injection =
        `<script>` +
        `window.__IGNATIUS_MODE__ = "static"; ` +
        `window.__FLOW_MODEL__ = ${escapeScriptClose(JSON.stringify(flowDiagram))}; ` +
        `window.__FLOW_LAYOUT_KEY__ = ${escapeScriptClose(JSON.stringify(opts.flowLayoutKey))}; ` +
        `window.__THEME_MODE__ = ${escapeScriptClose(JSON.stringify(themeMode))}; ` +
        `window.__IGNATIUS_SURFACE__ = "flow";` +
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
