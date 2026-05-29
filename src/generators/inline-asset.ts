import { resolve, extname } from 'path';

const MIME_MAP: Record<string, string> = {
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
};

function mimeForPath(pathOrUrl: string): string {
  const ext = extname(pathOrUrl).toLowerCase();
  return MIME_MAP[ext] ?? 'image/png';
}

function toDataUri(bytes: Uint8Array, mime: string): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${b64}`;
}

/**
 * Resolves a logo source to a base64 data URI for static embedding.
 *
 * - Unset/empty → returns embeddedFallback (the pre-embedded asset's data URI)
 * - URL (http/https) → fetches bytes, base64-encodes; throws with the URL on failure
 * - Filepath → resolves relative to modelsDir, reads bytes; throws with absolute path if missing
 * - MIME type derived from file extension; unknown extensions default to image/png
 */
export async function inlineAsset(
  srcOrUrl: string | undefined,
  modelsDir: string,
  embeddedFallback: string,
): Promise<string> {
  if (!srcOrUrl) return embeddedFallback;
  // Already a data URI — return as-is (e.g. pre-embedded default logo)
  if (srcOrUrl.startsWith('data:')) return srcOrUrl;

  if (srcOrUrl.startsWith('http://') || srcOrUrl.startsWith('https://')) {
    let response: Response;
    try {
      response = await fetch(srcOrUrl);
    } catch (e) {
      throw new Error(`Failed to fetch logo URL: ${srcOrUrl}`);
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch logo URL: ${srcOrUrl} (HTTP ${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return toDataUri(bytes, mimeForPath(srcOrUrl));
  }

  // Treat as filepath relative to modelsDir
  const absPath = resolve(modelsDir, srcOrUrl);
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    throw new Error(`Logo file not found: ${absPath}`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return toDataUri(bytes, mimeForPath(absPath));
}
