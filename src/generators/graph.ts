import type { Model } from '../parse';
import { Glob } from 'bun';
import { join } from 'node:path';

export type BundleContent = {
  /** Raw HTML template (the index.html with <link> and <script> tags). */
  htmlTemplate: string;
  /** Raw CSS content (already extracted from the bundle). */
  cssContent: string;
  /** Raw JS content (the full bundled module, unescaped). */
  jsContent: string;
};

/**
 * Load bundle content from a directory on disk.
 *
 * WHY: When running in development mode (bun src/cli.ts) the bundle lives in
 * dist/static/ and we read it from disk. When running as a compiled binary the
 * caller passes the content directly via embedBundleContent().
 */
export async function loadBundleFromDir(bundleDir: string): Promise<BundleContent> {
  const htmlFile = Bun.file(join(bundleDir, 'index.html'));
  const htmlTemplate = await htmlFile.text();

  // Find the bundled JS and CSS filenames from the HTML (e.g. index-<hash>.js).
  // The prefix may be './', '/', or absent depending on the bundler configuration.
  const jsMatch = htmlTemplate.match(/src=["'](?:\.\/|\/)?([^"']*index-[^"']+\.js)["']/);
  const cssMatch = htmlTemplate.match(/href=["'](?:\.\/|\/)?([^"']*index-[^"']+\.css)["']/);

  let jsFilename = jsMatch?.[1];
  let cssFilename = cssMatch?.[1];

  // Fallback: glob scan the bundle dir for index-*.js / index-*.css
  if (!jsFilename || !cssFilename) {
    const dirEntries: string[] = [];
    for await (const entry of new Glob('index-*.{js,css}').scan(bundleDir)) {
      dirEntries.push(entry);
    }
    if (!jsFilename) jsFilename = dirEntries.find(e => e.endsWith('.js'));
    if (!cssFilename) cssFilename = dirEntries.find(e => e.endsWith('.css'));
  }

  if (!jsFilename || !cssFilename) {
    const glob = new Glob('*');
    const dirContents: string[] = [];
    for await (const entry of glob.scan(bundleDir)) {
      dirContents.push(entry);
    }
    throw new Error(
      `Could not find bundled JS/CSS in ${bundleDir}/index.html. ` +
      `Expected src="[./]index-*.js" and href="[./]index-*.css". ` +
      `Run: bun build src/index.html --outdir=dist/static --minify --target=browser\n` +
      `Bundle dir contents: ${dirContents.join(', ')}`,
    );
  }

  const jsContent = await Bun.file(join(bundleDir, jsFilename)).text();
  const cssContent = await Bun.file(join(bundleDir, cssFilename)).text();

  return { htmlTemplate, cssContent, jsContent };
}

/**
 * Generate a self-contained graph HTML file by injecting the parsed model and
 * theme into the bundled React app.
 *
 * Accepts either a bundleDir (reads from disk) or explicit BundleContent
 * (used by the compiled binary, which embeds the bundle via Bun's file imports).
 */
export async function generateGraph(
  model: Model,
  mode: 'dark' | 'light',
  sourceOrDir: string | BundleContent = 'dist/static',
): Promise<string> {
  const bundle: BundleContent =
    typeof sourceOrDir === 'string'
      ? await loadBundleFromDir(sourceOrDir)
      : sourceOrDir;

  const { htmlTemplate, cssContent, jsContent: jsRaw } = bundle;

  // Escape </script> occurrences in the JS bundle so the browser HTML parser doesn't
  // prematurely close the inline <script> tag. React's source contains this string
  // intentionally (XSS protection in dangerouslySetInnerHTML).
  // Replacing </script> with <\/script>: the HTML parser checks for `</` followed by
  // an ASCII alpha after `<`, but `\/` starts with `\` (not `<`) so the backslash breaks
  // the end-tag detection. The JS runtime treats `\/` as `/` inside strings, preserving
  // the original value at runtime.
  const jsContent = jsRaw.replace(/<\/script>/gi, () => '<\\/script>');

  // Inject the model, theme, and mode flag before the React module so App can read them synchronously.
  // WHY the injection must come before the module script: the module script (type="module") is
  // deferred; synchronous scripts run in document order, so placing the injection immediately
  // before the module script guarantees it executes first.
  const injection = `<script>window.__IGNATIUS_MODE__ = "static"; window.__MODEL__ = ${JSON.stringify(model)}; window.__THEME_MODE__ = "${mode}";</script>`;

  // Replace external CSS link with inlined <style>.
  // Use a function replacement to prevent $ signs in cssContent being interpreted as
  // replacement pattern references (e.g. $& means "insert matched substring").
  let html = htmlTemplate.replace(
    /<link rel="stylesheet"[^>]*href="[^"]*index-[^"]+\.css"[^>]*>/,
    () => `<style>${cssContent}</style>`,
  );

  // Replace external JS script with injection + inlined <script type="module">.
  // Function replacement is required: the minified JS bundle contains $ patterns (e.g.
  // $' means "portion after match") that String.replace() would interpret if the
  // replacement were a plain string.
  const inlinedScript = `${injection}<script type="module">${jsContent}</script>`;
  html = html.replace(
    /<script type="module"[^>]*src="[^"]*index-[^"]+\.js"[^>]*><\/script>/,
    () => inlinedScript,
  );

  // Strip the body 'live' mode script that Bun bundles from src/index.html.
  // WHY: dist/static/index.html retains `window.__IGNATIUS_MODE__ = 'live'` in the
  // <body> from src/index.html. That body script runs AFTER the head injection, so it
  // would overwrite 'static' back to 'live'. Remove it so the injection's 'static' wins.
  html = html.replace(/<script>window\.__IGNATIUS_MODE__ = 'live';<\/script>/g, '');


  return html;
}
