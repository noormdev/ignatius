import jsonLang from '@shikijs/langs-precompiled/json';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRawEngine } from 'shiki/engine/javascript';

/**
 * Shiki, assembled by hand rather than through a bundled preset.
 *
 * Three choices keep this out of the way of how the app ships:
 *
 * - The *raw* JavaScript engine over a *precompiled* grammar. The default
 *   engine is Oniguruma, which loads a WebAssembly blob — `export` has to
 *   produce one self-contained HTML file that makes no network request, and a
 *   `.wasm` fetch would break both.
 * - `createHighlighterCoreSync`, because the render path is synchronous React.
 * - `defaultColor: false`, so every token carries `--shiki-light` and
 *   `--shiki-dark` custom properties and picks neither. `styles.css` resolves
 *   them off the existing `.theme-*` root class, which is what keeps the
 *   dialog on the app's own theme switch instead of shiki's.
 */
const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [jsonLang],
  engine: createJavaScriptRawEngine(),
});

/**
 * Highlighted markup for a pretty-printed JSON document.
 *
 * Shiki escapes the source, so the result is safe to inject — `test-json-highlight`
 * pins that, since the input is model data and the output goes through
 * `dangerouslySetInnerHTML`.
 */
export function highlightJson(code: string): string {
  return highlighter.codeToHtml(code, {
    lang: 'json',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
}
