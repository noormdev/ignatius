import bash from '@shikijs/langs-precompiled/bash';
import javascript from '@shikijs/langs-precompiled/javascript';
import json from '@shikijs/langs-precompiled/json';
import python from '@shikijs/langs-precompiled/python';
import sql from '@shikijs/langs-precompiled/sql';
import typescript from '@shikijs/langs-precompiled/typescript';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRawEngine } from 'shiki/engine/javascript';

/**
 * Code-fence highlighting for entity and process body markdown.
 *
 * Deliberately separate from the browser's `src/app/logic/json-highlight.ts`,
 * which loads the json grammar alone. Grammars are static imports and cannot be
 * tree-shaken, so one shared module would drag all six into the browser bundle
 * — about 620KB against the ~130KB the popup actually needs. This module runs
 * only where `parse.ts` runs: the dev server and the CLI, both of which reach
 * the browser as already-rendered `bodyHtml`. App code imports `parse.ts` for
 * types alone, so none of this crosses into the bundle.
 *
 * See `json-highlight.ts` for why the engine, the sync constructor, and
 * `defaultColor: false` are what they are — the reasoning is identical.
 */
const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [json, sql, javascript, typescript, python, bash],
  engine: createJavaScriptRawEngine(),
});

const loaded = new Set(highlighter.getLoadedLanguages());

/**
 * markdown-it `highlight` callback. Returns a complete `<pre>` block, which
 * tells markdown-it to emit it verbatim rather than wrapping it again.
 *
 * An empty string hands the fence back to markdown-it's default escaping —
 * the right answer for an unfenced block, an unbundled language, or a grammar
 * that chokes on the snippet. A body must never fail to render because a code
 * fence was tagged with something we don't carry.
 */
export function highlightCodeFence(code: string, lang: string): string {
  if (lang === '' || !loaded.has(lang)) return '';
  try {
    return highlighter.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    return '';
  }
}
