interface FenceToken {
  info: string;
  content: string;
}

type RenderRule = (tokens: FenceToken[], idx: number, options: unknown, env: unknown, self: unknown) => string;

interface MarkdownItLike {
  renderer: { rules: { fence?: RenderRule } };
  utils: { escapeHtml(str: string): string };
}

/** markdown-it plugin: render `mermaid` fences as diagram placeholders, every other fence as before. */
export function mermaidFencePlugin(md: MarkdownItLike): void {
  const fallback = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token && token.info.trim().split(/\s+/)[0] === 'mermaid') {
      return `<div class="mermaid-diagram">${md.utils.escapeHtml(token.content)}</div>\n`;
    }
    return fallback ? fallback(tokens, idx, options, env, self) : '';
  };
}
