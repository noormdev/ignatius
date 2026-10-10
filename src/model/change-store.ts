import { join } from 'path';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { parseModels, type Model } from './parse';
import { parseFlows } from '../flows/flow-parse';
import { crossCheck, diffSnapshots, parseChangeNote, type ChangeReview, type ModelSnapshot } from './change-review';

const IGNATIUS_DIR = '.ignatius';

export function baselinePath(modelDir: string): string {
  return join(modelDir, IGNATIUS_DIR, 'baseline.json');
}

function changesDir(modelDir: string): string {
  return join(modelDir, IGNATIUS_DIR, 'changes');
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

/** Ensure `<model>/.gitignore` lists `.ignatius/`, creating the file or appending the line as needed. */
export async function ensureGitignore(modelDir: string): Promise<void> {
  const path = join(modelDir, '.gitignore');
  let text = '';
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  if (text.split(/\r?\n/).some(line => /^\/?\.ignatius\/?$/.test(line.trim()))) return;
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  await appendFile(path, `${separator}${IGNATIUS_DIR}/\n`);
}

function isSnapshot(value: unknown): value is ModelSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  return 'version' in value && value.version === 1
    && 'model' in value && typeof value.model === 'object' && value.model !== null
    && 'flows' in value && Array.isArray(value.flows);
}

/** The stored baseline, or null when it is missing, unparseable, or the wrong shape so callers rebuild it. */
async function readBaseline(modelDir: string): Promise<ModelSnapshot | null> {
  let text: string;
  try {
    text = await readFile(baselinePath(modelDir), 'utf8');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isSnapshot(parsed) ? parsed : null;
}

async function writeBaseline(modelDir: string, snapshot: ModelSnapshot): Promise<void> {
  await mkdir(join(modelDir, IGNATIUS_DIR), { recursive: true });
  await ensureGitignore(modelDir);
  const path = baselinePath(modelDir);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot));
  await rename(temp, path);
}

async function currentSnapshot(modelDir: string, model?: Model): Promise<ModelSnapshot> {
  const parsedModel = model ?? (await parseModels(modelDir)).model;
  const { flowModel } = await parseFlows(modelDir);
  return { version: 1, model: parsedModel, flows: flowModel.diagrams };
}

// Serve creates the baseline at startup while the first /api/model request may
// find it missing too; without sharing one read-and-write, both append to .gitignore.
const pendingBaselines = new Map<string, Promise<ModelSnapshot>>();

/** The stored baseline, written from the current parse when no valid one is stored. */
export async function ensureBaseline(modelDir: string, current?: ModelSnapshot): Promise<ModelSnapshot> {
  const pending = pendingBaselines.get(modelDir);
  if (pending) return pending;
  const loading = (async () => {
    const stored = await readBaseline(modelDir);
    if (stored) return stored;
    const snapshot = current ?? (await currentSnapshot(modelDir));
    await writeBaseline(modelDir, snapshot);
    return snapshot;
  })().finally(() => pendingBaselines.delete(modelDir));
  pendingBaselines.set(modelDir, loading);
  return loading;
}

async function noteFiles(modelDir: string): Promise<string[]> {
  try {
    const entries = await readdir(changesDir(modelDir), { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

async function loadNotes(modelDir: string): Promise<ReturnType<typeof parseChangeNote>[]> {
  const files = (await noteFiles(modelDir)).filter(file => file.endsWith('.md'));
  return Promise.all(files.map(async file => parseChangeNote(file, await readFile(join(changesDir(modelDir), file), 'utf8'))));
}

/** The change review of the current parse against the baseline, writing the baseline first if absent. */
export async function buildReview(modelDir: string, model?: Model): Promise<ChangeReview> {
  const current = await currentSnapshot(modelDir, model);
  const baseline = await ensureBaseline(modelDir, current);
  return crossCheck(diffSnapshots(baseline, current), await loadNotes(modelDir), baseline.model);
}

/** Accept the current parse as the baseline and delete every change note. */
export async function approve(modelDir: string): Promise<{ items: number; notes: number }> {
  const current = await currentSnapshot(modelDir);
  const baseline = await readBaseline(modelDir);
  const items = baseline ? diffSnapshots(baseline, current).length : 0;
  const files = await noteFiles(modelDir);
  await Promise.all(files.map(file => rm(join(changesDir(modelDir), file))));
  await writeBaseline(modelDir, current);
  return { items, notes: files.filter(file => file.endsWith('.md')).length };
}
