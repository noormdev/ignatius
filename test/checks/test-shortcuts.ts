/**
 * test-shortcuts.ts — exhaustive unit tests for resolveShortcut.
 *
 * CI assertion script (PASS/FAIL/exit-1 style).
 * Tests every keymap row, all modifier guards, editable guard, and
 * unmapped keys. No DOM, no React, no network.
 */

import {
  resolveShortcut,
  type ShortcutKeyEvent,
  type ShortcutAction,
} from '../../src/app/logic/shortcuts';
import type { ViewName } from '../../src/app/hash-router';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VIEWS: ViewName[] = ['graph', 'dict', 'flow'];

function ev(key: string, mods?: Partial<Omit<ShortcutKeyEvent, 'key'>>): ShortcutKeyEvent {
  return {
    key,
    ctrlKey: mods?.ctrlKey ?? false,
    metaKey: mods?.metaKey ?? false,
    altKey: mods?.altKey ?? false,
    shiftKey: mods?.shiftKey ?? false,
  };
}

// ---------------------------------------------------------------------------
// T1: g → view graph from every starting view
// ---------------------------------------------------------------------------
for (const view of VIEWS) {
  const result = resolveShortcut(ev('g'), view, false);
  assert(result !== null && result.type === 'view' && result.view === 'graph', `T1: g from ${view} → { type:'view', view:'graph' }`);
  console.log(`PASS T1: g from view=${view} → { type:'view', view:'graph' }`);
}

// ---------------------------------------------------------------------------
// T2: d → view dict from every starting view
// ---------------------------------------------------------------------------
for (const view of VIEWS) {
  const result = resolveShortcut(ev('d'), view, false);
  assert(result !== null && result.type === 'view' && result.view === 'dict', `T2: d from ${view} → { type:'view', view:'dict' }`);
  console.log(`PASS T2: d from view=${view} → { type:'view', view:'dict' }`);
}

// ---------------------------------------------------------------------------
// T3: f → view flow from every starting view
// ---------------------------------------------------------------------------
for (const view of VIEWS) {
  const result = resolveShortcut(ev('f'), view, false);
  assert(result !== null && result.type === 'view' && result.view === 'flow', `T3: f from ${view} → { type:'view', view:'flow' }`);
  console.log(`PASS T3: f from view=${view} → { type:'view', view:'flow' }`);
}

// ---------------------------------------------------------------------------
// T4: l → toggleLayout only when view === 'graph'
// ---------------------------------------------------------------------------
{
  const result = resolveShortcut(ev('l'), 'graph', false);
  assert(result !== null, "T4: l in 'graph' should not be null");
  assert(result.type === 'toggleLayout', "T4: l in 'graph' → toggleLayout");
  console.log("PASS T4: l in view='graph' → { type:'toggleLayout' }");
}
{
  const result = resolveShortcut(ev('l'), 'dict', false);
  assert(result === null, "T4: l in 'dict' → null");
  console.log("PASS T4: l in view='dict' → null");
}
{
  const result = resolveShortcut(ev('l'), 'flow', false);
  assert(result === null, "T4: l in 'flow' → null");
  console.log("PASS T4: l in view='flow' → null");
}

// ---------------------------------------------------------------------------
// T5: b → toggleLens only when view === 'dict'
// ---------------------------------------------------------------------------
{
  const result = resolveShortcut(ev('b'), 'dict', false);
  assert(result !== null, "T5: b in 'dict' should not be null");
  assert(result.type === 'toggleLens', "T5: b in 'dict' → toggleLens");
  console.log("PASS T5: b in view='dict' → { type:'toggleLens' }");
}
{
  const result = resolveShortcut(ev('b'), 'graph', false);
  assert(result === null, "T5: b in 'graph' → null");
  console.log("PASS T5: b in view='graph' → null");
}
{
  const result = resolveShortcut(ev('b'), 'flow', false);
  assert(result === null, "T5: b in 'flow' → null");
  console.log("PASS T5: b in view='flow' → null");
}

// ---------------------------------------------------------------------------
// T6: unmapped keys → null
// ---------------------------------------------------------------------------
for (const key of ['x', '1', 'Enter', 'Escape', ' ']) {
  const result = resolveShortcut(ev(key), 'graph', false);
  assert(result === null, `T6: unmapped key '${key}' → null`);
  console.log(`PASS T6: unmapped key '${key}' → null`);
}

// ---------------------------------------------------------------------------
// T7: modifier guards — each modifier individually on a valid key ('g')
// ---------------------------------------------------------------------------
{
  const result = resolveShortcut(ev('g', { ctrlKey: true }), 'graph', false);
  assert(result === null, 'T7: ctrlKey → null');
  console.log('PASS T7: ctrlKey held on g → null');
}
{
  const result = resolveShortcut(ev('g', { metaKey: true }), 'graph', false);
  assert(result === null, 'T7: metaKey → null');
  console.log('PASS T7: metaKey held on g → null');
}
{
  const result = resolveShortcut(ev('g', { altKey: true }), 'graph', false);
  assert(result === null, 'T7: altKey → null');
  console.log('PASS T7: altKey held on g → null');
}
{
  const result = resolveShortcut(ev('g', { shiftKey: true }), 'graph', false);
  assert(result === null, 'T7: shiftKey → null');
  console.log('PASS T7: shiftKey held on g → null');
}

// ---------------------------------------------------------------------------
// T8: editable === true suppresses all keys (no modifier required)
// ---------------------------------------------------------------------------
for (const key of ['g', 'd', 'f', 'l', 'b']) {
  const result = resolveShortcut(ev(key), 'graph', true);
  assert(result === null, `T8: editable=true on key '${key}' → null`);
  console.log(`PASS T8: editable=true key='${key}' → null`);
}

// ---------------------------------------------------------------------------
// T9: returned object shape is exact — no extra properties we rely on
// ---------------------------------------------------------------------------
{
  const result = resolveShortcut(ev('g'), 'graph', false);
  assert(result !== null && result.type === 'view', 'T9: view action has type');
  assert('view' in result, "T9: view action has 'view' property");
  assert(result.view === 'graph', 'T9: view action view value is correct');
  console.log("PASS T9: view action shape { type:'view', view:'graph' }");
}
{
  const result = resolveShortcut(ev('l'), 'graph', false);
  assert(result !== null, 'T9: l returns non-null');
  assert(result.type === 'toggleLayout', 'T9: toggleLayout action shape');
  console.log("PASS T9: toggleLayout action shape { type:'toggleLayout' }");
}
{
  const result = resolveShortcut(ev('b'), 'dict', false);
  assert(result !== null, 'T9: b returns non-null');
  assert(result.type === 'toggleLens', 'T9: toggleLens action shape');
  console.log("PASS T9: toggleLens action shape { type:'toggleLens' }");
}

// ---------------------------------------------------------------------------
// T10: uppercase key variants are treated as lowercase (key.toLowerCase())
// ---------------------------------------------------------------------------
{
  // Uppercase G — shiftKey would be guarded, but the key value alone can be uppercase
  // (e.g. capslock). Brief says match on e.key.toLowerCase(), so 'G'.toLowerCase() === 'g'.
  // shiftKey is NOT set here — just the character value is uppercase.
  const result = resolveShortcut(ev('G'), 'graph', false);
  assert(result !== null && result.type === 'view' && result.view === 'graph', "T10: uppercase 'G' without shift → graph view action");
  console.log("PASS T10: uppercase 'G' without shiftKey → graph view action");
}

console.log('\nAll tests passed.');
