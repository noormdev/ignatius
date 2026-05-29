// Test: inlineAsset() — all input shapes + failure cases
import { inlineAsset } from '../../src/generators/inline-asset';
import { resolve } from 'path';

const fixturesDir = resolve(import.meta.dir, '../../tmp/test-fixtures');
await Bun.$`mkdir -p ${fixturesDir}`;

// Write a tiny PNG fixture (1x1 red pixel, minimal valid PNG)
const pngHex = '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d7636060606000000004010016efd1e20000000049454e44ae426082';
const pngBytes = Buffer.from(pngHex, 'hex');
const pngFixturePath = resolve(fixturesDir, 'fixture.png');
await Bun.write(pngFixturePath, pngBytes);

// Write a tiny SVG fixture
const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const svgFixturePath = resolve(fixturesDir, 'fixture.svg');
await Bun.write(svgFixturePath, svgContent);

// Write a fixture with unknown extension to test MIME fallback
const unknownFixturePath = resolve(fixturesDir, 'fixture.dat');
await Bun.write(unknownFixturePath, 'data');

const FALLBACK = 'data:image/svg+xml;base64,FALLBACKCONTENT';

// --- (a) Unset input returns fallback ---
{
  const result = await inlineAsset(undefined, fixturesDir, FALLBACK);
  console.assert(result === FALLBACK, `FAIL (a): expected fallback, got: ${result}`);
  const emptyResult = await inlineAsset('', fixturesDir, FALLBACK);
  console.assert(emptyResult === FALLBACK, `FAIL (a): expected fallback for empty string, got: ${emptyResult}`);
  console.log('PASS (a): unset/empty input returns fallback');
}

// --- (b) URL input fetches + base64-encodes (local server, no live network) ---
{
  const localSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
  const localServer = Bun.serve({
    port: 0, // OS-assigned port
    fetch() {
      return new Response(localSvg, { headers: { 'Content-Type': 'image/svg+xml' } });
    },
  });
  const localUrl = `http://localhost:${localServer.port}/test.svg`;
  try {
    const result = await inlineAsset(localUrl, fixturesDir, FALLBACK);
    console.assert(result.startsWith('data:image/svg+xml;base64,'), `FAIL (b): expected data URI, got: ${result.slice(0, 60)}`);
    const b64Part = result.slice('data:image/svg+xml;base64,'.length);
    const decoded = Buffer.from(b64Part, 'base64').toString('utf8');
    console.assert(decoded.includes('<svg'), `FAIL (b): decoded content should be SVG: ${decoded.slice(0, 100)}`);
    console.log('PASS (b): URL input fetches + base64-encodes');
  } finally {
    localServer.stop(true);
  }
}

// --- (c) Filepath input reads + base64-encodes ---
{
  const result = await inlineAsset('fixture.svg', fixturesDir, FALLBACK);
  console.assert(result.startsWith('data:image/svg+xml;base64,'), `FAIL (c): expected svg data URI, got: ${result.slice(0, 60)}`);
  const b64Part = result.slice('data:image/svg+xml;base64,'.length);
  const decoded = Buffer.from(b64Part, 'base64').toString('utf8');
  console.assert(decoded.includes('<svg'), `FAIL (c): decoded content should be SVG: ${decoded.slice(0, 100)}`);
  console.log('PASS (c): filepath input reads + base64-encodes');
}

// --- (d) Nonexistent filepath throws with absolute resolved path ---
{
  let threw = false;
  let errorMsg = '';
  try {
    await inlineAsset('nonexistent.svg', fixturesDir, FALLBACK);
  } catch (e: unknown) {
    threw = true;
    errorMsg = e instanceof Error ? e.message : String(e);
  }
  const expectedAbsPath = resolve(fixturesDir, 'nonexistent.svg');
  console.assert(threw, 'FAIL (d): should have thrown for nonexistent file');
  console.assert(errorMsg.includes(expectedAbsPath), `FAIL (d): error should contain absolute path "${expectedAbsPath}", got: ${errorMsg}`);
  console.log('PASS (d): nonexistent filepath throws with absolute resolved path');
}

// --- (e) Unreachable URL throws with the URL ---
{
  let threw = false;
  let errorMsg = '';
  const badUrl = 'https://this-domain-does-not-exist-at-all-xyz-abc.invalid/logo.svg';
  try {
    await inlineAsset(badUrl, fixturesDir, FALLBACK);
  } catch (e: unknown) {
    threw = true;
    errorMsg = e instanceof Error ? e.message : String(e);
  }
  console.assert(threw, 'FAIL (e): should have thrown for unreachable URL');
  console.assert(errorMsg.includes(badUrl), `FAIL (e): error should contain URL "${badUrl}", got: ${errorMsg}`);
  console.log('PASS (e): unreachable URL throws with the URL');
}

// --- (f) MIME type sniffing ---
{
  const svgResult = await inlineAsset('fixture.svg', fixturesDir, FALLBACK);
  console.assert(svgResult.startsWith('data:image/svg+xml;base64,'), `FAIL (f): .svg should be image/svg+xml, got: ${svgResult.slice(0, 60)}`);

  const pngResult = await inlineAsset('fixture.png', fixturesDir, FALLBACK);
  console.assert(pngResult.startsWith('data:image/png;base64,'), `FAIL (f): .png should be image/png, got: ${pngResult.slice(0, 60)}`);

  const unknownResult = await inlineAsset('fixture.dat', fixturesDir, FALLBACK);
  console.assert(unknownResult.startsWith('data:image/png;base64,'), `FAIL (f): unknown ext should default to image/png, got: ${unknownResult.slice(0, 60)}`);

  console.log('PASS (f): MIME type sniffing (.svg, .png, unknown→default)');
}

console.log('All inline-asset tests passed.');
