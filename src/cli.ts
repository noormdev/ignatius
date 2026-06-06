import { defineCommand, runMain } from 'citty';
import { resolve } from 'path';
import { existsSync } from 'node:fs';
import { serveWithPortFallback } from './serve-port';
import { parseModels } from './parse';
import { generateDict } from './generators/dict';
import { generateGraph } from './generators/graph';
import { pickModel } from './resolve-model';
import { VERSION } from './version';

// ──────────────────────────────────────────────────────────────────────────────
// serve
// ──────────────────────────────────────────────────────────────────────────────

const serveCmd = defineCommand({
  meta: {
    name: 'serve',
    description: 'Start the interactive server and watch the model for changes',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to search for a model root (default: cwd)',
      required: false,
    },
    port: {
      type: 'string',
      alias: 'p',
      description: 'Port to listen on (default: 3000)',
      default: '3000',
    },
    model: {
      type: 'string',
      description: 'Model key to use when multiple models are found',
    },
    open: {
      type: 'boolean',
      alias: 'o',
      description: 'Open the server in the default browser after it starts',
      default: false,
    },
  },
  async run({ args }) {
    const base = args.path ? resolve(args.path) : process.cwd();
    const port = Number(args.port);
    if (isNaN(port) || port <= 0) {
      process.stderr.write('Error: --port requires a positive numeric value.\n');
      process.exit(1);
    }

    const dir = await pickModel(base, args.model);
    const boundPort = await serveWithPortFallback(dir, port);
    if (args.open) {
      const { openBrowser } = await import('./open-browser');
      openBrowser(`http://localhost:${boundPort}`);
    }
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// dict
// ──────────────────────────────────────────────────────────────────────────────

const dictCmd = defineCommand({
  meta: {
    name: 'dict',
    description: 'Generate a static data dictionary HTML file',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to search for a model root (default: cwd)',
      required: false,
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Output file path (required)',
    },
    theme: {
      type: 'string',
      description: 'Color theme: light or dark (default: dark)',
      default: 'dark',
    },
    model: {
      type: 'string',
      description: 'Model key to use when multiple models are found',
    },
  },
  async run({ args }) {
    const outputPath = args.out;
    if (!outputPath) {
      process.stderr.write('Error: -o <output.html> is required for the dict subcommand.\n');
      process.exit(1);
    }

    const base = args.path ? resolve(args.path) : process.cwd();
    const dir = await pickModel(base, args.model);
    const mode = args.theme === 'light' ? 'light' : 'dark';
    const { model, globalErrors: parseGlobalErrors } = await parseModels(dir);
    const { validateModel, formatFindingsForStderr } = await import('./validate');
    const validation = validateModel(model);

    // Print all findings to stderr before writing output.
    const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors];
    const stderrLines = formatFindingsForStderr(allGlobalErrors, validation.entityErrors);
    for (const line of stderrLines) {
      process.stderr.write(line + '\n');
    }

    const findings = { globalErrors: allGlobalErrors, entityErrors: validation.entityErrors };
    // Use cleanedModel.nodes (safe pk/columns shapes) but keep raw edges so the
    // dict can still render dict-link-missing affordances for dangling FKs.
    const renderModel = { ...model, nodes: validation.cleanedModel.nodes };
    const html = await generateDict(renderModel, findings, mode, { modelsDir: dir });
    await Bun.write(outputPath, html);
    console.log(`Wrote dict to ${outputPath}`);
    process.exit(allGlobalErrors.length > 0 ? 1 : 0);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// graph
// ──────────────────────────────────────────────────────────────────────────────

const graphCmd = defineCommand({
  meta: {
    name: 'graph',
    description: 'Generate a self-contained interactive graph HTML file',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to search for a model root (default: cwd)',
      required: false,
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Output file path (required)',
    },
    theme: {
      type: 'string',
      description: 'Color theme: light or dark (default: dark)',
      default: 'dark',
    },
    model: {
      type: 'string',
      description: 'Model key to use when multiple models are found',
    },
  },
  async run({ args }) {
    const outputPath = args.out;
    if (!outputPath) {
      process.stderr.write('Error: -o <output.html> is required for the graph subcommand.\n');
      process.exit(1);
    }

    const base = args.path ? resolve(args.path) : process.cwd();
    const dir = await pickModel(base, args.model);
    const mode = args.theme === 'light' ? 'light' : 'dark';
    const { model, globalErrors: parseGlobalErrors } = await parseModels(dir);
    const { validateModel, formatFindingsForStderr } = await import('./validate');
    const validation = validateModel(model);

    const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors];
    const stderrLines = formatFindingsForStderr(allGlobalErrors, validation.entityErrors);
    for (const line of stderrLines) {
      process.stderr.write(line + '\n');
    }

    // Dynamic import so `dict`/`serve` work without a prior bundle build.
    let bundle;
    try {
      const { loadEmbeddedBundle } = await import('./generators/embedded-bundle');
      bundle = await loadEmbeddedBundle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        'Error: could not load the embedded React bundle.\n' +
        'Run: bun run build:bundle  (or: bun run build:cli)\n' +
        `\nUnderlying: ${msg}\n`,
      );
      process.exit(1);
    }

    const html = await generateGraph(model, mode, bundle);
    await Bun.write(outputPath, html);
    console.log(`Wrote graph to ${outputPath}`);
    process.exit(allGlobalErrors.length > 0 ? 1 : 0);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// validate
// ──────────────────────────────────────────────────────────────────────────────

const validateCmd = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate a model and report findings without generating any output',
  },
  args: {
    path: {
      type: 'positional',
      description: 'Path to search for a model root (default: cwd)',
      required: false,
    },
    model: {
      type: 'string',
      description: 'Model key to use when multiple models are found',
    },
  },
  async run({ args }) {
    const base = args.path ? resolve(args.path) : process.cwd();
    const dir = await pickModel(base, args.model);
    const { model, globalErrors: parseGlobalErrors } = await parseModels(dir);
    const { validateModel, formatFindingsForStderr, RULES } = await import('./validate');
    const validation = validateModel(model);

    const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors];

    // Flow integration: run flow validation when a flows/ directory exists.
    // Guard with existsSync so models without flows/ are unaffected (no latency).
    let flowErrors: import('./flow-validate').FlowError[] = [];
    let hasClassBFlowErrors = false;
    const flowsDir = `${dir}/flows`;
    if (existsSync(flowsDir)) {
      const { parseFlows } = await import('./flow-parse');
      const { validateFlows } = await import('./flow-validate');
      const { flowModel, globalErrors: flowParseErrors } = await parseFlows(dir);
      allGlobalErrors.push(...flowParseErrors);
      const flowConfig = model._meta?.flowRules;
      const flowValidation = validateFlows(flowModel, model, flowConfig);
      flowErrors = flowValidation.flowErrors;
      // Class B is the authoritative signal for a hard exit — derived from the rule
      // registry, not from the severity field, so the two can't silently diverge.
      hasClassBFlowErrors = flowErrors.some(e => RULES[e.ruleId].class === 'B');
    }

    const stderrLines = formatFindingsForStderr(allGlobalErrors, validation.entityErrors, flowErrors);
    for (const line of stderrLines) {
      process.stderr.write(line + '\n');
    }

    const entityCount = Object.keys(model.nodes).length;
    const noun = entityCount === 1 ? 'entity' : 'entities';
    // Include flow findings in the summary counts so the stdout line reflects all findings.
    const errorCount = allGlobalErrors.length + flowErrors.filter(e => RULES[e.ruleId].class === 'B').length;
    const warningCount = validation.entityErrors.length + flowErrors.filter(e => RULES[e.ruleId].class === 'A').length;

    if (errorCount > 0 || hasClassBFlowErrors) {
      console.log(`✗ ${dir}: ${errorCount} error(s), ${warningCount} warning(s) across ${entityCount} ${noun}.`);
    } else if (warningCount > 0 || flowErrors.length > 0) {
      console.log(`✓ ${dir}: valid with ${warningCount} warning(s) across ${entityCount} ${noun}.`);
    } else {
      console.log(`✓ ${dir}: valid — ${entityCount} ${noun}, no findings.`);
    }

    process.exit(errorCount > 0 || hasClassBFlowErrors ? 1 : 0);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// flow
// ──────────────────────────────────────────────────────────────────────────────

const flowCmd = defineCommand({
  meta: {
    name: 'flow',
    description: 'Generate a self-contained flow diagram HTML file for a named DFD',
  },
  args: {
    name: {
      type: 'positional',
      description: 'DFD folder name under flows/ to render',
      required: true,
    },
    path: {
      type: 'positional',
      description: 'Path to search for a model root (default: cwd)',
      required: false,
    },
    out: {
      type: 'string',
      description: 'Output file path (default: flow-<name>.html in cwd)',
    },
    model: {
      type: 'string',
      description: 'Model key to use when multiple models are found',
    },
  },
  async run({ args }) {
    const name = args.name;
    const base = args.path ? resolve(args.path) : process.cwd();
    const outputPath = args.out ?? `flow-${name}.html`;

    const dir = await pickModel(base, args.model);
    const { model, globalErrors: parseGlobalErrors } = await parseModels(dir);
    const { parseFlows } = await import('./flow-parse');
    const { validateFlows } = await import('./flow-validate');
    const { validateModel, formatFindingsForStderr, RULES } = await import('./validate');

    // Entity-level validation (needed for flow.unknown_store cross-checks)
    const validation = validateModel(model);

    const { flowModel, globalErrors: flowParseErrors } = await parseFlows(dir);
    const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors, ...flowParseErrors];

    // Find the requested diagram
    const diagram = flowModel.diagrams.find(d => d.id === name);
    if (!diagram) {
      process.stderr.write(`Error: DFD '${name}' not found under ${dir}/flows/.\n`);
      process.stderr.write(
        flowModel.diagrams.length > 0
          ? `Available: ${flowModel.diagrams.map(d => d.id).join(', ')}\n`
          : `No DFDs found under ${dir}/flows/\n`,
      );
      process.exit(1);
    }

    const flowConfig = model._meta?.flowRules;
    const flowValidation = validateFlows(flowModel, model, flowConfig);
    const flowErrors = flowValidation.flowErrors;
    // Class B is the authoritative signal for a hard exit — derived from the rule
    // registry, not from the severity field, so the two can't silently diverge.
    const hasClassBFlowErrors = flowErrors.some(e => RULES[e.ruleId].class === 'B');

    const stderrLines = formatFindingsForStderr(allGlobalErrors, validation.entityErrors, flowErrors);
    for (const line of stderrLines) {
      process.stderr.write(line + '\n');
    }

    // Load the embedded React bundle — same pattern as graphCmd
    let bundle;
    try {
      const { loadEmbeddedBundle } = await import('./generators/embedded-bundle');
      bundle = await loadEmbeddedBundle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        'Error: could not load the embedded React bundle.\n' +
        'Run: bun run build:bundle  (or: bun run build:cli)\n' +
        `\nUnderlying: ${msg}\n`,
      );
      process.exit(1);
    }

    const { generateFlowGraph } = await import('./generators/flow-graph');
    const { layoutFlowFingerprint } = await import('./flow-fingerprint');
    const flowLayoutKey = layoutFlowFingerprint(diagram);
    const html = await generateFlowGraph(diagram, model, 'static', { flowLayoutKey }, bundle);
    await Bun.write(outputPath, html);
    console.log(`Wrote flow diagram to ${outputPath}`);
    process.exit(allGlobalErrors.length > 0 || hasClassBFlowErrors ? 1 : 0);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// version
// ──────────────────────────────────────────────────────────────────────────────

const versionCmd = defineCommand({
  meta: {
    name: 'version',
    description: 'Print the installed ignatius version',
  },
  run() {
    console.log(VERSION);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// update
// ──────────────────────────────────────────────────────────────────────────────

const updateCmd = defineCommand({
  meta: {
    name: 'update',
    description: 'Check for a newer ignatius release and install it',
  },
  args: {
    check: {
      type: 'boolean',
      description: 'Only check whether an update is available; do not install',
      default: false,
    },
    yes: {
      type: 'boolean',
      alias: 'y',
      description: 'Install without the confirmation prompt',
      default: false,
    },
  },
  async run({ args }) {
    const { runUpdateCommand } = await import('./update');
    const code = await runUpdateCommand({ check: args.check, yes: args.yes });
    process.exit(code);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────────

const main = defineCommand({
  meta: {
    name: 'ignatius',
    version: VERSION,
    description: 'DB model viewer — generate data dictionaries and graph diagrams from markdown ERDs',
  },
  subCommands: {
    serve: serveCmd,
    server: serveCmd, // alias — `serve` is easy to mistype
    dict: dictCmd,
    graph: graphCmd,
    validate: validateCmd,
    flow: flowCmd,
    version: versionCmd,
    update: updateCmd,
  },
});

runMain(main);
