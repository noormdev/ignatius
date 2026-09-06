/**
 * write.ts — replaces the `<ignatius-index>` region (and the sibling
 * `<ignatius-breadcrumb>` region directly above it) in each `RouterFile`'s
 * target path, creating the file when it doesn't exist. Region-scoped
 * writes only; bytes outside a generator-owned region survive a run
 * untouched. Guidance files (AGENTS.md/CLAUDE.md/SKILL.md) are written by
 * `agents.ts`.
 */

import { readRegion, replaceRegion } from './region';
import type { RouterFile } from './build';

function ensureBreadcrumb(content: string, breadcrumb: string): string {
  if (breadcrumb === '') return content;

  if (readRegion(content, 'ignatius-breadcrumb') !== null) {
    return replaceRegion(content, 'ignatius-breadcrumb', {}, breadcrumb);
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const tagLineIdx = lines.findIndex(line => /^<ignatius-index[\s>]/.test(line));
  if (tagLineIdx === -1) return content;

  const before = lines.slice(0, tagLineIdx);
  const after = lines.slice(tagLineIdx);

  const block = `<ignatius-breadcrumb>${eol}${eol}${breadcrumb}${eol}${eol}</ignatius-breadcrumb>`;
  const insertion = before.length > 0 && before[before.length - 1] !== '' ? ['', block, ''] : [block, ''];
  return [...before, ...insertion, ...after].join(eol);
}

export async function writeRouters(root: string, files: RouterFile[]): Promise<void> {
  for (const file of files) {
    const path = `${root}/${file.relPath}`;

    // Bun.write creates any missing intermediate directories.
    const existing = await Bun.file(path).exists() ? await Bun.file(path).text() : '';
    try {
      const withRegion = replaceRegion(existing, 'ignatius-index', file.attrs, file.table);
      const withBreadcrumb = ensureBreadcrumb(withRegion, file.breadcrumb);
      await Bun.write(path, withBreadcrumb);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${file.relPath}: ${message}`);
    }
  }
}
