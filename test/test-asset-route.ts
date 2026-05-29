/**
 * Tests for GET /api/asset?path=... route
 * Starts serveCommand on a free port, sends requests, verifies status codes.
 */

import { resolve } from 'path';
import { serveCommand } from '../src/server';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

const fixtureDir = resolve(import.meta.dir, '../tmp/test-fixtures/asset-route-test');
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(resolve(fixtureDir, 'test-logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

const handle = serveCommand(fixtureDir, { port: 3099 });
const base = `http://localhost:3099`;

// --- Test 1: valid relative path returns 200 ---
{
  const res = await fetch(`${base}/api/asset?path=test-logo.svg`);
  console.assert(res.status === 200, `FAIL: expected 200, got ${res.status}`);
  const text = await res.text();
  console.assert(text.includes('<svg'), `FAIL: expected SVG content, got: ${text.slice(0, 40)}`);
  console.log('PASS: valid relative path returns 200 with file contents');
}

// --- Test 2: absolute path returns 400 ---
{
  const res = await fetch(`${base}/api/asset?path=/etc/passwd`);
  console.assert(res.status === 400, `FAIL: expected 400 for absolute path, got ${res.status}`);
  await res.body?.cancel();
  console.log('PASS: absolute path returns 400');
}

// --- Test 3: path traversal with .. returns 400 ---
{
  const res = await fetch(`${base}/api/asset?path=../../etc/passwd`);
  console.assert(res.status === 400, `FAIL: expected 400 for traversal, got ${res.status}`);
  await res.body?.cancel();
  console.log('PASS: path traversal with .. returns 400');
}

// --- Test 4: missing file returns 404 ---
{
  const res = await fetch(`${base}/api/asset?path=does-not-exist.svg`);
  console.assert(res.status === 404, `FAIL: expected 404 for missing file, got ${res.status}`);
  await res.body?.cancel();
  console.log('PASS: missing file returns 404');
}

// --- Test 5: missing path query param returns 400 ---
{
  const res = await fetch(`${base}/api/asset`);
  console.assert(res.status === 400, `FAIL: expected 400 for missing param, got ${res.status}`);
  await res.body?.cancel();
  console.log('PASS: missing path query param returns 400');
}

handle.stop(true);
rmSync(fixtureDir, { recursive: true, force: true });
console.log('All asset route tests passed.');
