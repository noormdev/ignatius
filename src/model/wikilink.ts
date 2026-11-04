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
  /** Mutated in place: the id each `[[target]]` resolves to (the target itself when unresolved), in order. */
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

/** A file name is its title with hyphens for spaces, so `Answer Turn` names `Answer-Turn`. */
function hyphenate(target: string): string {
  return target.replace(/\s+/g, '-');
}

/** The ids a `[[target]]` may name, in order: the target, then its hyphenated form. */
export function targetCandidates(target: string): string[] {
  const hyphenated = hyphenate(target);
  return hyphenated === target ? [target] : [target, hyphenated];
}

/** The known id a `[[target]]` names, or null. */
export function canonicalTarget(target: string, knownIds: ReadonlySet<string>): string | null {
  return targetCandidates(target).find(id => knownIds.has(id)) ?? null;
}

// Both take HTML-escaped values.
function liveLink(target: string, label: string): string {
  return `<a class="entity-link" data-entity="${target}" href="#entity-${target}">${label}</a>`;
}

// LIVE_LINK and MISSING_LINK are regexes built from this markup: keep its literal parts free of regex metacharacters.
function missingLink(target: string, label: string): string {
  return `<span class="entity-link entity-link--missing" title="Unknown entity: ${target}">${label}</span>`;
}

const MISSING_LINK = new RegExp(missingLink('([^"]*)', '([^<]*)'), 'g');
const LIVE_LINK = new RegExp(liveLink('([^"]*)', '([^<]*)').replace('#entity-([^"]*)', '#entity-[^"]*'), 'g');

/** Rewrite every link as a live anchor on its hyphenated target, so two renders of one body compare equal whichever targets exist. */
export function linkStateNeutral(html: string): string {
  const neutral = (_match: string, target: string, label: string) => liveLink(hyphenate(target), label);
  return html.replace(MISSING_LINK, neutral).replace(LIVE_LINK, neutral);
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
      const known = env.knownIds;
      const resolved = known ? canonicalTarget(target, known) : target;
      if (env.links) env.links.push(resolved ?? target);
      const esc = md.utils.escapeHtml;

      const token = state.push('html_inline', '', 0);
      token.content = resolved === null ? missingLink(esc(target), esc(label)) : liveLink(esc(resolved), esc(label));
    }

    state.pos = close + 2;
    return true;
  });
}
