// Wrap long entity names for compact graph nodes. Pure + framework-free so the
// graph viewer and tests can both use it without pulling in Cytoscape/React.

/**
 * Break a long entity name onto multiple lines at word boundaries so a node
 * stays compact instead of growing very wide. Underscores become spaces;
 * PascalCase, acronym→word, and digit↔letter transitions are break
 * opportunities. Names at or under `maxLine` characters are returned unchanged
 * (with underscores spaced). A single word with no break opportunity is left on
 * one line — the caller's `text-max-width` is the final safety net.
 */
export function wrapEntityLabel(id: string, maxLine = 13): string {
  const s = id.replace(/_/g, ' ');
  if (s.length <= maxLine) return s;

  // Collect indices where a new word can start.
  const breaks = new Set<number>();
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]!, ch = s[i]!, next = s[i + 1];
    if (ch === ' ') continue;
    if (prev === ' ') breaks.add(i);                                          // after a space
    else if (prev >= 'a' && prev <= 'z' && ch >= 'A' && ch <= 'Z') breaks.add(i); // camelCase
    else if (/[0-9]/.test(prev) !== /[0-9]/.test(ch)) breaks.add(i);          // digit↔letter
    else if (prev >= 'A' && prev <= 'Z' && ch >= 'A' && ch <= 'Z' && next && next >= 'a' && next <= 'z') {
      breaks.add(i);                                                          // ACRONYMWord → ACRONYM Word
    }
  }

  // Greedy line packing: break at the last opportunity before overflowing.
  let result = '', lineStart = 0, lastBreak = -1;
  for (let i = 1; i <= s.length; i++) {
    if (i - lineStart > maxLine && lastBreak > lineStart) {
      result += s.slice(lineStart, lastBreak).replace(/\s+$/, '') + '\n';
      lineStart = lastBreak;
      while (s[lineStart] === ' ') lineStart++;
      lastBreak = -1;
    }
    if (breaks.has(i)) lastBreak = i;
  }
  result += s.slice(lineStart);
  return result;
}
