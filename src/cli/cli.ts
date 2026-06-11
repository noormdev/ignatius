import { defineCommand, runMain } from 'citty';
import { resolve } from 'path';
import { existsSync } from 'node:fs';
import { serveWithPortFallback } from './serve-port';
import { parseModels } from '../model/parse';
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
// dict  (removed — stub prints a helpful pointer)
// ──────────────────────────────────────────────────────────────────────────────

const dictCmd = defineCommand({
  meta: {
    name: 'dict',
    description: 'Removed — use: ignatius export -o model.html',
  },
  run() {
    process.stderr.write('dict was removed — use: ignatius export -o model.html\n');
    process.exit(1);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// graph  (removed — stub prints a helpful pointer)
// ──────────────────────────────────────────────────────────────────────────────

const graphCmd = defineCommand({
  meta: {
    name: 'graph',
    description: 'Removed — use: ignatius export -o model.html',
  },
  run() {
    process.stderr.write('graph was removed — use: ignatius export -o model.html\n');
    process.exit(1);
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
    const { validateModel, formatFindingsForStderr, RULES } = await import('../model/validate');
    const validation = validateModel(model);

    const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors];

    // Flow integration: run flow validation when a flows/ directory exists.
    // Guard with existsSync so models without flows/ are unaffected (no latency).
    let flowErrors: import('../flows/flow-validate').FlowError[] = [];
    let hasClassBFlowErrors = false;
    const flowsDir = `${dir}/flows`;
    if (existsSync(flowsDir)) {
      const { parseFlows } = await import('../flows/flow-parse');
      const { validateFlows } = await import('../flows/flow-validate');
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
// flow  (removed — stub prints a helpful pointer)
// ──────────────────────────────────────────────────────────────────────────────

const flowCmd = defineCommand({
  meta: {
    name: 'flow',
    description: 'Removed — use: ignatius export -o model.html',
  },
  run() {
    process.stderr.write('flow was removed — use: ignatius export -o model.html\n');
    process.exit(1);
  },
});

// ──────────────────────────────────────────────────────────────────────────────
// export  — unified single-file export (graph + dict + flows in one HTML)
// ──────────────────────────────────────────────────────────────────────────────

const exportCmd = defineCommand({
  meta: {
    name: 'export',
    description: 'Export a self-contained HTML file with all three views (Graph, Dictionary, Flows)',
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
      process.stderr.write('Error: -o <output.html> is required for the export subcommand.\n');
      process.exit(1);
    }

    const base = args.path ? resolve(args.path) : process.cwd();
    const dir = await pickModel(base, args.model);
    const mode = args.theme === 'light' ? 'light' : 'dark';

    // Parse entity model.
    const { model, globalErrors: parseGlobalErrors } = await parseModels(dir);
    const { validateModel, formatFindingsForStderr, RULES } = await import('../model/validate');
    const validation = validateModel(model);
    const allGlobalErrors = [...parseGlobalErrors, ...validation.globalErrors];

    // Parse and validate flows when a flows/ directory exists.
    let flowModel: import('../flows/flow-parse').FlowModel | null = null;
    let flowErrors: import('../flows/flow-validate').FlowError[] = [];
    let hasClassBFlowErrors = false;
    const flowsDir = `${dir}/flows`;
    if (existsSync(flowsDir)) {
      const { parseFlows } = await import('../flows/flow-parse');
      const { validateFlows } = await import('../flows/flow-validate');
      const parsed = await parseFlows(dir);
      allGlobalErrors.push(...parsed.globalErrors);
      flowModel = parsed.flowModel;
      const flowConfig = model._meta?.flowRules;
      const flowValidation = validateFlows(flowModel, model, flowConfig);
      flowErrors = flowValidation.flowErrors;
      // Class B is the authoritative exit signal — derived from the rule registry,
      // not from the severity field, so the two cannot silently diverge.
      hasClassBFlowErrors = flowErrors.some(e => RULES[e.ruleId].class === 'B');
    }

    // Print all findings to stderr before writing output.
    const stderrLines = formatFindingsForStderr(allGlobalErrors, validation.entityErrors, flowErrors);
    for (const line of stderrLines) {
      process.stderr.write(line + '\n');
    }

    // Load the embedded React bundle.
    let bundle: import('../generators/embedded-bundle').BundleContent;
    try {
      const { loadEmbeddedBundle } = await import('../generators/embedded-bundle');
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

    const { generateApp } = await import('../generators/app');
    const html = await generateApp(model, flowModel, bundle, { themeMode: mode });
    await Bun.write(outputPath, html);
    console.log(`Wrote export to ${outputPath}`);

    // Exit 1 when any entity global/Class-B OR flow Class-B errors are present.
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
    export: exportCmd,
    version: versionCmd,
    update: updateCmd,
  },
});

runMain(main);
