/**
 * region.ts — parse and rewrite `<ignatius-*>` managed regions in a markdown
 * file. The generator owns only the bytes between its own tags; everything
 * else in the file, including a hand-authored `<ignatius-rules>` block,
 * survives untouched.
 *
 * A tag is a region boundary only when it starts at column 0 and ends its
 * own line. Markdown pushes every prose container (a paragraph, a list item,
 * a fenced example) off column 0, and a fence or a code span is just
 * characters a stray backtick can produce by accident — position is the one
 * thing that can't be spoofed. Everything else on a line, however tag-shaped,
 * is text.
 */

const TAG_RE = /^<(\/?)(ignatius-[\w-]+)([^<>]*)>[ \t]*$/gm;

type Token = { close: boolean; name: string; start: number; end: number; line: number };
type Region = { name: string; start: number; end: number; inner: string; line: number };

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

function hint(token: Token): string {
  const tag = token.close ? `/${token.name}` : token.name;
  return `A line that starts with an <ignatius-*> tag is always a region boundary; to mention a tag as text, indent the line or write &lt;${tag}&gt;.`;
}

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  for (const match of content.matchAll(TAG_RE)) {
    if (match.index === undefined) continue;
    const [whole, slash, name] = match;
    tokens.push({ close: slash === '/', name, start: match.index, end: match.index + whole.length, line: lineOf(content, match.index) });
  }
  return tokens;
}

function trimOneBlankLine(text: string, side: 'lead' | 'trail'): string {
  const re = side === 'lead' ? /^\r?\n(?:\r?\n)?/ : /\r?\n(?:\r?\n)?$/;
  return text.replace(re, '');
}

/**
 * Pair every column-0 `<ignatius-*>`/`</ignatius-*>` token in the file and
 * return the resulting regions. Throws on the first boundary arrangement
 * that isn't a clean alternation of open/close pairs with matching names.
 */
function regions(content: string): Region[] {
  const out: Region[] = [];
  let open: Token | null = null;

  for (const token of tokenize(content)) {
    if (!token.close) {
      if (open) {
        throw new Error(
          `<${token.name}> at line ${token.line} opens inside <${open.name}> (opened at line ${open.line}). Regions cannot nest. ${hint(token)}`,
        );
      }
      open = token;
      continue;
    }

    if (!open) {
      throw new Error(
        `</${token.name}> at line ${token.line} has no opening <${token.name}> above it. Remove it, or restore the opening tag. ${hint(token)}`,
      );
    }

    if (open.name !== token.name) {
      throw new Error(
        `</${token.name}> at line ${token.line} closes <${open.name}> (opened at line ${open.line}). The closing tag must be </${open.name}>.`,
      );
    }

    const inner = trimOneBlankLine(trimOneBlankLine(content.slice(open.end, token.start), 'lead'), 'trail');
    out.push({ name: open.name, start: open.start, end: token.end, inner, line: open.line });
    open = null;
  }

  if (open) {
    throw new Error(
      `<${open.name}> at line ${open.line} has no closing </${open.name}>. Add the closing tag on its own line at column 0, or delete the file if it is a leftover partial write.`,
    );
  }

  const firstLineOf = new Map<string, number>();
  for (const region of out) {
    const seenAt = firstLineOf.get(region.name);
    if (seenAt !== undefined) {
      throw new Error(`two <${region.name}> regions (lines ${seenAt} and ${region.line}). Keep one.`);
    }
    firstLineOf.set(region.name, region.line);
  }

  return out;
}

/** Extract a named region's inner content, or null when the region is absent. */
export function readRegion(content: string, name: string): string | null {
  const region = regions(content).find((r) => r.name === name);
  return region ? region.inner : null;
}

/**
 * Swap a named region's inner content and attributes in place. Appends the
 * region, with the required blank lines, when it does not already exist.
 */
export function replaceRegion(
  content: string,
  name: string,
  attrs: Record<string, string>,
  inner: string,
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const attrStr = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  const openTag = attrStr ? `<${name} ${attrStr}>` : `<${name}>`;
  const normalizedInner = inner.replace(/\r?\n/g, eol);
  const block = `${openTag}${eol}${eol}${normalizedInner}${eol}${eol}</${name}>`;

  const region = regions(content).find((r) => r.name === name);
  if (!region) {
    const sep = content.length === 0 ? '' : content.endsWith(eol) ? eol : eol + eol;
    return `${content}${sep}${block}${eol}`;
  }

  return content.slice(0, region.start) + block + content.slice(region.end);
}
