/**
 * compare-lineage-modes.ts — side-by-side lineage sizes under both rules.
 *
 * Prints, per entity, how many dotted lineage lines `legacy` (walk through
 * junctions) draws vs `strict` (junctions are barriers), so the blow-up on
 * association-heavy models is visible as a number rather than a screenshot.
 *
 *   bun scripts/compare-lineage-modes.ts [modelDir ...]
 */

import { resolve, join, basename } from 'path';
import { parseModels } from '../src/model/parse';
import { buildModelIndex } from '../src/model/model-index';
import { buildInheritedConnections } from '../src/app/logic/spotlight-inherited';

const ROOT = resolve(import.meta.dir, '..');
const DEFAULT_MODELS = ['models/llm-memory-db-mssql', 'models/key-inherited'];

const dirs = process.argv.slice(2);
const targets = dirs.length > 0 ? dirs : DEFAULT_MODELS;

for (const dir of targets) {
  const abs = resolve(ROOT, dir);
  const { model } = await parseModels(abs);
  const index = buildModelIndex(model);
  const total = model.nodes.length;

  console.log(`\n=== ${basename(abs)} — ${total} entities ===`);
  console.log('  legacy  strict   entity');

  let legacySum = 0;
  let strictSum = 0;
  const rows = model.nodes.map(node => {
    const legacy = buildInheritedConnections(index, node.id, 'legacy').length;
    const strict = buildInheritedConnections(index, node.id, 'strict').length;
    legacySum += legacy;
    strictSum += strict;
    return { id: node.id, legacy, strict };
  });

  rows.sort((a, b) => b.legacy - a.legacy || (a.id < b.id ? -1 : 1));
  for (const r of rows) {
    const flag = r.legacy !== r.strict ? '  <-- changed' : '';
    console.log(
      `  ${String(r.legacy).padStart(6)}  ${String(r.strict).padStart(6)}   ${r.id}${flag}`,
    );
  }

  const avg = (n: number) => (n / total).toFixed(1);
  console.log(`  ------`);
  console.log(`  avg lines per entity:  legacy ${avg(legacySum)}   strict ${avg(strictSum)}`);
  console.log(`  worst case:            legacy ${Math.max(...rows.map(r => r.legacy))}   strict ${Math.max(...rows.map(r => r.strict))}`);
}

console.log('');
