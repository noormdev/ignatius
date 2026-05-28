import { resolve } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from './server';
import { parseModels } from './parse';
import { generateDict } from './generators/dict';
import { generateGraph } from './generators/graph';
import { loadEmbeddedBundle } from './generators/embedded-bundle';

export type ParsedArgs = {
  subcommand: 'serve' | 'dict' | 'graph' | 'help' | 'unknown';
  positional: string[];
  flags: {
    help: boolean;
    port: number;
    output: string | undefined;
    theme: string | undefined;
  };
};

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    subcommand: 'help',
    positional: [],
    flags: {
      help: false,
      port: 3000,
      output: undefined,
      theme: undefined,
    },
  };

  const tokens = argv.slice(); // mutable copy; shift() avoids noUncheckedIndexedAccess issues
  let subcommandSeen = false;

  const next = (): string | undefined => tokens.shift();

  let token = next();
  while (token !== undefined) {
    if (token === '--help' || token === '-h') {
      result.flags.help = true;
      result.subcommand = 'help';
    } else if (token === '--port' || token === '-p') {
      const val = tokens[0];
      if (val !== undefined && !val.startsWith('-')) {
        result.flags.port = Number(next());
      }
    } else if (token.startsWith('--port=')) {
      result.flags.port = Number(token.slice('--port='.length));
    } else if (token === '--theme') {
      const val = next();
      if (val !== undefined) result.flags.theme = val;
    } else if (token.startsWith('--theme=')) {
      result.flags.theme = token.slice('--theme='.length);
    } else if (token === '-o' || token === '--output') {
      const val = next();
      if (val !== undefined) result.flags.output = val;
    } else if (token.startsWith('--output=')) {
      result.flags.output = token.slice('--output='.length);
    } else if (!subcommandSeen) {
      subcommandSeen = true;
      if (token === 'serve') {
        result.subcommand = 'serve';
      } else if (token === 'dict') {
        result.subcommand = 'dict';
      } else if (token === 'graph') {
        result.subcommand = 'graph';
      } else if (token === 'help') {
        result.subcommand = 'help';
      } else {
        result.subcommand = 'unknown';
        result.positional.push(token);
      }
    } else {
      // Remaining non-flag tokens are positional args
      result.positional.push(token);
    }

    token = next();
  }

  return result;
}

function printUsage(): void {
  console.log(`
derek — DB model viewer

Usage:
  derek serve <models-dir> [--port <port>]
  derek dict  <models-dir> -o <output.html> [--theme light|dark]
  derek graph <models-dir> -o <output.html> [--theme light|dark]
  derek --help

Subcommands:
  serve   Start the interactive server (default port: 3000)
  dict    Generate a static data dictionary HTML file
  graph   Generate a static graph HTML file
  help    Print this message

Options:
  --port <port>       Port for the serve subcommand (default: 3000)
  -o, --output <file> Output file path for dict/graph
  --theme light|dark  Theme for static output
  --help, -h          Print this message
`.trim());
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.flags.help || parsed.subcommand === 'help') {
    printUsage();
    process.exit(0);
  }

  if (parsed.subcommand === 'unknown') {
    console.error(`Unknown subcommand: ${parsed.positional[0]}`);
    console.error('Run "derek --help" for usage.');
    process.exit(1);
  }

  if (parsed.subcommand === 'dict' || parsed.subcommand === 'graph') {
    const dir = parsed.positional[0];

    if (!dir) {
      console.error(`Error: ${parsed.subcommand} requires a models directory argument.`);
      console.error(`Usage: derek ${parsed.subcommand} <models-dir> -o <output.html>`);
      process.exit(1);
    }

    const outputPath = parsed.flags.output;
    if (!outputPath) {
      console.error(`Error: -o <output.html> is required for the ${parsed.subcommand} subcommand.`);
      process.exit(1);
    }

    const resolvedDir = resolve(dir);
    if (!existsSync(resolvedDir)) {
      console.error(`Error: models directory not found: ${resolvedDir}`);
      process.exit(1);
    }

    const mode = parsed.flags.theme === 'light' ? 'light' : 'dark';
    const model = await parseModels(resolvedDir);

    let html: string;
    if (parsed.subcommand === 'dict') {
      html = generateDict(model, mode);
    } else {
      // graph: load the embedded bundle (stable index.js / index.css embedded at compile time)
      const bundle = await loadEmbeddedBundle();
      html = await generateGraph(model, mode, bundle);
    }

    await Bun.write(outputPath, html);
    console.log(`Wrote ${parsed.subcommand} to ${outputPath}`);
    process.exit(0);
  }

  if (parsed.subcommand === 'serve') {
    const dir = parsed.positional[0];

    if (!dir) {
      console.error('Error: serve requires a models directory argument.');
      console.error('Usage: derek serve <models-dir>');
      process.exit(1);
    }

    const resolvedDir = resolve(dir);

    if (!existsSync(resolvedDir)) {
      console.error(`Error: models directory not found: ${resolvedDir}`);
      process.exit(1);
    }

    serveCommand(resolvedDir, { port: parsed.flags.port });
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
