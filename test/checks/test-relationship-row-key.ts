/**
 * test-relationship-row-key.ts — unit tests for relationshipRowKey.
 *
 * WHY: ChildrenTable keyed downstream-relationship rows by `edge.source` alone.
 * When an entity has two FK edges from the SAME neighbor, that key collides and
 * React drops/duplicates a row. This happens for:
 *   - self-referential associatives (Related_Memory → Memory via memory_id AND
 *     related_memory_id; Task_Dependency → Task via two composite FKs), and
 *   - dual-FK transition tables (TrackingStatus_Allowed → TrackingStatus via
 *     from_status AND to_status).
 * The FK column mapping (`edge.on`) is the only thing that distinguishes such
 * edges, so the row key must incorporate it. These tests pin that invariant:
 * within one entity's child set, every edge yields a distinct key.
 */

import { relationshipRowKey } from '../../src/app/logic/relationship-key';
import type { ModelEdge } from '../../src/model/parse';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function edge(source: string, target: string, on: Record<string, string>): ModelEdge {
  return {
    source,
    target,
    identifying: false,
    on,
    predicate: { fwd: 'relates to', rev: 'relates from' },
    cardinality: { parent: '1', child: 'many' },
  };
}

// Two edges from the same source to the same target, differing only in their FK
// mapping (the self-referential Related_Memory → Memory case) must NOT collide.
const relSource = edge('Related_Memory', 'Memory', { memory_id: 'memory_id' });
const relTarget = edge('Related_Memory', 'Memory', { related_memory_id: 'memory_id' });
assert(
  relationshipRowKey(relSource) !== relationshipRowKey(relTarget),
  `self-referential associative edges must yield distinct keys (both got "${relationshipRowKey(relSource)}")`,
);
console.log('PASS: self-referential associative (Related_Memory → Memory)');

// Composite-FK self-reference: Task_Dependency → Task on two composite FKs.
const depFrom = edge('Task_Dependency', 'Task', { milestone_id: 'milestone_id', task_no: 'task_no' });
const depTo = edge('Task_Dependency', 'Task', { dep_milestone_id: 'milestone_id', dep_task_no: 'task_no' });
assert(
  relationshipRowKey(depFrom) !== relationshipRowKey(depTo),
  `composite-FK self-reference edges must yield distinct keys (both got "${relationshipRowKey(depFrom)}")`,
);
console.log('PASS: composite-FK self-reference (Task_Dependency → Task)');

// Dual-FK transition table: TrackingStatus_Allowed → TrackingStatus on from/to.
const allowedFrom = edge('TrackingStatus_Allowed', 'TrackingStatus', { from_status: 'tracking_status' });
const allowedTo = edge('TrackingStatus_Allowed', 'TrackingStatus', { to_status: 'tracking_status' });
assert(
  relationshipRowKey(allowedFrom) !== relationshipRowKey(allowedTo),
  `dual-FK transition-table edges must yield distinct keys (both got "${relationshipRowKey(allowedFrom)}")`,
);
console.log('PASS: dual-FK transition table (TrackingStatus_Allowed → TrackingStatus)');

// The real invariant: across an entity's whole child set, all keys are unique.
const childSet: ModelEdge[] = [relSource, relTarget, edge('Project_Memory', 'Memory', { memory_id: 'memory_id' })];
const keys = childSet.map(relationshipRowKey);
assert(new Set(keys).size === keys.length, `child-set keys must all be unique (got ${JSON.stringify(keys)})`);
console.log('PASS: whole child set yields unique keys');

// Determinism: the same edge always produces the same key, regardless of on-key
// insertion order (object key order must not change the result).
const a = edge('Task_Dependency', 'Task', { milestone_id: 'milestone_id', task_no: 'task_no' });
const b = edge('Task_Dependency', 'Task', { task_no: 'task_no', milestone_id: 'milestone_id' });
assert(
  relationshipRowKey(a) === relationshipRowKey(b),
  `key must be stable across on-key insertion order ("${relationshipRowKey(a)}" vs "${relationshipRowKey(b)}")`,
);
console.log('PASS: deterministic across on-key order');

console.log('All relationship-row-key tests passed.');
