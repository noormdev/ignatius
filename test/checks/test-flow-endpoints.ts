/**
 * test-flow-endpoints.ts — CP-3 unit tests for resolveEndpoint.
 *
 * All tests are pure: no file I/O. EndpointContextPublic literals are
 * constructed inline to set up each scenario.
 *
 * Covered:
 * - Qualified endpoints (ext:, db:, proc:, cache:, queue:, file:, doc:, manual:)
 *   resolve directly to the correct kind + name without ambiguity check.
 * - A qualified endpoint resolves even when the bare name also exists in
 *   another namespace (no false collision when prefix is present).
 * - An unknown qualified db: name still resolves structurally — existence
 *   against the entity catalog is validation's job, not resolveEndpoint's.
 * - A bare name unique across all namespaces resolves to the single match.
 * - A bare name that collides across two namespaces returns null.
 * - A bare name absent from all namespaces returns null.
 */

import { resolveEndpoint } from '../../src/flow-parse';
import type { EndpointContextPublic, FlowEndpoint } from '../../src/flow-parse';

function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
}

function assertEndpoint(
    result: FlowEndpoint | null,
    expectedKind: FlowEndpoint['kind'],
    expectedName: string,
    label: string,
): void {
    assert(result !== null, `${label}: expected non-null endpoint`);
    assert(result.kind === expectedKind, `${label}: expected kind '${expectedKind}', got '${String(result?.kind)}'`);
    assert(result.name === expectedName, `${label}: expected name '${expectedName}', got '${String(result?.name)}'`);
}

// ---------------------------------------------------------------------------
// Baseline context used across most tests
// ---------------------------------------------------------------------------

// A context where "Shopper" is an external, "Sessions" is a cache store,
// "Party" is a db store, and "PlaceOrder" is a process.
// "Party" also appears in externals to test that qualified prefixes bypass
// namespace collision when the raw string has an explicit prefix.
const baseContext: EndpointContextPublic = {
    externals: new Set(['Shopper', 'Party']),
    storeKindByName: new Map<string, FlowEndpoint['kind']>([
        ['Sessions', 'cache'],
        ['Party', 'db'],
        ['JobQueue', 'queue'],
        ['Ledger', 'file'],
        ['PolicyDoc', 'doc'],
        ['ManualLog', 'manual'],
    ]),
    processes: new Set(['PlaceOrder', 'Party']),
};

// ---------------------------------------------------------------------------
// 1. Qualified endpoints resolve directly to the correct kind + name
// ---------------------------------------------------------------------------

{
    const result = resolveEndpoint('ext:Shopper', baseContext);
    assertEndpoint(result, 'ext', 'Shopper', 'ext: qualified');
    console.log('PASS: ext:Shopper resolves to kind=ext, name=Shopper');
}

{
    const result = resolveEndpoint('db:Party', baseContext);
    assertEndpoint(result, 'db', 'Party', 'db: qualified');
    console.log('PASS: db:Party resolves to kind=db, name=Party');
}

{
    const result = resolveEndpoint('proc:PlaceOrder', baseContext);
    assertEndpoint(result, 'proc', 'PlaceOrder', 'proc: qualified');
    console.log('PASS: proc:PlaceOrder resolves to kind=proc, name=PlaceOrder');
}

{
    const result = resolveEndpoint('cache:Sessions', baseContext);
    assertEndpoint(result, 'cache', 'Sessions', 'cache: qualified');
    console.log('PASS: cache:Sessions resolves to kind=cache, name=Sessions');
}

{
    const result = resolveEndpoint('queue:JobQueue', baseContext);
    assertEndpoint(result, 'queue', 'JobQueue', 'queue: qualified');
    console.log('PASS: queue:JobQueue resolves to kind=queue, name=JobQueue');
}

{
    const result = resolveEndpoint('file:Ledger', baseContext);
    assertEndpoint(result, 'file', 'Ledger', 'file: qualified');
    console.log('PASS: file:Ledger resolves to kind=file, name=Ledger');
}

{
    const result = resolveEndpoint('doc:PolicyDoc', baseContext);
    assertEndpoint(result, 'doc', 'PolicyDoc', 'doc: qualified');
    console.log('PASS: doc:PolicyDoc resolves to kind=doc, name=PolicyDoc');
}

{
    const result = resolveEndpoint('manual:ManualLog', baseContext);
    assertEndpoint(result, 'manual', 'ManualLog', 'manual: qualified');
    console.log('PASS: manual:ManualLog resolves to kind=manual, name=ManualLog');
}

// ---------------------------------------------------------------------------
// 2. Qualified endpoint bypasses ambiguity even when bare name collides
//
// "Party" exists in externals, storeKindByName (db), and processes — a bare
// "Party" would collide and return null. But "db:Party" must resolve directly.
// ---------------------------------------------------------------------------

{
    // Confirm bare "Party" would collide (three-way collision)
    const bareResult = resolveEndpoint('Party', baseContext);
    assert(bareResult === null, 'bare Party (three-way collision) must return null');
    console.log('PASS: bare Party (ext + db + proc collision) returns null as expected');

    // Qualified db:Party skips ambiguity check entirely
    const qualResult = resolveEndpoint('db:Party', baseContext);
    assertEndpoint(qualResult, 'db', 'Party', 'qualified db:Party despite collision');
    console.log('PASS: db:Party resolves directly despite bare-name collision across namespaces');
}

// Also verify ext:Party and proc:Party resolve directly even when bare would collide
{
    const extResult = resolveEndpoint('ext:Party', baseContext);
    assertEndpoint(extResult, 'ext', 'Party', 'qualified ext:Party despite collision');
    console.log('PASS: ext:Party resolves directly despite bare-name collision');
}

{
    const procResult = resolveEndpoint('proc:Party', baseContext);
    assertEndpoint(procResult, 'proc', 'Party', 'qualified proc:Party despite collision');
    console.log('PASS: proc:Party resolves directly despite bare-name collision');
}

// ---------------------------------------------------------------------------
// 3. Unknown qualified db: name resolves structurally — existence is
//    validation's job (flow.unknown_store), not resolveEndpoint's.
//
// The implementation returns { kind: 'db', name: 'DoesNotExist', raw } for
// 'db:DoesNotExist' even when 'DoesNotExist' is not in storeKindByName.
// This was verified in the source: parseKind succeeds on 'db', so the
// function takes the qualified branch and returns immediately.
// ---------------------------------------------------------------------------

{
    const emptyContext: EndpointContextPublic = {
        externals: new Set(),
        storeKindByName: new Map(),
        processes: new Set(),
    };
    const result = resolveEndpoint('db:DoesNotExist', emptyContext);
    // Must be non-null: qualified kind 'db' is valid; resolveEndpoint does
    // not cross-check against the entity catalog.
    assert(result !== null, 'db:DoesNotExist must resolve (non-null) — existence check belongs to validation');
    assertEndpoint(result, 'db', 'DoesNotExist', 'db: unknown name still resolves structurally');
    console.log('PASS: db:DoesNotExist resolves to kind=db (existence check is validation\'s job)');
}

// Same for unknown cache:, queue:, ext:, proc: — prefix determines kind
{
    const emptyContext: EndpointContextPublic = {
        externals: new Set(),
        storeKindByName: new Map(),
        processes: new Set(),
    };

    const cacheResult = resolveEndpoint('cache:GhostCache', emptyContext);
    assertEndpoint(cacheResult, 'cache', 'GhostCache', 'cache: unknown name');
    console.log('PASS: cache:GhostCache resolves structurally even when absent from context');

    const extResult = resolveEndpoint('ext:NoSuchExternal', emptyContext);
    assertEndpoint(extResult, 'ext', 'NoSuchExternal', 'ext: unknown name');
    console.log('PASS: ext:NoSuchExternal resolves structurally even when absent from context');

    const procResult = resolveEndpoint('proc:NoSuchProcess', emptyContext);
    assertEndpoint(procResult, 'proc', 'NoSuchProcess', 'proc: unknown name');
    console.log('PASS: proc:NoSuchProcess resolves structurally even when absent from context');
}

// ---------------------------------------------------------------------------
// 4. Bare name unique in exactly one namespace resolves to that kind
// ---------------------------------------------------------------------------

{
    // "Shopper" is only in externals
    const result = resolveEndpoint('Shopper', baseContext);
    assertEndpoint(result, 'ext', 'Shopper', 'bare Shopper (ext only)');
    console.log('PASS: bare Shopper (only in externals) resolves to kind=ext');
}

{
    // "Sessions" is only in storeKindByName (cache)
    const result = resolveEndpoint('Sessions', baseContext);
    assertEndpoint(result, 'cache', 'Sessions', 'bare Sessions (cache only)');
    console.log('PASS: bare Sessions (only in stores) resolves to kind=cache');
}

{
    // "PlaceOrder" is only in processes
    const result = resolveEndpoint('PlaceOrder', baseContext);
    assertEndpoint(result, 'proc', 'PlaceOrder', 'bare PlaceOrder (proc only)');
    console.log('PASS: bare PlaceOrder (only in processes) resolves to kind=proc');
}

// ---------------------------------------------------------------------------
// 5. Bare name that collides across two+ namespaces returns null
// ---------------------------------------------------------------------------

{
    // "Overlap" exists in externals AND processes — two-way collision
    const collisionContext: EndpointContextPublic = {
        externals: new Set(['Overlap']),
        storeKindByName: new Map(),
        processes: new Set(['Overlap']),
    };
    const result = resolveEndpoint('Overlap', collisionContext);
    assert(result === null, 'bare Overlap (ext + proc collision) must return null');
    console.log('PASS: bare Overlap (ext + proc collision) returns null');
}

{
    // "SharedName" exists in both stores and processes — two-way collision
    const collisionContext: EndpointContextPublic = {
        externals: new Set(),
        storeKindByName: new Map<string, FlowEndpoint['kind']>([['SharedName', 'cache']]),
        processes: new Set(['SharedName']),
    };
    const result = resolveEndpoint('SharedName', collisionContext);
    assert(result === null, 'bare SharedName (cache + proc collision) must return null');
    console.log('PASS: bare SharedName (store + proc collision) returns null');
}

{
    // "Multi" exists in all three — three-way collision
    const collisionContext: EndpointContextPublic = {
        externals: new Set(['Multi']),
        storeKindByName: new Map<string, FlowEndpoint['kind']>([['Multi', 'db']]),
        processes: new Set(['Multi']),
    };
    const result = resolveEndpoint('Multi', collisionContext);
    assert(result === null, 'bare Multi (ext + db + proc collision) must return null');
    console.log('PASS: bare Multi (three-way collision) returns null');
}

// ---------------------------------------------------------------------------
// 6. Bare name absent from all namespaces returns null
// ---------------------------------------------------------------------------

{
    const result = resolveEndpoint('Nonexistent', baseContext);
    assert(result === null, 'bare Nonexistent must return null');
    console.log('PASS: bare Nonexistent (absent from all namespaces) returns null');
}

{
    const emptyContext: EndpointContextPublic = {
        externals: new Set(),
        storeKindByName: new Map(),
        processes: new Set(),
    };
    const result = resolveEndpoint('AnyName', emptyContext);
    assert(result === null, 'bare AnyName in empty context must return null');
    console.log('PASS: bare AnyName in completely empty context returns null');
}

// ---------------------------------------------------------------------------
// 7. raw field is preserved verbatim on the returned endpoint
// ---------------------------------------------------------------------------

{
    const result = resolveEndpoint('db:SomeStore', baseContext);
    assert(result !== null, 'db:SomeStore must not be null');
    assert(result.raw === 'db:SomeStore', `raw field preserved (got '${result.raw}')`);
    console.log('PASS: raw field preserved verbatim on qualified result');
}

{
    const ctx: EndpointContextPublic = {
        externals: new Set(['  Shopper  ']),
        storeKindByName: new Map(),
        processes: new Set(),
    };
    // resolveEndpoint trims the raw before lookup; bare name trimmed to 'Shopper'
    // but 'Shopper' is not in ctx.externals (which has '  Shopper  ')
    // This verifies trimming happens on raw, not on the Set entries.
    const result = resolveEndpoint('  Shopper  ', ctx);
    // The trimmed name 'Shopper' won't be found in a Set that has '  Shopper  '
    // So result is null — this pins the exact trimming behavior.
    assert(result === null, 'bare with whitespace-padded Set entry: trimmed lookup does not match padded entry');
    console.log('PASS: resolveEndpoint trims raw before lookup (padded Set entry does not match)');
}

{
    // Qualified with surrounding spaces — trimmed before kind extraction
    const ctx: EndpointContextPublic = {
        externals: new Set(),
        storeKindByName: new Map(),
        processes: new Set(),
    };
    const result = resolveEndpoint('  db:TrimTest  ', ctx);
    // 'db' is a valid kind prefix even after trimming the full string
    assertEndpoint(result, 'db', 'TrimTest', 'qualified with outer whitespace');
    console.log('PASS: qualified endpoint with surrounding whitespace trimmed correctly');
}

console.log('\nAll test-flow-endpoints assertions passed.');
