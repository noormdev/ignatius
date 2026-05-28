/**
 * Verification: CLI argument parser returns the expected shape.
 * Run with: bun tmp/test-cli-parse.ts
 */
import { parseArgs } from '../src/cli';

type ParseResult = ReturnType<typeof parseArgs>;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

// --help flag at root
{
  const r = parseArgs(['--help']);
  assert(r.subcommand === 'help', '--help → subcommand=help');
  assert(r.flags.help === true, '--help → flags.help=true');
}

// -h shorthand
{
  const r = parseArgs(['-h']);
  assert(r.subcommand === 'help', '-h → subcommand=help');
}

// serve with positional
{
  const r = parseArgs(['serve', 'models/']);
  assert(r.subcommand === 'serve', 'serve → subcommand=serve');
  assert(r.positional[0] === 'models/', 'serve → positional[0]=models/');
  assert(r.flags.port === 3000, 'serve (no --port) → port=3000');
}

// serve with --port
{
  const r = parseArgs(['serve', 'models/', '--port', '8080']);
  assert(r.flags.port === 8080, '--port 8080 → flags.port=8080');
}

// serve with --port=8080 syntax
{
  const r = parseArgs(['serve', 'models/', '--port=9000']);
  assert(r.flags.port === 9000, '--port=9000 → flags.port=9000');
}

// dict stub
{
  const r = parseArgs(['dict', 'models/']);
  assert(r.subcommand === 'dict', 'dict → subcommand=dict');
}

// graph stub
{
  const r = parseArgs(['graph', 'models/']);
  assert(r.subcommand === 'graph', 'graph → subcommand=graph');
}

// unknown subcommand
{
  const r = parseArgs(['unknown-cmd']);
  assert(r.subcommand === 'unknown', 'unknown cmd → subcommand=unknown');
  assert(r.positional[0] === 'unknown-cmd', 'unknown cmd → positional[0]=unknown-cmd');
}

// no args
{
  const r = parseArgs([]);
  assert(r.subcommand === 'help', 'no args → subcommand=help');
}

// serve without dir — positional is empty (main() exits 1 for this; parse level documents contract)
{
  const r = parseArgs(['serve']);
  assert(r.subcommand === 'serve', 'serve (no dir) → subcommand=serve');
  assert(r.positional.length === 0, 'serve (no dir) → positional=[]');
}

// --help after subcommand — flags.help=true, subcommand retained (not overridden to 'help')
{
  const r = parseArgs(['serve', '--help']);
  assert(r.flags.help === true, 'serve --help → flags.help=true');
  assert(r.subcommand === 'serve', 'serve --help → subcommand retains serve (for scoped usage)');
}

// --port without value — NaN signals parse-level error
{
  const r = parseArgs(['serve', 'models/', '--port']);
  assert(isNaN(r.flags.port), '--port (no value) → flags.port=NaN');
}

// --theme flag
{
  const r = parseArgs(['serve', 'models/', '--theme', 'light']);
  assert(r.flags.theme === 'light', '--theme light → flags.theme=light');
}

// -o flag
{
  const r = parseArgs(['dict', 'models/', '-o', 'out.html']);
  assert(r.flags.output === 'out.html', '-o out.html → flags.output=out.html');
}

console.log('\nAll assertions passed.');
