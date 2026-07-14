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

// ---------------------------------------------------------------------------
// T11: Cmd/Ctrl + zoom keys → zoom actions, on graph AND flow views
//   = / +  → zoomIn   ;   - / _  → zoomOut   ;   0 → zoomReset
// ---------------------------------------------------------------------------
{
  const cases: Array<{ key: string; expected: ShortcutAction['type'] }> = [
    { key: '=', expected: 'zoomIn' },
    { key: '+', expected: 'zoomIn' },
    { key: '-', expected: 'zoomOut' },
    { key: '_', expected: 'zoomOut' },
    { key: '0', expected: 'zoomReset' },
  ];
  // Both ctrl (Linux/Win) and meta (macOS) trigger; on both graph + flow views.
  for (const mod of ['ctrlKey', 'metaKey'] as const) {
    for (const view of ['graph', 'flow'] as ViewName[]) {
      for (const { key, expected } of cases) {
        const result = resolveShortcut(ev(key, { [mod]: true }), view, false);
        assert(
          result !== null && result.type === expected,
          `T11: ${mod}+'${key}' on ${view} → { type:'${expected}' }`,
        );
        console.log(`PASS T11: ${mod}+'${key}' on view=${view} → { type:'${expected}' }`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T12: zoom combos resolve EVEN when editable === true (not blocked by the
//      editable guard — they are not typed characters)
// ---------------------------------------------------------------------------
{
  const cases: Array<{ key: string; expected: ShortcutAction['type'] }> = [
    { key: '=', expected: 'zoomIn' },
    { key: '-', expected: 'zoomOut' },
    { key: '0', expected: 'zoomReset' },
  ];
  for (const { key, expected } of cases) {
    const result = resolveShortcut(ev(key, { metaKey: true }), 'graph', true);
    assert(
      result !== null && result.type === expected,
      `T12: meta+'${key}' with editable=true still → { type:'${expected}' }`,
    );
    console.log(`PASS T12: meta+'${key}' editable=true → { type:'${expected}' }`);
  }
}

// ---------------------------------------------------------------------------
// T13: alt / shift + zoom keys → null (ONLY ctrl/meta trigger zoom)
// ---------------------------------------------------------------------------
{
  for (const key of ['=', '+', '-', '_', '0']) {
    const alt = resolveShortcut(ev(key, { altKey: true }), 'graph', false);
    assert(alt === null, `T13: alt+'${key}' → null`);
    const shift = resolveShortcut(ev(key, { shiftKey: true }), 'graph', false);
    assert(shift === null, `T13: shift+'${key}' → null`);
    // ctrl + alt held together → still no zoom (alt disqualifies)
    const ctrlAlt = resolveShortcut(ev(key, { ctrlKey: true, altKey: true }), 'graph', false);
    assert(ctrlAlt === null, `T13: ctrl+alt+'${key}' → null`);
    // meta + shift held together → still no zoom (shift disqualifies)
    const metaShift = resolveShortcut(ev(key, { metaKey: true, shiftKey: true }), 'graph', false);
    assert(metaShift === null, `T13: meta+shift+'${key}' → null`);
    console.log(`PASS T13: alt/shift (and combos) on '${key}' → null`);
  }
}

// ---------------------------------------------------------------------------
// T14: bare zoom keys (no modifier) → null — do NOT hijack plain keystrokes
// ---------------------------------------------------------------------------
{
  for (const key of ['=', '+', '-', '_', '0']) {
    for (const view of VIEWS) {
      const result = resolveShortcut(ev(key), view, false);
      assert(result === null, `T14: bare '${key}' on ${view} → null`);
    }
    console.log(`PASS T14: bare '${key}' (no modifier) → null on all views`);
  }
}

// ---------------------------------------------------------------------------
// T15: zoom actions carry NO extra payload (exact discriminated shape)
// ---------------------------------------------------------------------------
{
  const zin = resolveShortcut(ev('=', { metaKey: true }), 'graph', false);
  assert(zin !== null && zin.type === 'zoomIn', 'T15: zoomIn shape');
  assert(Object.keys(zin).length === 1, "T15: zoomIn has only 'type'");
  const zout = resolveShortcut(ev('-', { metaKey: true }), 'flow', false);
  assert(zout !== null && zout.type === 'zoomOut', 'T15: zoomOut shape');
  assert(Object.keys(zout).length === 1, "T15: zoomOut has only 'type'");
  const zreset = resolveShortcut(ev('0', { ctrlKey: true }), 'dict', false);
  assert(zreset !== null && zreset.type === 'zoomReset', 'T15: zoomReset shape');
  assert(Object.keys(zreset).length === 1, "T15: zoomReset has only 'type'");
  console.log('PASS T15: zoom action shapes carry only { type }');
}

// ---------------------------------------------------------------------------
// T16: '?' → help on every view. '?' is Shift+/ on most layouts, so the inherent
//      shiftKey must NOT suppress it (resolved before the modifier guard). But it
//      stays suppressed in editable context, and gated off ctrl/meta/alt.
// ---------------------------------------------------------------------------
{
  for (const view of VIEWS) {
    // With shiftKey (the real-world chord for '?') — must still resolve to help.
    const result = resolveShortcut(ev('?', { shiftKey: true }), view, false);
    assert(result !== null && result.type === 'help', `T16: '?' on ${view} → { type:'help' }`);
    assert(Object.keys(result).length === 1, "T16: help action has only 'type'");
    console.log(`PASS T16: '?' (shift) on view=${view} → { type:'help' }`);
  }
  // Bare '?' without shift (some layouts) still resolves to help.
  {
    const result = resolveShortcut(ev('?'), 'graph', false);
    assert(result !== null && result.type === 'help', "T16: bare '?' → help");
    console.log("PASS T16: bare '?' → { type:'help' }");
  }
  // Editable context suppresses '?' (typing a literal '?' in a search box).
  {
    const result = resolveShortcut(ev('?', { shiftKey: true }), 'graph', true);
    assert(result === null, "T16: '?' with editable=true → null");
    console.log("PASS T16: '?' editable=true → null");
  }
  // ctrl/meta/alt held with '?' → null (never collides with a browser chord).
  for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    const result = resolveShortcut(ev('?', { [mod]: true }), 'graph', false);
    assert(result === null, `T16: ${mod}+'?' → null`);
    console.log(`PASS T16: ${mod}+'?' → null`);
  }
}

// ---------------------------------------------------------------------------
// T17: '/' → search on every view. Ordinary bare key (no Shift needed, unlike
//      '?'), so it resolves through the normal switch after both guards.
// ---------------------------------------------------------------------------
{
  for (const view of VIEWS) {
    const result = resolveShortcut(ev('/'), view, false);
    assert(result !== null && result.type === 'search', `T17: '/' on ${view} → { type:'search' }`);
    assert(Object.keys(result).length === 1, "T17: search action has only 'type'");
    console.log(`PASS T17: '/' on view=${view} → { type:'search' }`);
  }
}

// ---------------------------------------------------------------------------
// T18: '/' with ctrl/meta/alt held → null (modifier guard applies like any
//      other bare key).
// ---------------------------------------------------------------------------
{
  for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    const result = resolveShortcut(ev('/', { [mod]: true }), 'graph', false);
    assert(result === null, `T18: ${mod}+'/' → null`);
    console.log(`PASS T18: ${mod}+'/' → null`);
  }
}

// ---------------------------------------------------------------------------
// T19: '/' while editable === true → null (typing '/' in an input/textarea/
//      contenteditable/modal must insert the literal character instead).
// ---------------------------------------------------------------------------
{
  const result = resolveShortcut(ev('/'), 'graph', true);
  assert(result === null, "T19: '/' editable=true → null");
  console.log("PASS T19: '/' editable=true → null");
}

console.log('\nAll tests passed.');
