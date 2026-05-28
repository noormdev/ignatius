/**
 * Embedded bundle assets for the compiled derek binary.
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

import bundleHtmlPath from '../../dist/static/index.html' with { type: 'file' };
import bundleJsPath from '../../dist/static/index.js' with { type: 'file' };
import bundleCssPath from '../../dist/static/index.css' with { type: 'file' };

import type { BundleContent } from './graph';

/**
 * Read the embedded bundle assets at runtime.
 *
 * When running as a dev script (bun src/cli.ts), these are real paths on disk.
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
