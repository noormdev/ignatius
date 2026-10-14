/** Export bakes in an existing baseline's change review and never creates a baseline, so exporting cannot bless unreviewed edits. */

import { chromium } from 'playwright';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assert } from '../assert';
import { approve } from '../../src/model/change-store';

const ROOT = resolve(import.meta.dir, '../..');
const FIXTURE = join(ROOT, 'models/key-inherited');

if (!(await Bun.file(join(ROOT, 'dist/static/index.js')).exists())) {
  console.log('SKIP: dist/static/index.js not built');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'ignatius-export-review-'));
const dir = join(work, 'model');
const leftovers = new Set([join(FIXTURE, '.ignatius'), join(FIXTURE, '.gitignore')]);
cpSync(FIXTURE, dir, { recursive: true, filter: source => !leftovers.has(source) });

async function exportHtml(name: string): Promise<{ path: string; html: string; stderr: string }> {
  const path = join(work, name);
  const proc = Bun.spawn(['bun', join(ROOT, 'src/cli/cli.ts'), 'export', dir, '-o', path], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  assert(code === 0, `FAIL: ${name} export exits 0 (code ${code})`, stderr.slice(0, 400));
  return { path, html: existsSync(path) ? readFileSync(path, 'utf8') : '', stderr };
}

const injection = (html: string) => html.slice(0, html.indexOf('<script type="module">'));

const browser = await chromium.launch();
try {
  const unreviewed = await exportHtml('no-baseline.html');
  assert(!injection(unreviewed.html).includes('__CHANGE_REVIEW__'), 'FAIL: a model with no baseline exports no change review');
  assert(!existsSync(join(dir, '.ignatius')) && !existsSync(join(dir, '.gitignore')), 'FAIL: export writes neither .ignatius/ nor a .gitignore');

  await approve(dir);
  const person = join(dir, 'data/identity/Person.md');
  writeFileSync(person, readFileSync(person, 'utf8').replace('  birthdate:\n', '  nickname:\n    type: text\n    desc: "Added."\n  birthdate:\n'));
  mkdirSync(join(dir, '.ignatius/changes'), { recursive: true });
  writeFileSync(join(dir, '.ignatius/changes/hostile.md'), '---\ntitle: "<!--<script> </script><script>alert(1)</script>"\nentities:\n  Person: [nickname]\n---\n\nWhy.\n');

  const reviewed = await exportHtml('with-baseline.html');
  const match = /window\.__CHANGE_REVIEW__ = (\{.*?\}); window\./s.exec(injection(reviewed.html));
  assert(match !== null, 'FAIL: an approved model exports its change review');
  const review = JSON.parse(match?.[1] ?? '{}');
  assert(
    review.items?.some((item: { scope: string; entity?: string }) => item.scope === 'column' && item.entity === 'Person'),
    `FAIL: the exported review carries the added Person column ${JSON.stringify(review.items)}`,
  );

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.goto(`file://${reviewed.path}#view=graph`);
  await page.waitForSelector('.changes-panel', { timeout: 15_000 });
  assert(pageErrors.length === 0, 'FAIL: a note title carrying script markup leaves the exported page running', pageErrors.join('; '));
  assert((await page.locator('.changes-panel-approve').count()) === 0, 'FAIL: a static export shows no Approve button');
  await page.waitForFunction(() => Object.keys(window.__IGNATIUS_GLOW__ ?? {}).length > 0, undefined, { timeout: 15_000 });
  const glow = await page.evaluate(() => window.__IGNATIUS_GLOW__ ?? {});
  assert('Person' in glow, `FAIL: the changed Person node glows in the export ${JSON.stringify(Object.keys(glow))}`);

  console.log(process.exitCode ? '\nexport-change-review: failures above.' : '\nAll export-change-review checks passed.');
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
