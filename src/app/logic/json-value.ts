/**
 * Recognition and formatting for structured (JSON) example values.
 *
 * Kept free of React so the detection and truncation rules are testable in a
 * plain check without a DOM.
 */

const JSON_TYPES = new Set(['json', 'jsonb']);

/** True when a declared column `type` denotes a structured document. */
export function isJsonType(type: string | undefined): boolean {
  if (type === undefined) return false;
  return JSON_TYPES.has(type.trim().toLowerCase());
}

/**
 * Resolves an example cell to the structured value it should render as, or
 * `null` when the cell is an ordinary scalar.
 *
 * Two independent triggers, because authors arrive here two ways: a nested YAML
 * map or list parses straight into an object whatever the declared type says,
 * while a `json` column written as a quoted string arrives as text that still
 * holds a document. A quoted string on a non-`json` column stays text — the
 * declared type is what licenses parsing it.
 */
export function asJsonValue(raw: unknown, columnType?: string): object | null {
  if (typeof raw === 'object' && raw !== null) return raw;
  if (typeof raw !== 'string' || !isJsonType(columnType)) return null;

  const trimmed = raw.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

/** Pretty-printed form for the expanded view. */
export function formatJsonFull(value: object): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

/**
 * Single-line preview for a table cell, clipped on a character budget rather
 * than a CSS ellipsis: these cells sit in horizontally scrolling tables, where
 * full text would set the column width from the longest document in the table
 * even while it renders visually truncated.
 */
export function formatJsonPreview(value: object, maxLength = 48): string {
  let compact: string;
  try {
    compact = JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1))}…`;
}

/** Short shape summary, shown beside the column name in the expanded view. */
export function describeJson(value: object): string {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  const count = Object.keys(value).length;
  return `${count} key${count === 1 ? '' : 's'}`;
}
