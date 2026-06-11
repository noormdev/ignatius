// Converts a slug, folder name, or identifier into a human-readable Title Case
// string. Pure + framework-free.
//
// Rules applied in order:
//   1. Split on hyphens and underscores (explicit word separators).
//   2. Within each segment, split further at camelCase, PascalCase, ACRONYM→Word,
//      and letter↔digit boundaries.
//   3. Title-case each resulting word.
//   4. Join with spaces.
//
// Examples:
//   order-to-cash       → "Order To Cash"
//   Create-Sales-Order  → "Create Sales Order"
//   orderToCash         → "Order To Cash"
//   HTTPRequest         → "HTTP Request"
//   order2cash          → "Order 2 Cash"

export function titlelize(slug: string): string {
  if (!slug) return '';

  // Step 1: split on hyphens and underscores into coarse segments.
  const coarse = slug.split(/[-_]+/);

  // Step 2: within each segment, split on camelCase / acronym / digit boundaries.
  const words: string[] = [];
  for (const segment of coarse) {
    if (!segment) continue;
    // Insert a space before each transition:
    //   lower→Upper (camelCase boundary)
    //   Upper→Upper+lower (ACRONYMWord boundary, e.g. "HTTPRequest" → "HTTP Request")
    //   letter→digit or digit→letter
    const split = segment
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .split(' ');
    for (const w of split) {
      if (w) words.push(w);
    }
  }

  // Step 3: Title-case each word (uppercase first char, keep the rest as-is).
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
