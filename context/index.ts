// =============================================================================
// index.ts — pipeline entry point.
//
// Runs all stages against a YAML file and prints a trace of each stage's
// output. Exits non-zero if any stage produces an error-severity issue.
// =============================================================================

import * as fs from 'fs';
import { parseStructure } from './parse';
import { buildModel } from './build';
import { derive, seedDeclaredGroups } from './derive';
import { validate } from './validate';
import { layout } from './layout';
import { Model, Issue, NodePosition } from './types';

function main(): void {
  const path = process.argv[2] ?? '/mnt/user-data/outputs/sample_model.yaml';
  const yamlText = fs.readFileSync(path, 'utf-8');

  // -----------------------------------------------------------------------
  // Stage 1: structural parse
  // -----------------------------------------------------------------------
  header('STAGE 1: Structural Parse (YAML → RawDoc)');
  const { doc, issues: parseIssues } = parseStructure(yamlText);
  printIssues(parseIssues);
  if (!doc) { exitWithFailure(parseIssues); }
  console.log(`  ✓ ${Object.keys(doc.entities).length} entities, ` +
              `${Object.keys(doc.groups).length} groups parsed`);

  // -----------------------------------------------------------------------
  // Stage 2: build the Model
  // -----------------------------------------------------------------------
  header('STAGE 2: Build Model (RawDoc → Model)');
  const model = buildModel(doc);
  console.log(`  ✓ ${model.nodes.size} nodes, ${model.edges.length} edges, ` +
              `${model.subtypeClusters.length} clusters, ` +
              `${model.constraintSpans.length} constraint spans`);

  // -----------------------------------------------------------------------
  // Stage 3: derive
  // -----------------------------------------------------------------------
  header('STAGE 3: Derive (classification, groups, cardinality)');
  seedDeclaredGroups(model.nodes, doc);
  derive(model);
  printClassifications(model);
  printGroups(model);
  printCardinalitySample(model);

  // -----------------------------------------------------------------------
  // Stage 4: validate
  // -----------------------------------------------------------------------
  header('STAGE 4: Validate');
  const validationIssues = validate(model);
  printIssues(validationIssues);
  if (validationIssues.length === 0) {
    console.log('  ✓ All semantic checks pass');
  } else if (validationIssues.some(i => i.severity === 'error')) {
    exitWithFailure(validationIssues);
  }

  // -----------------------------------------------------------------------
  // Stage 5: layout
  // -----------------------------------------------------------------------
  header('STAGE 5: Layout');
  const positions = layout(model);
  printLayoutSummary(model, positions);

  // -----------------------------------------------------------------------
  // Dump for inspection
  // -----------------------------------------------------------------------
  const dumpPath = '/mnt/user-data/outputs/algorithm_trace_ts.json';
  const dump = {
    meta: model.meta,
    counts: {
      entities: model.nodes.size,
      edges: model.edges.length,
      clusters: model.subtypeClusters.length,
      constraintSpans: model.constraintSpans.length,
    },
    classification: groupBy([...model.nodes.values()], n => n.classification, n => n.name),
    primaryGroups: Object.fromEntries(
      [...model.nodes.values()].map(n => [n.name, n.primaryGroup ?? null])
    ),
    effectiveGroups: Object.fromEntries(
      [...model.nodes.values()].map(n => [n.name, n.effectiveGroups])
    ),
    cardinalities: model.edges.slice(0, 30).map(e => ({
      parent: e.parent,
      child: e.child,
      kind: e.kind,
      onMapped: Object.fromEntries(e.on),
      cardinality: e.cardinality,
      clusterRef: !!e.clusterRef,
    })),
    positions: Object.fromEntries(positions),
  };
  fs.writeFileSync(dumpPath, JSON.stringify(dump, null, 2));
  console.log(`\nFull trace dumped to ${dumpPath}`);
}

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------

function header(title: string): void {
  const bar = '='.repeat(72);
  console.log(`\n${bar}\n${title}\n${bar}`);
}

function printIssues(issues: Issue[]): void {
  if (issues.length === 0) return;
  for (const i of issues) {
    const tag = i.severity === 'error' ? '✗' : '⚠';
    const where = i.location ? ` [${i.location}]` : '';
    console.log(`  ${tag} ${i.message}${where}`);
  }
}

function exitWithFailure(issues: Issue[]): never {
  const errCount = issues.filter(i => i.severity === 'error').length;
  console.error(`\nPipeline halted: ${errCount} error(s).`);
  process.exit(1);
}

function printClassifications(model: Model): void {
  const grouped = groupBy([...model.nodes.values()], n => n.classification, n => n.name);
  console.log('\n  Classification:');
  for (const cls of Object.keys(grouped).sort()) {
    const names = (grouped[cls] as string[]).sort();
    console.log(`    ${cls.padEnd(13)} ${names.join(', ')}`);
  }
}

function printGroups(model: Model): void {
  console.log('\n  Primary / Effective groups:');
  const sortedNames = [...model.nodes.keys()].sort();
  for (const name of sortedNames) {
    const n = model.nodes.get(name)!;
    const eg = n.effectiveGroups.join(', ') || '-';
    console.log(`    ${name.padEnd(22)}  primary=${(n.primaryGroup ?? '-').padEnd(10)}  effective=[${eg}]`);
  }
}

function printCardinalitySample(model: Model): void {
  console.log('\n  Edge cardinalities (first 12):');
  for (const e of model.edges.slice(0, 12)) {
    console.log(
      `    ${e.parent.padEnd(20)} -> ${e.child.padEnd(22)}  ` +
      `[${e.kind.padEnd(12)}]  ${e.cardinality.parent}:${e.cardinality.child}` +
      `${e.clusterRef ? '  (IS A)' : ''}`
    );
  }
  console.log(`    ... (${model.edges.length} edges total)`);
}

function printLayoutSummary(model: Model, positions: Map<string, NodePosition>): void {
  const byGroup = new Map<string, string[]>();
  for (const [name, pos] of positions) {
    if (!byGroup.has(pos.group)) byGroup.set(pos.group, []);
    byGroup.get(pos.group)!.push(name);
  }
  console.log('\n  Layout result by group:');
  for (const groupName of [...byGroup.keys()].sort()) {
    console.log(`\n    Group: ${groupName}`);
    const members = byGroup.get(groupName)!
      .sort((a, b) => positions.get(a)!.y - positions.get(b)!.y || positions.get(a)!.x - positions.get(b)!.x);
    for (const m of members) {
      const p = positions.get(m)!;
      console.log(`      ${m.padEnd(22)}  x=${String(p.x).padStart(4)}  y=${String(p.y).padStart(4)}`);
    }
  }
}

function groupBy<T>(items: T[], keyFn: (t: T) => string, valFn: (t: T) => string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of items) {
    const k = keyFn(t);
    if (!out[k]) out[k] = [];
    out[k].push(valFn(t));
  }
  return out;
}

main();
