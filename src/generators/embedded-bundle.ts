/**
 * Embedded bundle assets for the compiled ignatius binary.
 *
 * WHY: When Bun compiles a binary with `bun build --compile`, it embeds files
 * imported with `{ type: 'file' }`. At runtime, the path resolves to an
 * internal `$bunfs/` location — no filesystem access needed.
 *
 * These imports MUST point to stable file names (not content-hashed) so that
 * `bun build --compile` can resolve them at compile time.
 *
 * The stable names (index.html, index.js, index.css) are produced by the
 * build:bundle script, which copies the hashed outputs to fixed names.
 */

import { Glob } from 'bun';
import { join } from 'node:path';

import bundleHtmlPath from '../../dist/static/index.html' with { type: 'file' };
import bundleJsPath from '../../dist/static/index.js' with { type: 'file' };
import bundleCssPath from '../../dist/static/index.css' with { type: 'file' };

/**
 * The raw content of the three compiled bundle assets.
 *
 * WHY here (not graph.ts): this is the canonical producer of BundleContent —
 * the embedded binary reads it via loadEmbeddedBundle; the disk-read path
 * (loadBundleFromDir in app.ts) is only used during development. Keeping the
 * type here avoids a circular dependency now that graph.ts is deleted.
 */
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
 * WHY: When running in development mode (bun src/cli/cli.ts) the bundle lives in
 * dist/static/ and we read it from disk. When running as a compiled binary the
 * caller passes the content directly via loadEmbeddedBundle().
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
      `Run: bun build src/app/index.html --outdir=dist/static --minify --target=browser\n` +
      `Bundle dir contents: ${dirContents.join(', ')}`,
    );
  }

  const jsContent = await Bun.file(join(bundleDir, jsFilename)).text();
  const cssContent = await Bun.file(join(bundleDir, cssFilename)).text();

  return { htmlTemplate, cssContent, jsContent };
}

/**
 * Read the embedded bundle assets at runtime.
 *
 * When running as a dev script (bun src/cli/cli.ts), these are real paths on disk.
 * When running as a compiled binary, Bun rewrites them to $bunfs/ paths with the
 * content baked in — so Bun.file().text() still works, no external files needed.
 */
export async function loadEmbeddedBundle(): Promise<BundleContent> {
  // The embedded index.html still references hashed filenames in <link>/<script>
  // tags, but we bypass those references entirely — we read the JS and CSS from
  // the embedded stable-name files and build a synthetic template.
  const htmlFile = Bun.file(bundleHtmlPath);
  const jsFile = Bun.file(bundleJsPath);
  const cssFile = Bun.file(bundleCssPath);

  const [htmlExists, jsExists, cssExists] = await Promise.all([
    htmlFile.exists(), jsFile.exists(), cssFile.exists(),
  ]);
  if (!htmlExists || !jsExists || !cssExists) {
    throw new Error(
      'Bundle missing — dist/static/{index.html,index.js,index.css} not found.\n' +
      'Run: bun run build:bundle\n' +
      'Or:  bun run build:cli  (full build with stable names + compile)',
    );
  }

  const [htmlTemplate, jsContent, cssContent] = await Promise.all([
    htmlFile.text(), jsFile.text(), cssFile.text(),
  ]);

  return { htmlTemplate, cssContent, jsContent };
}
