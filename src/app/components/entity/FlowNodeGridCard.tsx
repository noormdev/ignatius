import type { FlowProcess, FlowExternal, FlowStoreRef } from '../../../flows/flow-parse';
import type { FlowKindKey, FlowKindEntry } from '../../../theme/theme-defaults';

/**
 * FlowNodeGridCard — compact card for the Dictionary browse lens (CP10).
 *
 * Renders one of three flow-node kinds:
 *   - Process: dotted number + label + kind accent (dark process color)
 *   - External: display name + external accent
 *   - Data-store: display name + kind-color accent from the flow-kind palette
 *
 * Card id token scheme (matches the spec's canonical token):
 *   - Process  → `proc:<id>`
 *   - External → `ext:<id>`
 *   - Store    → `<kind>:<name>` (e.g. `file:gateway-log`)
 *
 * The card body hover/click surface wires the spotlight (CP11 will consume it).
 * The ⓘ button stops propagation so it never also pins the spotlight.
 */

// ── Process card ──────────────────────────────────────────────────────────────

export function ProcessGridCard({
  process,
  spotlitClass,
  onOpenNode,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  process: FlowProcess;
  spotlitClass: string;
  onOpenNode: (token: string) => void;
  onMouseEnter: (token: string) => void;
  onMouseLeave: (token: string) => void;
  onClick: (token: string) => void;
}) {
  const token = `proc:${process.id}`;
  const className = ['dict-grid-card', 'dict-flow-grid-card', spotlitClass].filter(Boolean).join(' ');

  function handleInfoClick(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenNode(token);
  }
  function handleMouseEnter() { onMouseEnter(token); }
  function handleMouseLeave() { onMouseLeave(token); }
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick(token);
  }

  return (
    <div
      className={className}
      data-flow-token={token}
      style={{ borderLeftColor: 'var(--color-flow-process-accent)' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className="dict-grid-card-header">
        <span className="dict-grid-card-name">
          <span className="dict-flow-card-number">{process.dottedNumber}</span>
          {' '}{process.label}
        </span>
        <button
          className="dict-grid-card-info"
          aria-label={`Open ${process.label} details`}
          onClick={handleInfoClick}
          type="button"
        >
          ⓘ
        </button>
      </div>
    </div>
  );
}

// ── External card ─────────────────────────────────────────────────────────────

export function ExternalGridCard({
  external,
  kindPalette,
  themeMode,
  spotlitClass,
  onOpenNode,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  external: FlowExternal;
  kindPalette: Record<FlowKindKey, FlowKindEntry>;
  themeMode: 'dark' | 'light';
  spotlitClass: string;
  onOpenNode: (token: string) => void;
  onMouseEnter: (token: string) => void;
  onMouseLeave: (token: string) => void;
  onClick: (token: string) => void;
}) {
  const token = `ext:${external.id}`;
  // external.kind may be absent; fall back to 'external' palette entry for the border accent.
  const kind: FlowKindKey = external.kind ?? 'external';
  const palette = kindPalette[kind];
  const accentColor = palette?.border ?? 'var(--color-flow-external-accent)';

  const className = ['dict-grid-card', 'dict-flow-grid-card', spotlitClass].filter(Boolean).join(' ');

  function handleInfoClick(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenNode(token);
  }
  function handleMouseEnter() { onMouseEnter(token); }
  function handleMouseLeave() { onMouseLeave(token); }
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick(token);
  }

  return (
    <div
      className={className}
      data-flow-token={token}
      style={{ borderLeftColor: accentColor }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className="dict-grid-card-header">
        <span className="dict-grid-card-name">{external.label}</span>
        <button
          className="dict-grid-card-info"
          aria-label={`Open ${external.label} details`}
          onClick={handleInfoClick}
          type="button"
        >
          ⓘ
        </button>
      </div>
      {external.kind && (
        <div className="dict-flow-card-kind" style={{ color: accentColor }}>
          {external.kind}
        </div>
      )}
    </div>
  );
}

// ── Data-store card ───────────────────────────────────────────────────────────

export function StoreGridCard({
  store,
  kindPalette,
  spotlitClass,
  onOpenNode,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  store: FlowStoreRef;
  kindPalette: Record<FlowKindKey, FlowKindEntry>;
  spotlitClass: string;
  onOpenNode: (token: string) => void;
  onMouseEnter: (token: string) => void;
  onMouseLeave: (token: string) => void;
  onClick: (token: string) => void;
}) {
  const token = `${store.kind}:${store.name}`;
  const palette = kindPalette[store.kind];
  const accentColor = palette?.border ?? 'var(--color-border)';

  const className = ['dict-grid-card', 'dict-flow-grid-card', spotlitClass].filter(Boolean).join(' ');

  function handleInfoClick(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenNode(token);
  }
  function handleMouseEnter() { onMouseEnter(token); }
  function handleMouseLeave() { onMouseLeave(token); }
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick(token);
  }

  return (
    <div
      className={className}
      data-flow-token={token}
      style={{ borderLeftColor: accentColor }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className="dict-grid-card-header">
        <span className="dict-grid-card-name">{store.displayName}</span>
        <button
          className="dict-grid-card-info"
          aria-label={`Open ${store.displayName} details`}
          onClick={handleInfoClick}
          type="button"
        >
          ⓘ
        </button>
      </div>
      <div className="dict-flow-card-kind" style={{ color: accentColor }}>
        {store.kind}
      </div>
    </div>
  );
}
