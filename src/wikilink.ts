// Wiki-style entity links in entity-body markdown.
//
// `[[Customer]]`          → a link labelled "Customer" pointing at the Customer
//                           entity.
// `[[Customer|the buyer]]` → a link labelled "the buyer" pointing at Customer.
//
// The same anchor serves both surfaces: the dict rides its `href="#entity-Id"`
// (native anchor scroll), the graph reads `data-entity` and drives the modal.
// A target that matches no known entity renders as a non-navigating "missing"
// span and is reported separately as a `body.unknown_link` finding.
//
// markdown-it 14 ships no types in this repo, so the few state/instance members
// this rule touches are described by minimal local interfaces (the project's
// convention for untyped libraries) rather than `any`.

/** Render-time context threaded through `md.render(src, env)`. */
export interface WikiLinkEnv {
  /** Ids that resolve. Absent → links render optimistically (no missing mark). */
  knownIds?: Set<string>;
  /** Mutated in place: every `[[target]]` seen during the render, in order. */
  links?: string[];
}

interface InlineToken {
  content: string;
}

interface InlineState {
  src: string;
  pos: number;
  posMax: number;
  env: WikiLinkEnv;
  push(type: string, tag: string, nesting: number): InlineToken;
}

interface MarkdownItLike {
  inline: {
    ruler: {
      before(
        beforeName: string,
        ruleName: string,
        fn: (state: InlineState, silent: boolean) => boolean,
      ): void;
    };
  };
  utils: { escapeHtml(str: string): string };
}

const OPEN = 0x5b; // '['

/** Split `target|label` into its parts; label defaults to the target. */
export function splitWikiTarget(inner: string): { target: string; label: string } {
  const pipe = inner.indexOf('|');
  if (pipe === -1) {
    const target = inner.trim();
    return { target, label: target };
  }
  const target = inner.slice(0, pipe).trim();
  const label = inner.slice(pipe + 1).trim();
  return { target, label: label || target };
}

/** markdown-it plugin: register the `[[…]]` inline rule. */
export function wikiLinkPlugin(md: MarkdownItLike): void {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const { src, pos } = state;
    // Require a literal `[[` here.
    if (src.charCodeAt(pos) !== OPEN || src.charCodeAt(pos + 1) !== OPEN) return false;

    const close = src.indexOf(']]', pos + 2);
    if (close === -1 || close > state.posMax) return false;

    const inner = src.slice(pos + 2, close);
    // Reject nested brackets or line breaks — keeps the grammar to a single
    // `[[ ... ]]` span and avoids swallowing adjacent markdown.
    if (/[\[\]\n]/.test(inner) || inner.trim() === '') return false;

    if (!silent) {
      const { target, label } = splitWikiTarget(inner);
      if (target === '') return false;

      const env = state.env;
      if (env.links) env.links.push(target);

      const known = env.knownIds;
      const missing = known ? !known.has(target) : false;
      const esc = md.utils.escapeHtml;

      const token = state.push('html_inline', '', 0);
      token.content = missing
        ? `<span class="entity-link entity-link--missing" title="Unknown entity: ${esc(target)}">${esc(label)}</span>`
        : `<a class="entity-link" data-entity="${esc(target)}" href="#entity-${esc(target)}">${esc(label)}</a>`;
    }

    state.pos = close + 2;
    return true;
  });
}
