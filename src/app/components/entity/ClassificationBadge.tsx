export const KNOWN_CLASSIFICATIONS = new Set([
  'independent', 'dependent', 'classifier', 'subtype', 'associative',
]);

export function ClassificationBadge({ cls }: { cls: string }) {
  const key = cls.toLowerCase();
  if (!KNOWN_CLASSIFICATIONS.has(key)) {
    return (
      <span className="dict-badge" style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}>
        {cls}
      </span>
    );
  }
  return (
    <span
      className="dict-badge"
      style={{
        background: `var(--badge-${key}-bg)`,
        color: `var(--badge-${key}-fg)`,
      }}
    >
      {cls}
    </span>
  );
}
