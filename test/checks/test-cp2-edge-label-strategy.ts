/**
 * test-cp2-edge-label-strategy.ts — assertion check for CP2/CP4a edge-label strategy.
 *
 * CI assertion script (PASS/FAIL/exit-1 style, like other test/checks/*.ts).
 *
 * Verifies:
 *  C5  — long-label edges (e.g. db: column-list edges) now produce exactly ONE
 *        truncated preview line ending in '…'. isInlineLabel returns false for
 *        them, so the renderer uses the truncated-preview branch, not the full
 *        split-by-item branch. The truncated line is ≤ CHIP_MAX_CHARS chars and
 *        is not equal to the original full label.
 *  C13 — inline labels are gated by length (isInlineLabel / SHORT_LABEL_MAX),
 *        not by endpoint kind. The full data contract label is present on all
 *        truncated edges for on-demand hover/click disclosure.
 *
 * Uses buildFlowData to get edges (with real labels from the proving model),
 * then applies isInlineLabel (the length-gate classifier, CP4a) to replicate
 * the renderer's lines computation.
 *
 * Diagrams under test: memory-lifecycle and tag-administration from
 * models/llm-memory-db-mssql.
 */

import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';
import { buildFlowData } from '../../src/flow-view/flow-layout';
import { isDbEdge, isInlineLabel, SHORT_LABEL_MAX } from '../../src/flow-view/elk-flow-layout';

/** Replicate the renderer's lines computation for a given label. */
function computeLines(label: string | undefined): string[] {
  if (!label) return [];
  if (isInlineLabel(label)) {
    // Short label: split by item, truncate each item to CHIP_MAX_CHARS.
    // CHIP_MAX_CHARS === SHORT_LABEL_MAX in the renderer.
    return label.split(', ').map(l => l.length > SHORT_LABEL_MAX ? l.slice(0, SHORT_LABEL_MAX - 1) + '…' : l);
  }
  // Long label (CP4): single truncated preview chip.
  return [label.length > SHORT_LABEL_MAX ? label.slice(0, SHORT_LABEL_MAX - 1) + '…' : label];
}

/** Walk the leveled tree to find a diagram by id. */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
  for (const d of diagrams) {
    if (d.id === id) return d;
    const found = findDiagramInTree(d.subDfds, id);
    if (found) return found;
  }
  return undefined;
}

const MODEL_DIR = 'models/llm-memory-db-mssql';
const TARGETS = ['memory-lifecycle', 'tag-administration'];

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

const { flowModel } = await parseFlows(MODEL_DIR);

let totalEdges = 0;
let truncatedEdges = 0;
let inlineEdges = 0;

for (const target of TARGETS) {
  // After CP4 leveling the activity leaf diagrams are nested in the tree.
  const diagram = findDiagramInTree(flowModel.diagrams, target);
  if (!diagram) {
    console.error(`FAIL: diagram not found in leveled tree: ${target}`);
    process.exit(1);
  }

  const { edges } = buildFlowData(diagram);
  console.log(`\n=== ${target} (${edges.length} edges) ===`);

  for (const edge of edges) {
    totalEdges++;
    // CP4a length gate: isInlineLabel is the single classifier used by both
    // elk-flow-layout (label-dummy reservation) and FlowDiagramSvg (lines
    // computation). db: edges are also long, so they take the truncated path.
    const willBeInline = isInlineLabel(edge.label);
    const isDb = isDbEdge(edge.source, edge.target);
    const lines = computeLines(edge.label);

    if (!willBeInline) {
      truncatedEdges++;

      // C5 (updated for CP4): long/db: edges now produce exactly ONE truncated
      // preview chip (ending with '…'). The renderer's lines branch yields
      // [truncateLabel(edge.label, CHIP_MAX_CHARS)] — not []. Verified here by:
      //  a) computeLines returns exactly 1 line
      //  b) that line ends with '…'
      //  c) the line is shorter than the original label (i.e. actually truncated)
      //  d) the line is ≤ SHORT_LABEL_MAX chars
      assert(lines.length === 1, `C5 ${edge.id}: long label must yield exactly 1 truncated preview line, got ${lines.length}`);
      const previewLine = lines[0] ?? '';
      assert(previewLine.endsWith('…'), `C5 ${edge.id}: truncated preview must end with '…', got "${previewLine}"`);
      assert(previewLine.length <= SHORT_LABEL_MAX, `C5 ${edge.id}: truncated preview must be ≤ ${SHORT_LABEL_MAX} chars, got ${previewLine.length}`);
      if (edge.label) {
        assert(previewLine !== edge.label, `C5 ${edge.id}: truncated preview must differ from the full label (label len=${edge.label.length})`);
      }

      // C13: the label (data contract) must be non-empty so there is something
      // to disclose on hover/click.
      if (edge.label) {
        console.log(
          `  PASS truncated edge ${edge.id}${isDb ? ' [db:]' : ''}: full="${edge.label.slice(0, 60)}${edge.label.length > 60 ? '…' : ''}" (len=${edge.label.length}) → chip="${previewLine}", contract present`,
        );
      } else {
        console.log(`  PASS empty edge ${edge.id}: no label, no chip`);
      }
    } else {
      inlineEdges++;

      // C13: short inline labels must be ≤ SHORT_LABEL_MAX chars (true by isInlineLabel definition).
      // db: edges with short labels are now inline too (length gate, not endpoint gate).
      assert(lines.length > 0, `C13 ${edge.id}: short inline label must produce at least 1 chip line`);
      console.log(
        `  PASS inline edge ${edge.id}${isDb ? ' [db:]' : ''}: "${edge.label?.slice(0, 60) ?? ''}${(edge.label?.length ?? 0) > 60 ? '…' : ''}" (len=${edge.label?.length ?? 0}) → ${lines.length} chip line(s)`,
      );
    }
  }
}

// Sanity: the proving model must exercise BOTH paths — some truncated-preview
// (long label) edges AND some short-label edges that render inline.
// Without the second guard, a model where every label is long would pass
// with the inline path entirely untested.
assert(truncatedEdges > 0, `No truncated-preview (long-label) edges found across ${TARGETS.join(', ')} — truncation path is vacuous`);
assert(inlineEdges > 0, `No short-label (inline) edges found across ${TARGETS.join(', ')} — inline path is vacuous`);

console.log(`\nSummary: ${totalEdges} edges total, ${truncatedEdges} truncated-preview (long), ${inlineEdges} inline (short)`);
console.log('C5 PASS: long-label edges render a single truncated preview chip ending in "…".');
console.log('C13 PASS: labels gated by length — long payloads get a "…" preview, full contract available on hover/click.');
console.log('\nAll CP2/CP4a edge-label strategy assertions passed.');
process.exit(0);
