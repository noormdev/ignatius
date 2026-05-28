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

// @ts-ignore — Bun's `with { type: 'file' }` import attribute is not yet in
// the TypeScript type definitions, but it works at runtime and compile time.
import bundleHtmlPath from '../../dist/static/index.html' with { type: 'file' };
// @ts-ignore
import bundleJsPath from '../../dist/static/index.js' with { type: 'file' };
// @ts-ignore
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
  const [htmlTemplate, jsContent, cssContent] = await Promise.all([
    Bun.file(bundleHtmlPath as string).text(),
    Bun.file(bundleJsPath as string).text(),
    Bun.file(bundleCssPath as string).text(),
  ]);

  return { htmlTemplate, cssContent, jsContent };
}
