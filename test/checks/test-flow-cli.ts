/**
 * test-flow-cli.ts — R2: path-first `ignatius flow` CLI assertions.
 *
 * Invokes the CLI via `bun src/cli.ts` (no prior binary build required).
 *
 * Verifies:
 * - `flow <model-path> -o <out>.html` (path-first, NO DFD name) exits 0 and
 *   writes the viewer for a clean model
 * - The sibling dictionary file exists on disk after the run
 * - The viewer HTML contains an href to the sibling dictionary
 * - `-o` omitted → stderr error + exit 1
 * - A Class B finding (broken-flows-model) → exit 1
 * - A model with no flows/ → friendly note + exit 0
 * - `flow models/key-inherited -o ...` is parsed path-first (no "DFD not found" error)
 * - `validate <flows-model>` still works (validate integration unchanged)
 * - `validate models/key-inherited` → exit 0 (no-flows model unaffected)
 *
 * All generated HTML files are written to tmp/ per repo convention.
 */

import { join, resolve, basename, extname, dirname } from 'path';
import { existsSync, unlinkSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const FLOWS_MODEL = join(ROOT, 'test/fixtures/flows-model');
const BROKEN_FLOWS_MODEL = join(ROOT, 'test/fixtures/broken-flows-model');
const KEY_INHERITED = join(ROOT, 'models/key-inherited');
// orm-pure has no flows/ directory — use it for the no-flows test.
const NO_FLOWS_MODEL = join(ROOT, 'models/orm-pure');
const TMP = join(ROOT, 'tmp');

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(['bun', join(ROOT, 'src/cli.ts'), ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const timer = setTimeout(() => proc.kill(), 60_000);
    const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);
    return { exitCode, stdout, stderr };
}

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
    if (condition) {
        console.log(`  PASS  ${label}`);
    } else {
        console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
        failures++;
    }
}

function cleanup(...paths: string[]): void {
    for (const p of paths) {
        try {
            if (existsSync(p)) unlinkSync(p);
        } catch {
            // ignore
        }
    }
}

// ---------------------------------------------------------------------------
// Test 1: path-first `flow <model-path> -o <out>.html` exits 0, writes viewer
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-r2-clean.html');
    const dictFile = join(TMP, 'test-flow-r2-clean.dict.html');
    cleanup(outFile, dictFile);

    const { exitCode, stdout, stderr } = await run(['flow', FLOWS_MODEL, '-o', outFile]);

    assert(exitCode === 0, 'flow path-first clean: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(existsSync(outFile), 'flow path-first clean: viewer file written', `path: ${outFile}`);

    if (existsSync(outFile)) {
        const html = await Bun.file(outFile).text();
        assert(html.includes('__FLOW_MODEL__'), 'viewer HTML contains __FLOW_MODEL__ injection', `html length: ${html.length}`);
        assert(html.includes('__IGNATIUS_SURFACE__'), 'viewer HTML contains __IGNATIUS_SURFACE__ injection');
    }

    cleanup(outFile, dictFile);
}

// ---------------------------------------------------------------------------
// Test 2: -o omitted → stderr error + exit 1
// ---------------------------------------------------------------------------
{
    const { exitCode, stderr } = await run(['flow', FLOWS_MODEL]);

    assert(exitCode === 1, 'flow -o omitted: exit 1', `got ${exitCode}`);
    assert(
        stderr.includes('-o') || stderr.includes('required') || stderr.includes('output'),
        'flow -o omitted: stderr mentions -o or required',
        `stderr:\n${stderr.slice(0, 300)}`,
    );
}

// ---------------------------------------------------------------------------
// Test 3: Class B finding → exit 1
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-r2-broken.html');
    const dictFile = join(TMP, 'test-flow-r2-broken.dict.html');
    cleanup(outFile, dictFile);

    const { exitCode, stderr } = await run(['flow', BROKEN_FLOWS_MODEL, '-o', outFile]);

    assert(exitCode === 1, 'flow Class B finding: exit 1', `got ${exitCode}`);
    assert(
        stderr.includes('flow.unknown_store') || stderr.includes('error'),
        'flow Class B: stderr mentions flow.unknown_store or error',
        `stderr:\n${stderr.slice(0, 500)}`,
    );

    cleanup(outFile, dictFile);
}

// ---------------------------------------------------------------------------
// Test 4: no flows/ directory → friendly note + exit 0
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-r2-noflows.html');
    cleanup(outFile);

    const { exitCode, stderr } = await run(['flow', NO_FLOWS_MODEL, '-o', outFile]);

    assert(exitCode === 0, 'flow no flows/: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 300)}`);
    assert(
        stderr.length > 0 && (stderr.toLowerCase().includes('no flows') || stderr.includes(NO_FLOWS_MODEL)),
        'flow no flows/: friendly note on stderr',
        `stderr:\n${stderr.slice(0, 300)}`,
    );
    // No viewer file written (we exited early)
    cleanup(outFile);
}

// ---------------------------------------------------------------------------
// Test 5: `flow models/key-inherited -o ...` is parsed path-first
//   - old name-first `flow <name>` would treat "models/key-inherited" as a DFD
//     name and error with "DFD 'models/key-inherited' not found"
//   - now it must be treated as the model path and exit 0
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-r2-ki.html');
    const dictFile = join(TMP, 'test-flow-r2-ki.dict.html');
    cleanup(outFile, dictFile);

    const { exitCode, stdout, stderr } = await run(['flow', KEY_INHERITED, '-o', outFile]);

    assert(exitCode === 0, 'flow key-inherited path-first: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(
        !stderr.includes('not found') && !stderr.includes('Unknown DFD'),
        'flow key-inherited path-first: no DFD-not-found error on stderr',
        `stderr:\n${stderr.slice(0, 300)}`,
    );
    assert(existsSync(outFile), 'flow key-inherited path-first: viewer written', `path: ${outFile}`);

    cleanup(outFile, dictFile);
}

// ---------------------------------------------------------------------------
// Test 6: sibling dict file exists AND viewer HTML contains href to it
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-r2-sibling.html');
    const dictFile = join(TMP, 'test-flow-r2-sibling.dict.html');
    cleanup(outFile, dictFile);

    const { exitCode } = await run(['flow', FLOWS_MODEL, '-o', outFile]);

    assert(exitCode === 0, 'flow sibling: exit 0', `got ${exitCode}`);
    assert(existsSync(dictFile), 'flow sibling: dict file exists on disk', `expected: ${dictFile}`);

    if (existsSync(outFile)) {
        const html = await Bun.file(outFile).text();
        const expectedHref = basename(dictFile);
        assert(
            html.includes(expectedHref),
            `flow sibling: viewer HTML contains href to dict (${expectedHref})`,
            `searched for: ${expectedHref}\nhtml length: ${html.length}`,
        );
    }

    cleanup(outFile, dictFile);
}

// ---------------------------------------------------------------------------
// Test 7: `validate <flows-model>` → exit 0 (validate integration unchanged)
// ---------------------------------------------------------------------------
{
    const { exitCode, stdout, stderr } = await run(['validate', FLOWS_MODEL]);

    assert(exitCode === 0, 'validate with clean flows: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(/valid/i.test(stdout), 'validate with clean flows: stdout reports valid', `stdout: ${stdout}`);
    const errorLines = stderr.split('\n').filter(l => l.startsWith('error'));
    assert(errorLines.length === 0, 'validate with clean flows: no error lines', `errors:\n${errorLines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Test 8: `validate <broken-flows-model>` → exit 1, flow.unknown_store on stderr
// ---------------------------------------------------------------------------
{
    const { exitCode, stderr } = await run(['validate', BROKEN_FLOWS_MODEL]);

    assert(exitCode === 1, 'validate broken flows: exit 1', `got ${exitCode}`);
    assert(
        stderr.includes('flow.unknown_store'),
        'validate broken flows: flow.unknown_store on stderr',
        `stderr:\n${stderr.slice(0, 500)}`,
    );
}

// ---------------------------------------------------------------------------
// Test 9: `validate models/key-inherited` → exit 0 (clean model with flows/)
// ---------------------------------------------------------------------------
{
    const { exitCode, stdout, stderr } = await run(['validate', KEY_INHERITED]);

    assert(exitCode === 0, 'validate key-inherited (has flows/): exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(/valid/i.test(stdout), 'validate key-inherited: stdout reports valid', `stdout: ${stdout}`);
}

// ---------------------------------------------------------------------------
// Test 10: `flow` exits 1 on global error OR Class B flow finding
//
// broken-demo has no flows/ dir, so it exits 0 with "No flows" — it cannot
// exercise the "global error + flows present" path. broken-flows-model
// triggers the Class B `flow.unknown_store` rule, which already drives exit 1
// (covered in Test 3).
//
// A pure "entity global error + flows/" fixture does not exist. Test 3 is the
// authoritative proof that "Class B flow finding → exit 1". The exit condition
// `allGlobalErrors.length > 0 || hasClassBFlowErrors ? 1 : 0` covers both
// arms; the entity-global-error arm would only fire if the fixture had both
// parse/entity errors AND a flows/ directory. Adding such a fixture is
// deferred — the Class B path here is sufficient to catch regressions on the
// exit logic.
// ---------------------------------------------------------------------------
{
    // Re-run the Class B fixture and confirm the new combined exit expression
    // still exits 1 (regression guard for Fix 1).
    const outFile = join(TMP, 'test-flow-r2-exitcode.html');
    const dictFile = join(TMP, 'test-flow-r2-exitcode.dict.html');
    cleanup(outFile, dictFile);

    const { exitCode } = await run(['flow', BROKEN_FLOWS_MODEL, '-o', outFile]);
    assert(exitCode === 1, 'flow exit-code: Class B finding → exit 1 (Fix 1 regression guard)', `got ${exitCode}`);

    cleanup(outFile, dictFile);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log('\n' + (failures === 0
    ? 'All flow-cli tests passed.'
    : `${failures} flow-cli test(s) FAILED.`));
if (failures > 0) process.exit(1);
