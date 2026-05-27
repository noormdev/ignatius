import { parseStructure } from './parse';
import { buildModel } from './build';
import { derive, seedDeclaredGroups } from './derive';
import { validate } from './validate';
import { layout } from './layout';
import type { Model, Issue, LayoutResult, EdgeRoutes } from './types';

export type EngineResult =
  | { ok: true;  model: Model; positions: LayoutResult; edgeRoutes: EdgeRoutes; issues: Issue[] }
  | { ok: false; model?: Model; positions?: LayoutResult; edgeRoutes?: EdgeRoutes; issues: Issue[] };

export async function run(yamlText: string): Promise<EngineResult> {
  const { doc, issues: parseIssues } = parseStructure(yamlText);
  if (!doc) return { ok: false, issues: parseIssues };

  const model = buildModel(doc);
  seedDeclaredGroups(model.nodes, doc);
  derive(model);

  const validationIssues = validate(model);
  const issues = [...parseIssues, ...validationIssues];
  const hasError = issues.some(i => i.severity === 'error');
  if (hasError) return { ok: false, model, issues };

  const { positions, edgeRoutes } = await layout(model);
  return { ok: true, model, positions, edgeRoutes, issues };
}

export type { Model, Issue, LayoutResult, EdgeRoutes, EdgeRoute } from './types';
export type { Node, Edge, Column, AlternateKey, Constraint, SubtypeCluster, ConstraintSpan, Cardinality, Classification, NodePosition } from './types';
