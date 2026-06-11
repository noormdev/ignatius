/**
 * test-flow-cli.ts — CP7: `ignatius export` assertions for flow-containing models.
 *
 * Invokes the CLI via `bun src/cli/cli.ts` (no prior binary build required, except
 * where the bundle is needed — those tests are guarded with a bundleExists check).
 *
 * Verifies:
 * - `export <model-path> -o <out>.html` writes ONE file (no sibling .dict.html etc.)
 * - The exported HTML contains __FLOW_MODEL__ injection (flow data baked in)
 * - The exported HTML boots to graph view (no __IGNATIUS_SURFACE__; hash #view= default)
 * - `-o` omitted → stderr error + exit 1
 * - A Class B flow finding (broken-flows-model) → exit 1
 * - A model with no flows/ → exit 0 (export still works; flow view is empty-state)
 * - `export models/key-inherited -o ...` writes one file with flows injected
 * - `validate <flows-model>` still works (validate integration unchanged)
 * - `validate models/key-inherited` → exit 0 (no-flows model unaffected)
 * - `dict`/`graph`/`flow` stubs print "use export" error and exit 1
 *
 * All generated HTML files are written to tmp/ per repo convention.
 */

import { join, resolve } from 'path';
import { existsSync, unlinkSync, readdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const FLOWS_MODEL = join(ROOT, 'test/fixtures/flows-model');
const BROKEN_FLOWS_MODEL = join(ROOT, 'test/fixtures/broken-flows-model');
const KEY_INHERITED = join(ROOT, 'models/key-inherited');
// orm-pure has no flows/ directory — use it for the no-flows test.
const NO_FLOWS_MODEL = join(ROOT, 'models/orm-pure');
const TMP = join(ROOT, 'tmp');

async function run(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(['bun', join(ROOT, 'src/cli/cli.ts'), ...args], {
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

/** Assert that outFile is the ONLY file created — no siblings. */
function assertNoSiblings(outFile: string, label: string): void {
    const dir = join(outFile, '..');
    const base = outFile.split('/').at(-1) ?? '';
    let siblings: string[] = [];
    try {
        siblings = readdirSync(dir).filter(f => f !== base && f.startsWith(base.replace('.html', '')));
    } catch {
        // ignore — dir may not exist
    }
    assert(siblings.length === 0, `${label}: no sibling files created`, `siblings found: ${siblings.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Test 1: path-first `export <model-path> -o <out>.html` exits 0, ONE file
// ---------------------------------------------------------------------------
{
    const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
    if (!bundleExists) {
        console.log('  SKIP  export tests (tests 1-6): dist/static/index.js not built');
    } else {
        const outFile = join(TMP, 'test-export-r2-clean.html');
        cleanup(outFile);

        const { exitCode, stdout, stderr } = await run(['export', FLOWS_MODEL, '-o', outFile]);

        assert(exitCode === 0, 'export path-first clean: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
        assert(existsSync(outFile), 'export path-first clean: output file written', `path: ${outFile}`);
        assertNoSiblings(outFile, 'export path-first clean');

        if (existsSync(outFile)) {
            const html = await Bun.file(outFile).text();
            // Extract pre-module HTML (injection is before <script type="module">).
            // The bundle also contains these global names — checking only the injection portion.
            const moduleIdx = html.indexOf('<script type="module">');
            const preModule = moduleIdx > 0 ? html.slice(0, moduleIdx) : html;
            assert(preModule.includes('window.__FLOW_MODEL__'), 'export injection has __FLOW_MODEL__');
            assert(preModule.includes('window.__LAYOUT_KEY__'), 'export injection has __LAYOUT_KEY__');
            assert(preModule.includes('window.__FLOW_LAYOUT_KEYS__'), 'export injection has __FLOW_LAYOUT_KEYS__');
            // CP8b: __IGNATIUS_SURFACE__ removed; view seeds from hash (#view=) defaulting to graph.
            assert(!preModule.includes('window.__IGNATIUS_SURFACE__'), 'export injection does NOT include __IGNATIUS_SURFACE__ (removed CP8b)');
        }

        cleanup(outFile);
    }
}

// ---------------------------------------------------------------------------
// Test 2: -o omitted → stderr error + exit 1
// ---------------------------------------------------------------------------
{
    const { exitCode, stderr } = await run(['export', FLOWS_MODEL]);

    assert(exitCode === 1, 'export -o omitted: exit 1', `got ${exitCode}`);
    assert(
        stderr.includes('-o') || stderr.includes('required') || stderr.includes('output'),
        'export -o omitted: stderr mentions -o or required',
        `stderr:\n${stderr.slice(0, 300)}`,
    );
}

// ---------------------------------------------------------------------------
// Test 3: Class B flow finding → exit 1
// ---------------------------------------------------------------------------
{
    const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
    if (bundleExists) {
        const outFile = join(TMP, 'test-export-r2-broken.html');
        cleanup(outFile);

        const { exitCode, stderr } = await run(['export', BROKEN_FLOWS_MODEL, '-o', outFile]);

        assert(exitCode === 1, 'export Class B finding: exit 1', `got ${exitCode}`);
        assert(
            stderr.includes('flow.unknown_store') || stderr.includes('error'),
            'export Class B: stderr mentions flow.unknown_store or error',
            `stderr:\n${stderr.slice(0, 500)}`,
        );

        cleanup(outFile);
    }
}

// ---------------------------------------------------------------------------
// Test 4: model with no flows/ → exit 0, ONE file (flow view shows empty state)
// ---------------------------------------------------------------------------
{
    const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
    if (bundleExists) {
        const outFile = join(TMP, 'test-export-r2-noflows.html');
        cleanup(outFile);

        const { exitCode, stderr } = await run(['export', NO_FLOWS_MODEL, '-o', outFile]);

        // export exits 0 for a clean model with no flows (flow view is empty state)
        assert(exitCode === 0, 'export no flows/: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 300)}`);
        assert(existsSync(outFile), 'export no flows/: output file written', `path: ${outFile}`);
        assertNoSiblings(outFile, 'export no flows/');

        if (existsSync(outFile)) {
            const html = await Bun.file(outFile).text();
            // Check the pre-module injection (bundle also references these global names).
            const moduleIdx = html.indexOf('<script type="module">');
            const preModule = moduleIdx > 0 ? html.slice(0, moduleIdx) : html;
            assert(preModule.includes('window.__MODEL__'), 'export no flows/: injection has __MODEL__');
            assert(preModule.includes('window.__LAYOUT_KEY__'), 'export no flows/: injection has __LAYOUT_KEY__');
        }

        cleanup(outFile);
    }
}

// ---------------------------------------------------------------------------
// Test 5: `export models/key-inherited -o ...` (model WITH flows/) — one file
// ---------------------------------------------------------------------------
{
    const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
    if (bundleExists) {
        const outFile = join(TMP, 'test-export-r2-ki.html');
        cleanup(outFile);

        const { exitCode, stdout, stderr } = await run(['export', KEY_INHERITED, '-o', outFile]);

        assert(exitCode === 0, 'export key-inherited: exit 0', `got ${exitCode}\nstderr:\n${stderr.slice(0, 500)}`);
        assert(existsSync(outFile), 'export key-inherited: output file written', `path: ${outFile}`);
        assertNoSiblings(outFile, 'export key-inherited');

        cleanup(outFile);
    }
}

// ---------------------------------------------------------------------------
// Test 6: exit 1 on global error OR Class B flow finding (regression guard)
// ---------------------------------------------------------------------------
{
    const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
    if (bundleExists) {
        const outFile = join(TMP, 'test-export-r2-exitcode.html');
        cleanup(outFile);

        const { exitCode } = await run(['export', BROKEN_FLOWS_MODEL, '-o', outFile]);
        assert(exitCode === 1, 'export exit-code: Class B finding → exit 1', `got ${exitCode}`);

        cleanup(outFile);
    }
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
// Test 10: removed stubs — dict/graph/flow print "use export" and exit 1
// ---------------------------------------------------------------------------
{
    for (const verb of ['dict', 'graph', 'flow'] as const) {
        const { exitCode, stderr } = await run([verb, KEY_INHERITED, '-o', join(TMP, `test-stub-${verb}.html`)]);
        assert(exitCode === 1, `${verb} stub: exit 1`, `got ${exitCode}`);
        assert(
            stderr.includes('export'),
            `${verb} stub: stderr mentions 'export'`,
            `stderr:\n${stderr.slice(0, 200)}`,
        );
    }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log('\n' + (failures === 0
    ? 'All export-cli tests passed.'
    : `${failures} export-cli test(s) FAILED.`));
if (failures > 0) process.exit(1);
