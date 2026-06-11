import type { EntityError, GlobalError, RuleId } from '../../model/validate';
import type { FlowError } from '../../flows/flow-validate';

export type FindingRow =
  | { kind: 'entity'; ruleId: RuleId; entityId: string; severity: 'warning'; message: string }
  | { kind: 'global'; ruleId: RuleId; severity: 'error'; location: string; reason: string }
  | { kind: 'flow'; ruleId: RuleId; severity: 'warning' | 'error'; location: string; message: string };

export function buildFindingRows(
  globalErrors: GlobalError[],
  entityErrors: EntityError[],
  flowErrors?: FlowError[],
): FindingRow[] {
  const rows: FindingRow[] = [
    ...globalErrors.map((e): FindingRow => ({
      kind: 'global',
      ruleId: e.ruleId,
      severity: 'error',
      location: `${e.omitted.kind}:${e.omitted.id}`,
      reason: e.reason,
    })),
    ...entityErrors.map((e): FindingRow => ({
      kind: 'entity',
      ruleId: e.ruleId,
      entityId: e.entityId,
      severity: 'warning',
      message: e.message,
    })),
    ...(flowErrors ?? []).map((e): FindingRow => ({
      kind: 'flow',
      ruleId: e.ruleId,
      severity: e.severity,
      location: e.processId ? `${e.flowId}/${e.processId}` : e.flowId,
      message: e.message,
    })),
  ];

  // Sort: errors before warnings, then ruleId alphabetical, then location/entityId.
  rows.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    const aLoc = a.kind === 'entity' ? a.entityId : a.location;
    const bLoc = b.kind === 'entity' ? b.entityId : b.location;
    return aLoc.localeCompare(bLoc);
  });

  return rows;
}
