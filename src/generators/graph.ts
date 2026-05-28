import type { Model } from '../parse';
import { join } from 'node:path';

export async function generateGraph(
  model: Model,
  mode: 'dark' | 'light',
  bundleDir = 'dist/static',
): Promise<string> {
  const htmlFile = Bun.file(join(bundleDir, 'index.html'));
  const htmlTemplate = await htmlFile.text();

  // Find the bundled JS and CSS filenames from the HTML (e.g. index-<hash>.js)
  const jsMatch = htmlTemplate.match(/src="(\.\/index-[^"]+\.js)"/);
  const cssMatch = htmlTemplate.match(/href="(\.\/index-[^"]+\.css)"/);

  const jsFilename = jsMatch?.[1]?.replace('./', '');
  const cssFilename = cssMatch?.[1]?.replace('./', '');

  if (!jsFilename || !cssFilename) {
    throw new Error(
      `Could not find bundled JS/CSS in ${bundleDir}/index.html. ` +
      `Expected src="./index-*.js" and href="./index-*.css". ` +
      `Run: bun build src/index.html --outdir=dist/static --minify --target=browser`
    );
  }

  const jsRaw = await Bun.file(join(bundleDir, jsFilename)).text();
  const cssContent = await Bun.file(join(bundleDir, cssFilename)).text();

  // Escape </script> occurrences in the JS bundle so the browser HTML parser doesn't
  // prematurely close the inline <script> tag. React's source contains this string
  // intentionally (XSS protection in dangerouslySetInnerHTML).
  // Replacing </script> with <\/script>: the HTML parser checks for `</` followed by
  // an ASCII alpha after `<`, but `\/` starts with `\` (not `<`) so the backslash breaks
  // the end-tag detection. The JS runtime treats `\/` as `/` inside strings, preserving
  // the original value at runtime.
  const jsContent = jsRaw.replace(/<\/script>/gi, () => '<\\/script>');

  // Inject the model and theme before the React module so App can read them synchronously
  const injection = `<script>window.__MODEL__ = ${JSON.stringify(model)}; window.__THEME_MODE__ = "${mode}";</script>`;

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

  return html;
}
