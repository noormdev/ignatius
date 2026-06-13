import type { ModelNode } from '../../../model/parse';
import { ClassificationBadge } from './ClassificationBadge';

/**
 * GridCard — compact entity card for the Dictionary browse lens.
 *
 * Shows: group color accent (left border), entity name, classification badge,
 * PK column list, column count, and a ⓘ affordance for the rich modal.
 *
 * The card body's hover/click surface drives spotlight (CP3). The ⓘ click
 * must not propagate to the card body so it never triggers spotlight pin.
 */
export function GridCard({
  node,
  groupColor,
  spotlitClass,
  onOpenEntity,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  node: ModelNode;
  groupColor: string | undefined;
  /** CSS modifier class for spotlight dimming/spotlighting. Empty string = no modifier. */
  spotlitClass: string;
  onOpenEntity: (id: string) => void;
  onMouseEnter: (id: string) => void;
  onMouseLeave: (id: string) => void;
  onClick: (id: string) => void;
}) {
  const pkCols = node.pk ?? [];
  const colCount = Object.keys(node.columns).length;

  function handleInfoClick(e: React.MouseEvent) {
    e.stopPropagation();
    onOpenEntity(node.id);
  }

  function handleMouseEnter() { onMouseEnter(node.id); }
  function handleMouseLeave() { onMouseLeave(node.id); }
  function handleClick(e: React.MouseEvent) {
    // Stop propagation so the click doesn't bubble to the .dict-browse-lens
    // empty-area handler, which would immediately clear the pin we just set.
    e.stopPropagation();
    onClick(node.id);
  }

  const className = spotlitClass
    ? `dict-grid-card ${spotlitClass}`
    : 'dict-grid-card';

  return (
    <div
      className={className}
      data-entity-id={node.id}
      style={groupColor ? { borderLeftColor: groupColor } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className="dict-grid-card-header">
        <span className="dict-grid-card-name">{node.id}</span>
        <button
          className="dict-grid-card-info"
          aria-label={`Open ${node.id} details`}
          onClick={handleInfoClick}
          type="button"
        >
          ⓘ
        </button>
      </div>
      <div className="dict-grid-card-badge">
        <ClassificationBadge cls={node.classification} />
      </div>
      {pkCols.length > 0 && (
        <div className="dict-grid-card-pk">
          {pkCols.map(col => (
            <span key={col} className="dict-grid-card-pk-col">{col}</span>
          ))}
        </div>
      )}
      <div className="dict-grid-card-col-count">
        {colCount} {colCount === 1 ? 'column' : 'columns'}
      </div>
    </div>
  );
}
