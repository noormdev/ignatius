import { resolve } from 'path';
import { existsSync } from 'fs';
import { serveCommand } from './server';
import { parseModels } from './parse';
import { generateDict } from './generators/dict';
import { generateGraph } from './generators/graph';

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
      // Subcommand-scoped: if a subcommand was already seen, keep it so callers
      // can print subcommand-specific usage. If no subcommand, route to 'help'.
      if (!subcommandSeen) result.subcommand = 'help';
    } else if (token === '--port' || token === '-p') {
      const val = tokens[0];
      if (val === undefined || val.startsWith('-')) {
        // Missing or invalid value — signal error via NaN so main() can catch it
        result.flags.port = NaN;
      } else {
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

function printUsage(subcommand?: ParsedArgs['subcommand']): void {
  if (subcommand === 'serve') {
    console.log(`
Usage: derek serve <models-dir> [--port <port>]

  Start the interactive server and watch the models directory for changes.

Options:
  --port <port>   Port to listen on (default: 3000)
  --help, -h      Print this message
`.trim());
    return;
  }

  if (subcommand === 'dict') {
    console.log(`
Usage: derek dict <models-dir> -o <output.html> [--theme light|dark]

  Generate a static data dictionary HTML file from the models directory.

Options:
  -o, --output <file>  Output file path (required)
  --theme light|dark   Color theme (default: dark)
  --help, -h           Print this message
`.trim());
    return;
  }

  if (subcommand === 'graph') {
    console.log(`
Usage: derek graph <models-dir> -o <output.html> [--theme light|dark]

  Generate a self-contained interactive graph HTML file.

Options:
  -o, --output <file>  Output file path (required)
  --theme light|dark   Color theme (default: dark)
  --help, -h           Print this message
`.trim());
    return;
  }

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

  if (parsed.flags.help) {
    // Route to subcommand-specific help when a real subcommand was parsed alongside --help
    const sub = parsed.subcommand !== 'help' ? parsed.subcommand : undefined;
    printUsage(sub);
    process.exit(0);
  }

  if (parsed.subcommand === 'help') {
    printUsage();
    process.exit(0);
  }

  if (isNaN(parsed.flags.port)) {
    console.error('Error: --port requires a numeric value.');
    process.exit(1);
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
      // graph: load the embedded bundle (stable index.js / index.css embedded at compile time).
      // Dynamic import so the `dict` subcommand doesn't fail if dist/static is missing in dev mode.
      let bundle;
      try {
        const { loadEmbeddedBundle } = await import('./generators/embedded-bundle');
        bundle = await loadEmbeddedBundle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          'Error: could not load the embedded React bundle.\n' +
          'Run: bun run build:bundle  (or: bun run build:cli)\n' +
          `\nUnderlying: ${msg}`,
        );
        process.exit(1);
      }
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

    // serveCommand returns { server, stop }; for the CLI we just let it run indefinitely
    serveCommand(resolvedDir, { port: parsed.flags.port });
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
