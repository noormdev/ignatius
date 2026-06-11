/**
 * CP7 check: `ignatius export` injects the union of window globals.
 *
 * Verifies that the single exported HTML file contains ALL of:
 *   - window.__MODEL__            (entity model)
 *   - window.__FLOW_MODEL__       (flow diagrams — when flows/ exists)
 *   - window.__LAYOUT_KEY__       (ERD position-restore fingerprint)
 *   - window.__FLOW_LAYOUT_KEYS__ (per-diagram fingerprint map — when flows/ exists)
 *   - window.__IGNATIUS_MODE__ = "static"
 *   - (no __IGNATIUS_SURFACE__ — removed CP8b; view seeds from hash defaulting to graph)
 *   - window.__THEME_MODE__
 *
 * WHY: The union injection is the core requirement for offline all-three-views.
 * The ERD __LAYOUT_KEY__ was not injected by the old `flow` subcommand; it must
 * now be present. The flow layout keys must also survive so per-diagram positions
 * restore correctly.
 *
 * Runs against models/key-inherited (has a flows/ directory → all globals injected).
 * Also runs against models/orm-pure (no flows/ → only entity globals injected).
 *
 * Does NOT require Playwright — HTML string inspection is sufficient for injection checks.
 * Bundle IS required: export generates the React SPA file.
 */

import { join, resolve } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { mkdirSync } from 'fs';

const ROOT = resolve(import.meta.dir, '../..');
const KEY_INHERITED = join(ROOT, 'models/key-inherited');
const ORM_PURE = join(ROOT, 'models/orm-pure');
const TMP = join(ROOT, 'tmp');
mkdirSync(TMP, { recursive: true });

let failures = 0;
function assert(cond: boolean, label: string, detail?: string): void {
    if (cond) {
        console.log(`  PASS  ${label}`);
    } else {
        console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
        failures++;
    }
}

function cleanup(...paths: string[]): void {
    for (const p of paths) {
        try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }
    }
}

// ── Guard: bundle must be built ───────────────────────────────────────────────

const bundleExists = await Bun.file(join(ROOT, 'dist/static/index.js')).exists();
if (!bundleExists) {
    console.log('  SKIP  all union-injection tests: dist/static/index.js not built');
    console.log('\nAll union-injection tests SKIPPED (bundle not built).');
    process.exit(0);
}

// ── Helper: run CLI ───────────────────────────────────────────────────────────

async function runExport(modelPath: string, outFile: string): Promise<{ exitCode: number; stderr: string }> {
    const proc = Bun.spawn(
        ['bun', join(ROOT, 'src/cli/cli.ts'), 'export', modelPath, '-o', outFile],
        { stdout: 'pipe', stderr: 'pipe' },
    );
    const timer = setTimeout(() => proc.kill(), 60_000);
    const [exitCode, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);
    return { exitCode, stderr };
}

// ── Test 1: key-inherited (has flows/) — all globals present ─────────────────

{
    const outFile = join(TMP, 'test-union-injection-ki.html');
    cleanup(outFile);

    const { exitCode, stderr } = await runExport(KEY_INHERITED, outFile);

    assert(exitCode === 0, 'key-inherited export: exit 0', `stderr:\n${stderr.slice(0, 400)}`);

    if (existsSync(outFile)) {
        const html = await Bun.file(outFile).text();

            // All checks target the injection block, not the inlined bundle.
        // The injection script appears immediately before <script type="module">.
        // We extract the HTML up to the module script and look for the injection there.
        // WHY not regex the script tag: the model JSON contains < characters that break
        // [^<]+ patterns; scanning up to the module script boundary is simpler.
        const moduleScriptIdx = html.indexOf('<script type="module">');
        const preModule = moduleScriptIdx > 0 ? html.slice(0, moduleScriptIdx) : html;

        assert(preModule.includes('window.__IGNATIUS_MODE__ = "static"'), 'key-inherited: injection has __IGNATIUS_MODE__ = "static"');
        assert(preModule.includes('window.__MODEL__'), 'key-inherited: injection has __MODEL__');
        assert(preModule.includes('window.__FLOW_MODEL__'), 'key-inherited: injection has __FLOW_MODEL__ (has flows/)');
        assert(preModule.includes('window.__LAYOUT_KEY__'), 'key-inherited: injection has __LAYOUT_KEY__ (ERD position-restore)');
        assert(preModule.includes('window.__FLOW_LAYOUT_KEYS__'), 'key-inherited: injection has __FLOW_LAYOUT_KEYS__ (flow positions)');
        assert(preModule.includes('window.__THEME_MODE__'), 'key-inherited: injection has __THEME_MODE__');
        // CP8b: __IGNATIUS_SURFACE__ removed; view seeds from hash (#view=) defaulting to graph.
        assert(!preModule.includes('window.__IGNATIUS_SURFACE__'), 'key-inherited: injection does NOT include __IGNATIUS_SURFACE__ (removed CP8b)');

        // Verify it is ONE file — no siblings in the tmp dir that share the prefix
        const fileBase = outFile.replace('.html', '');
        const sibs: string[] = [];
        for await (const entry of new Bun.Glob(`${fileBase}*.html`).scan(TMP)) {
          sibs.push(entry);
        }
        // sibs will include the file itself
        const otherSibs = sibs.filter(s => !s.endsWith('test-union-injection-ki.html'));
        assert(otherSibs.length === 0, 'key-inherited: ONE file, no siblings', `siblings: ${otherSibs.join(', ')}`);

        // __LAYOUT_KEY__ value must be a non-empty string in the pre-module injection
        const layoutKeyMatch = preModule.match(/window\.__LAYOUT_KEY__\s*=\s*"([^"]+)"/);
        assert(
            layoutKeyMatch !== null && layoutKeyMatch[1].length > 0,
            'key-inherited: __LAYOUT_KEY__ has a non-empty value',
            `pre-module slice (first 300): ${preModule.slice(-300)}`,
        );

        // __FLOW_LAYOUT_KEYS__ must be a non-empty object literal in the injection
        // (not {} — must contain at least one diagram fingerprint key)
        const hasNonEmptyFlowKeys = preModule.includes('window.__FLOW_LAYOUT_KEYS__ = {"');
        assert(
            hasNonEmptyFlowKeys,
            'key-inherited: __FLOW_LAYOUT_KEYS__ has at least one diagram key',
            `pre-module slice (last 300): ${preModule.slice(-300)}`,
        );
    } else {
        assert(false, 'key-inherited: output file written');
    }

    cleanup(outFile);
}

// ── Test 2: orm-pure (no flows/) — entity globals present, no flow globals ───

{
    const outFile = join(TMP, 'test-union-injection-nof.html');
    cleanup(outFile);

    const { exitCode, stderr } = await runExport(ORM_PURE, outFile);

    assert(exitCode === 0, 'orm-pure (no flows) export: exit 0', `stderr:\n${stderr.slice(0, 400)}`);

    if (existsSync(outFile)) {
        const html = await Bun.file(outFile).text();

        // Extract the pre-module HTML (injection appears before <script type="module">)
        const moduleIdx = html.indexOf('<script type="module">');
        const preModule = moduleIdx > 0 ? html.slice(0, moduleIdx) : html;

        assert(preModule.includes('window.__IGNATIUS_MODE__ = "static"'), 'orm-pure: injection has __IGNATIUS_MODE__ = "static"');
        assert(preModule.includes('window.__MODEL__'), 'orm-pure: injection has __MODEL__');
        assert(preModule.includes('window.__LAYOUT_KEY__'), 'orm-pure: injection has __LAYOUT_KEY__');
        assert(preModule.includes('window.__THEME_MODE__'), 'orm-pure: injection has __THEME_MODE__');
        // CP8b: __IGNATIUS_SURFACE__ removed.
        assert(!preModule.includes('window.__IGNATIUS_SURFACE__'), 'orm-pure: injection does NOT include __IGNATIUS_SURFACE__ (removed CP8b)');
        // Flow globals must NOT be in the injection block (no flows/ directory).
        // The bundle code itself references these globals — checking only pre-module HTML.
        assert(!preModule.includes('window.__FLOW_MODEL__'), 'orm-pure: injection does NOT have __FLOW_MODEL__ (no flows/)');
        assert(!preModule.includes('window.__FLOW_LAYOUT_KEYS__'), 'orm-pure: injection does NOT have __FLOW_LAYOUT_KEYS__ (no flows/)');
    } else {
        assert(false, 'orm-pure: output file written');
    }

    cleanup(outFile);
}

// ── Test 3: -o omitted → exit 1 (no file written) ────────────────────────────

{
    const { exitCode, stderr } = await (async () => {
        const proc = Bun.spawn(
            ['bun', join(ROOT, 'src/cli/cli.ts'), 'export', KEY_INHERITED],
            { stdout: 'pipe', stderr: 'pipe' },
        );
        const timer = setTimeout(() => proc.kill(), 30_000);
        const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
        clearTimeout(timer);
        return { exitCode, stderr };
    })();

    assert(exitCode === 1, 'export -o omitted: exit 1', `got ${exitCode}`);
    assert(
        stderr.includes('-o') || stderr.includes('required'),
        'export -o omitted: stderr mentions -o or required',
        `stderr: ${stderr.slice(0, 200)}`,
    );
}

// ── Done ──────────────────────────────────────────────────────────────────────

console.log('\n' + (failures === 0
    ? 'All union-injection tests passed.'
    : `${failures} union-injection test(s) FAILED.`));
if (failures > 0) process.exit(1);
