import type { ModelEdge } from '../../model/parse';

/**
 * Stable, collision-free React key for one relationship row.
 *
 * ChildrenTable previously keyed rows by `edge.source` alone. That collides when
 * an entity has two FK edges from the same neighbor — a self-referential
 * associative (Related_Memory → Memory via `memory_id` and `related_memory_id`)
 * or a dual-FK transition table (TrackingStatus_Allowed → TrackingStatus via
 * `from_status` and `to_status`). Two such edges share source and target, so the
 * FK column mapping (`on`) is the only thing that distinguishes them and must be
 * part of the key. The `on` pairs are sorted so the key is independent of object
 * key insertion order.
 */
export function relationshipRowKey(edge: ModelEdge): string {
  const onPairs = Object.entries(edge.on)
    .map(([child, parent]) => `${child}:${parent}`)
    .sort()
    .join(',');
  return `${edge.source}>${edge.target}#${onPairs}`;
}
