// =============================================================================
// util.ts — small shared helpers
// =============================================================================

export function snakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')   // PascalCase -> Pascal_Case
    .replace(/[\s\-]+/g, '_')                 // spaces & hyphens -> underscores
    .toLowerCase();
}
