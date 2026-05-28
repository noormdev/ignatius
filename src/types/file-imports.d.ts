/**
 * Type augmentation for Bun's `with { type: 'file' }` import attribute.
 *
 * WHY: bun-types declares `*.html` imports as `HTMLBundle` (for Bun.serve() route
 * usage), but `import path from "file" with { type: "file" }` in a compiled binary
 * yields a plain string path at runtime. TypeScript cannot differentiate import
 * styles by import attributes alone.
 *
 * Fix strategy:
 * - `.js` from dist/static: tsc resolves the real module; override with a path-specific
 *   ambient declaration that declares the default export as `string`.
 * - `.css`: wildcard ambient module (no bun-types wildcard exists for this extension).
 * - `.html`: bun-types wildcard (`HTMLBundle`) wins and cannot be overridden by a second
 *   wildcard. Add a `Bun.file()` overload that accepts `HTMLBundle`.
 */

// Override for the compiled binary's bundled JS asset.
// Without this, tsc resolves dist/static/index.js as a real module and types it as
// the module namespace object, which is not assignable to `string | URL`.
declare module '../../dist/static/index.js' {
  const path: string;
  export default path;
}

// Wildcard ambient declaration for CSS file imports (`with { type: "file" }`).
// bun-types has no wildcard for `.css`, so tsc would otherwise fail to resolve it.
declare module '*.css' {
  const path: string;
  export default path;
}

// Wildcard ambient declaration for SVG file imports (`with { type: "file" }`).
declare module '*.svg' {
  const path: string;
  export default path;
}

// Bun.file() augmentation for the `.html` case.
// bun-types declares `*.html` as `HTMLBundle` — that wildcard cannot be overridden.
// Instead, add an overload so `Bun.file(htmlBundle)` type-checks correctly.
// This matches Bun's runtime behavior where HTMLBundle wraps a path string.
declare namespace Bun {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function file(bundle: HTMLBundle, options?: BlobPropertyBag): BunFile;
}
