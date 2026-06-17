/**
 * test-deep-nesting.ts — Arbitrary nesting depth: full dotted numbers.
 *
 * Proves that renumberLeaf() in flow-derive-levels.ts recurses into subDfds
 * and prefixes the L1 parent number to every process's full relative
 * dottedNumber, not just its leaf-local last segment.
 *
 * Fixture: test/fixtures/flows-leveling/
 *   Structure:  auth (single top-level leaf → L1 process #1)
 *     └─ Authenticate (process 1 in auth)
 *         └─ Login (process 1 in Authenticate)
 *             ├─ VerifyToken (process 1 in Login)
 *             └─ CreateSession (process 2 in Login)
 *
 * Expected dotted numbers after deriveLevels():
 *   Authenticate = "1.1"    (auth is L1 process 1; Authenticate local "1")
 *   Login        = "1.1.1"  (depth 2; Login local "1.1")
 *   VerifyToken  = "1.1.1.1" (depth 3; VerifyToken local "1.1.1")
 *   CreateSession= "1.1.1.2" (depth 3; CreateSession local "1.1.2")
 *
 * This test MUST FAIL before the renumberLeaf fix (the buggy output is:
 *   Login="1.1" collides with Authenticate; VerifyToken="1.1.1"; CreateSession="1.1.2").
 */

import { parseFlows } from '../../src/flows/flow-parse';
import type { FlowDiagram } from '../../src/flows/flow-parse';

const FIXTURE_DIR = './test/fixtures/flows-leveling';

function fail(msg: string): never {
    console.error('FAIL:', msg);
    process.exit(1);
}

function pass(msg: string) {
    console.log('PASS:', msg);
}

/** Walk the leveled tree to find a diagram by id (recursive). */
function findDiagramInTree(diagrams: FlowDiagram[], id: string): FlowDiagram | undefined {
    for (const d of diagrams) {
        if (d.id === id) return d;
        const found = findDiagramInTree(d.subDfds, id);
        if (found) return found;
    }
    return undefined;
}

/** Walk the leveled tree to find a process by id (returns dottedNumber or undefined). */
function findProcessDotted(diagrams: FlowDiagram[], processId: string): string | undefined {
    for (const d of diagrams) {
        const proc = d.processes.find(p => p.id === processId);
        if (proc !== undefined) return proc.dottedNumber;
        const found = findProcessDotted(d.subDfds, processId);
        if (found !== undefined) return found;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Parse (runs deriveLevels internally)
// ---------------------------------------------------------------------------

const { flowModel, globalErrors } = await parseFlows(FIXTURE_DIR);

if (globalErrors.length > 0) {
    fail(`Parse errors on fixture: ${JSON.stringify(globalErrors)}`);
}

const { diagrams } = flowModel;

if (diagrams.length === 0) {
    fail('No diagrams parsed from fixture');
}

// ---------------------------------------------------------------------------
// T1 — Authenticate = "1.1"
// ---------------------------------------------------------------------------

const authenticateDotted = findProcessDotted(diagrams, 'Authenticate');
if (authenticateDotted === undefined) {
    fail('Could not find process Authenticate in leveled tree');
}
if (authenticateDotted !== '1.1') {
    fail(`T1: Authenticate.dottedNumber = "${authenticateDotted}", expected "1.1"`);
}
pass(`T1: Authenticate.dottedNumber = "1.1"`);

// ---------------------------------------------------------------------------
// T2 — Login = "1.1.1"
// ---------------------------------------------------------------------------

const loginDotted = findProcessDotted(diagrams, 'Login');
if (loginDotted === undefined) {
    fail('Could not find process Login in leveled tree');
}
if (loginDotted !== '1.1.1') {
    fail(`T2: Login.dottedNumber = "${loginDotted}", expected "1.1.1"`);
}
pass(`T2: Login.dottedNumber = "1.1.1"`);

// ---------------------------------------------------------------------------
// T3 — VerifyToken = "1.1.1.1"
// ---------------------------------------------------------------------------

const verifyTokenDotted = findProcessDotted(diagrams, 'VerifyToken');
if (verifyTokenDotted === undefined) {
    fail('Could not find process VerifyToken in leveled tree');
}
if (verifyTokenDotted !== '1.1.1.1') {
    fail(`T3: VerifyToken.dottedNumber = "${verifyTokenDotted}", expected "1.1.1.1"`);
}
pass(`T3: VerifyToken.dottedNumber = "1.1.1.1"`);

// ---------------------------------------------------------------------------
// T4 — CreateSession = "1.1.1.2"
// ---------------------------------------------------------------------------

const createSessionDotted = findProcessDotted(diagrams, 'CreateSession');
if (createSessionDotted === undefined) {
    fail('Could not find process CreateSession in leveled tree');
}
if (createSessionDotted !== '1.1.1.2') {
    fail(`T4: CreateSession.dottedNumber = "${createSessionDotted}", expected "1.1.1.2"`);
}
pass(`T4: CreateSession.dottedNumber = "1.1.1.2"`);

// ---------------------------------------------------------------------------
// T5 — No collision: Authenticate and Login have different dotted numbers
// ---------------------------------------------------------------------------

// Widen to string before comparing so TS doesn't narrow both literals and
// flag the comparison as vacuously false (they are distinct after the fix).
const authenticateDottedStr: string = authenticateDotted;
const loginDottedStr: string = loginDotted;
if (authenticateDottedStr === loginDottedStr) {
    fail(
        `T5: Authenticate and Login have the same dottedNumber "${authenticateDottedStr}" — collision!`,
    );
}
pass(`T5: No collision — Authenticate="${authenticateDottedStr}", Login="${loginDottedStr}"`);

// ---------------------------------------------------------------------------
// T6 — Deepest processes have 4 segments (proves arbitrary depth, not 2-level cap)
// ---------------------------------------------------------------------------

const verifySegments = verifyTokenDotted.split('.').length;
const createSegments = createSessionDotted.split('.').length;
if (verifySegments !== 4) {
    fail(`T6: VerifyToken has ${verifySegments} dotted segments, expected 4`);
}
if (createSegments !== 4) {
    fail(`T6: CreateSession has ${createSegments} dotted segments, expected 4`);
}
pass(`T6: Deepest processes have 4 dotted segments (arbitrary depth preserved)`);

// ---------------------------------------------------------------------------
// T7 — Authenticate sub-DFD can be found and Login is in it with "1.1.1"
// ---------------------------------------------------------------------------

const authenticateSubDfd = findDiagramInTree(diagrams, 'Authenticate');
if (authenticateSubDfd === undefined) {
    fail('T7: Cannot find Authenticate sub-DFD in the leveled tree');
}
const loginInSubDfd = authenticateSubDfd.processes.find(p => p.id === 'Login');
if (loginInSubDfd === undefined) {
    fail('T7: Login process not found inside Authenticate sub-DFD');
}
if (loginInSubDfd.dottedNumber !== '1.1.1') {
    fail(
        `T7: Login inside Authenticate sub-DFD has dottedNumber "${loginInSubDfd.dottedNumber}", expected "1.1.1"`,
    );
}
pass(`T7: Login inside Authenticate sub-DFD has dottedNumber "1.1.1"`);

console.log('\nAll test-deep-nesting checks PASSED.');
