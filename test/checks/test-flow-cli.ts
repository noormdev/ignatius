/**
 * test-flow-cli.ts — CP-5: CLI assertions for `ignatius flow` and `validate` integration.
 *
 * Invokes the CLI via `bun src/cli.ts` (no prior binary build required).
 *
 * Verifies:
 * - `flow checkout <flows-model>` writes flow-checkout.html, exits 0
 * - `flow checkout <broken-flows-model>` exits 1 (Class B: flow.unknown_store)
 * - `flow unknown-dfd <flows-model>` exits 1 with a message on stderr
 * - `validate <flows-model>` exits 0, no flow findings (clean model)
 * - `validate <broken-flows-model>` exits 1, flow error on stderr
 * - `validate models/key-inherited` exits 0, unaffected by flow integration
 *
 * All generated HTML files are written to tmp/ per repo convention.
 */

import { join, resolve } from 'path';
import { existsSync, unlinkSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const FLOWS_MODEL = join(ROOT, 'test/fixtures/flows-model');
const BROKEN_FLOWS_MODEL = join(ROOT, 'test/fixtures/broken-flows-model');
const KEY_INHERITED = join(ROOT, 'models/key-inherited');
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

function cleanup(path: string): void {
    try {
        if (existsSync(path)) unlinkSync(path);
    } catch {
        // ignore cleanup errors
    }
}

// ---------------------------------------------------------------------------
// Test 1: `flow checkout <flows-model>` → writes flow-checkout.html, exits 0
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-checkout-clean.html');
    cleanup(outFile);

    const { exitCode, stdout, stderr } = await run(['flow', 'checkout', FLOWS_MODEL, '--out', outFile]);

    assert(exitCode === 0, 'flow clean: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(existsSync(outFile), 'flow clean: output file written', `path: ${outFile}`);

    if (existsSync(outFile)) {
        const html = await Bun.file(outFile).text();
        assert(html.includes('__FLOW_MODEL__'), 'flow clean: HTML contains __FLOW_MODEL__ injection', `html length: ${html.length}`);
        assert(html.includes('__IGNATIUS_SURFACE__'), 'flow clean: HTML contains __IGNATIUS_SURFACE__ injection');
    }

    cleanup(outFile);
}

// ---------------------------------------------------------------------------
// Test 2: `flow checkout <broken-flows-model>` → exits 1 (Class B finding)
// ---------------------------------------------------------------------------
{
    const outFile = join(TMP, 'test-flow-checkout-broken.html');
    cleanup(outFile);

    const { exitCode, stderr } = await run(['flow', 'checkout', BROKEN_FLOWS_MODEL, '--out', outFile]);

    assert(exitCode === 1, 'flow broken: exit 1 on Class B finding', `got ${exitCode}`);
    // flow.unknown_store is Class B → should appear in stderr
    assert(
        stderr.includes('flow.unknown_store') || stderr.includes('error'),
        'flow broken: stderr mentions flow.unknown_store or error',
        `stderr:\n${stderr.slice(0, 500)}`,
    );

    cleanup(outFile);
}

// ---------------------------------------------------------------------------
// Test 3: `flow unknown-dfd <flows-model>` → exits 1 with message on stderr
// ---------------------------------------------------------------------------
{
    const { exitCode, stderr } = await run(['flow', 'unknown-dfd', FLOWS_MODEL]);

    assert(exitCode === 1, 'flow unknown DFD: exit 1', `got ${exitCode}`);
    assert(stderr.length > 0, 'flow unknown DFD: message on stderr', `stderr was empty`);
    // Message should reference the unknown name
    assert(
        stderr.includes('unknown-dfd') || stderr.includes('not found') || stderr.includes('Unknown'),
        'flow unknown DFD: stderr mentions the unknown name',
        `stderr:\n${stderr.slice(0, 300)}`,
    );
}

// ---------------------------------------------------------------------------
// Test 4: `validate <flows-model>` → exit 0, no flow error lines (clean DFD)
// ---------------------------------------------------------------------------
{
    const { exitCode, stdout, stderr } = await run(['validate', FLOWS_MODEL]);

    assert(exitCode === 0, 'validate with clean flows: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(/valid/i.test(stdout), 'validate with clean flows: stdout reports valid', `stdout: ${stdout}`);
    const errorLines = stderr.split('\n').filter(l => l.startsWith('error'));
    assert(errorLines.length === 0, 'validate with clean flows: no error lines', `errors:\n${errorLines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Test 5: `validate <broken-flows-model>` → exit 1, flow.unknown_store on stderr
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
// Test 6: `validate models/key-inherited` → exit 0, unaffected by flow integration
// ---------------------------------------------------------------------------
{
    const { exitCode, stdout, stderr } = await run(['validate', KEY_INHERITED]);

    assert(exitCode === 0, 'validate key-inherited (no flows/): exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
    assert(/valid/i.test(stdout), 'validate key-inherited: stdout reports valid', `stdout: ${stdout}`);
    const errorLines = stderr.split('\n').filter(l => l.startsWith('error'));
    assert(errorLines.length === 0, 'validate key-inherited: no error lines', `errors:\n${errorLines.join('\n')}`);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log('\n' + (failures === 0
    ? 'All flow-cli tests passed.'
    : `${failures} flow-cli test(s) FAILED.`));
if (failures > 0) process.exit(1);
