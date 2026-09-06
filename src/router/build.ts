/**
 * build.ts — model + parsed flow tree in, RouterFile[] out.
 *
 * The `data/` tree mirrors each entity's resolved `sourcePath` on disk,
 * never the declared `group:` field (SC5a) — see `buildDataTree`. `flows/`
 * mirrors `flowModel.diagrams` (recursive `subDfds`). No separate filesystem
 * walk carries any information these two structures don't already have.
 *
 * The one read this module performs is `hashFile` on each leaf's bytes, since
 * a row's fingerprint (spec SC7) has to be real content, not derived state.
 * It never writes — `write.ts` owns every byte on disk.
 */

import type { Model, ModelNode } from '../model/parse';
import type { FlowDiagram, FlowModel, FlowStoreRef } from '../flows/flow-parse';
import { hashFile, folderDigest, type RouterNode } from './fingerprint';

export type RouterFile = {
  /** Path to the router file, relative to the model root, e.g. `data/identity/index.md`. */
  relPath: string;
  /** The `↑` line above the region, or `''` for the root file (no ancestors). */
  breadcrumb: string;
  attrs: { scope: string; path: string; count: string; depth: string; digest: string };
  table: string;
  /** This folder's own digest — the value the parent row for this folder carries. */
  digest: string;
};

type Ancestor = { label: string };

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countProcesses(diagrams: FlowDiagram[]): number {
  return diagrams.reduce((sum, d) => sum + d.processes.length + countProcesses(d.subDfds), 0);
}

function breadcrumbFor(ancestors: Ancestor[], indexFile: string): string {
  if (ancestors.length === 0) return '';
  const parts = ancestors.map((a, i) => `[${a.label}](${'../'.repeat(i + 1)}${indexFile})`);
  return `↑ ${parts.join(' · ')}`;
}

function renderTable(rows: RouterNode[]): string {
  const lines = [
    '| Name | Kind | Description | Go |',
    '|---|---|---|---|',
    ...rows.map(r => `| ${r.name} | ${r.kind} | ${r.description} | [${r.name}](${r.link}) |`),
  ];
  return lines.join('\n');
}

function toRouterFile(
  relDir: string,
  scope: string,
  depth: number,
  ancestors: Ancestor[],
  indexFile: string,
  rows: RouterNode[],
  prose?: string,
): RouterFile {
  const digest = folderDigest(rows.map(r => r.hash));
  return {
    relPath: `${relDir}/${indexFile}`.replace(/^\//, ''),
    breadcrumb: breadcrumbFor(ancestors, indexFile),
    attrs: { scope, path: relDir === '' ? '.' : relDir, count: String(rows.length), depth: String(depth), digest },
    table: prose ? `${prose}\n\n${renderTable(rows)}` : renderTable(rows),
    digest,
  };
}

/** A router row whose target could not be read for hashing — reported so `validate --index` doesn't treat a broken reference as a clean, unchanging digest. */
export type UnreadableTarget = { path: string; message: string };

function hasCode(err: unknown): err is { code: unknown } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * `hashFile` can throw when a model references a file that's since gone
 * missing or unreadable on disk; a router still has to write rather than
 * crash on that (SC5a). Every failure is recorded in `unreadable` with the
 * real error message rather than silently coerced to a stable sentinel — a
 * fixed fake digest would make `validate --index` treat a broken row as
 * permanently up to date. Only OS-level read failures are caught; anything
 * else propagates.
 */
async function safeHashFile(path: string, unreadable: UnreadableTarget[]): Promise<string> {
  try {
    return await hashFile(path);
  } catch (err) {
    if (!hasCode(err)) throw err;
    unreadable.push({ path, message: err instanceof Error ? err.message : String(err.code) });
    return 'sha256:unreadable';
  }
}

/** An entity paired with its confirmed, resolved sourcePath (never undefined). */
type PlacedNode = { node: ModelNode; sourcePath: string };

/** Mirrors the directories under `data/` an entity's sourcePath actually passes through — never the declared `group:` field. */
type DataDirNode = { entities: PlacedNode[]; children: Map<string, DataDirNode> };

function buildDataTree(nodes: ModelNode[]): DataDirNode {
  const root: DataDirNode = { entities: [], children: new Map() };
  for (const node of nodes) {
    const sourcePath = node.sourcePath;
    if (sourcePath === undefined) continue;
    const segments = sourcePath.replace(/^data\//, '').split('/');
    segments.pop();
    let dir = root;
    for (const segment of segments) {
      let child = dir.children.get(segment);
      if (!child) {
        child = { entities: [], children: new Map() };
        dir.children.set(segment, child);
      }
      dir = child;
    }
    dir.entities.push({ node, sourcePath });
  }
  return root;
}

async function buildDataFolder(
  root: string,
  dirNode: DataDirNode,
  relDir: string,
  scope: string,
  depth: number,
  ancestors: Ancestor[],
  ownLabel: string,
  indexFile: string,
  model: Model,
  out: RouterFile[],
  unreadable: UnreadableTarget[],
): Promise<RouterFile> {
  const rows: RouterNode[] = [];

  for (const dirName of [...dirNode.children.keys()].sort()) {
    const child = dirNode.children.get(dirName)!;
    const childLabel = model.groups[dirName]?.label ?? dirName;
    const childFile = await buildDataFolder(
      root,
      child,
      `${relDir}/${dirName}`,
      'entity-group',
      depth + 1,
      [{ label: ownLabel }, ...ancestors],
      childLabel,
      indexFile,
      model,
      out,
      unreadable,
    );
    rows.push({
      name: dirName,
      kind: 'folder',
      description: model.groups[dirName]?.description ?? '',
      link: `${dirName}/${indexFile}`,
      hash: childFile.digest,
    });
  }

  for (const { node, sourcePath } of [...dirNode.entities].sort((a, b) => a.node.id.localeCompare(b.node.id))) {
    const filename = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
    rows.push({
      name: node.id,
      kind: node.classification,
      description: node.description ?? '',
      link: filename,
      hash: await safeHashFile(`${root}/${sourcePath}`, unreadable),
    });
  }

  const file = toRouterFile(relDir, scope, depth, ancestors, indexFile, rows);
  out.push(file);
  return file;
}

function collectStoreRefs(diagram: FlowDiagram, out: Map<string, FlowStoreRef>): void {
  for (const ref of diagram.storeRefs) {
    if (!out.has(ref.name)) out.set(ref.name, ref);
  }
  for (const sub of diagram.subDfds) collectStoreRefs(sub, out);
}

async function buildFlowFolder(
  root: string,
  diagram: FlowDiagram,
  relDir: string,
  depth: number,
  ancestors: Ancestor[],
  indexFile: string,
  out: RouterFile[],
  unreadable: UnreadableTarget[],
): Promise<RouterNode> {
  const rows: RouterNode[] = [];

  for (const process of diagram.processes) {
    const link = `${process.id}.md`;
    rows.push({
      name: process.id,
      kind: 'process',
      description: process.description ?? '',
      link,
      hash: await safeHashFile(`${root}/${relDir}/${link}`, unreadable),
    });

    if (process.hasSubDfd) {
      const subDiagram = diagram.subDfds.find(d => d.id === process.id);
      if (subDiagram) {
        const subRow = await buildFlowFolder(
          root,
          subDiagram,
          `${relDir}/${process.id}`,
          depth + 1,
          [{ label: diagram.title }, ...ancestors],
          indexFile,
          out,
          unreadable,
        );
        rows.push(subRow);
      }
    }
  }

  const file = toRouterFile(relDir, 'flow-diagram', depth, ancestors, indexFile, rows);
  out.push(file);

  return { name: diagram.id, kind: 'folder', description: '', link: `${diagram.id}/${indexFile}`, hash: file.digest };
}

export async function buildRouters(
  root: string,
  model: Model,
  flowModel: FlowModel,
  unreadable: UnreadableTarget[] = [],
): Promise<RouterFile[]> {
  const indexFile = model._meta?.indexFile ?? 'index.md';
  const rootLabel = model._meta?.name ?? 'Model';
  const files: RouterFile[] = [];

  // groups/
  const groupNames = Object.keys(model.groups).sort();
  const groupRows: RouterNode[] = [];
  for (const name of groupNames) {
    const link = `${name}.md`;
    groupRows.push({
      name,
      kind: 'group',
      description: model.groups[name]?.description ?? '',
      link,
      hash: await safeHashFile(`${root}/groups/${link}`, unreadable),
    });
  }
  const groupsFile = toRouterFile('groups', 'groups', 1, [{ label: rootLabel }], indexFile, groupRows);
  files.push(groupsFile);

  // data/, mirroring the filesystem an entity's sourcePath actually walks
  const dataTree = buildDataTree(model.nodes);
  const dataFile = await buildDataFolder(root, dataTree, 'data', 'data', 1, [{ label: rootLabel }], 'Data', indexFile, model, files, unreadable);

  // flows/ and each flow/sub-DFD folder. `parseFlows` wraps the real,
  // on-disk top-level diagrams two levels deep — a synthetic context
  // diagram, then a synthetic L1 overview — for the flow *viewer*'s
  // drill-down (`flow-derive-levels.ts`). Neither synthetic diagram has a
  // folder on disk; the router walks their grandchildren, the actual
  // `flows/<id>/` diagrams the parser read from files.
  const topLevelDiagrams = flowModel.diagrams[0]?.subDfds[0]?.subDfds ?? [];
  const flowsRows: RouterNode[] = [];
  for (const diagram of topLevelDiagrams) {
    const row = await buildFlowFolder(root, diagram, `flows/${diagram.id}`, 2, [{ label: 'Flows' }, { label: rootLabel }], indexFile, files, unreadable);
    flowsRows.push(row);
  }
  const flowsFile = toRouterFile('flows', 'flows', 1, [{ label: rootLabel }], indexFile, flowsRows);
  files.push(flowsFile);

  // externals/ — the full root registry, not just flows-referenced externals
  const externalRows: RouterNode[] = [];
  for (const ext of [...flowModel.externals].sort((a, b) => a.id.localeCompare(b.id))) {
    const link = `${ext.id}.md`;
    externalRows.push({
      name: ext.id,
      kind: 'external',
      description: ext.description ?? '',
      link,
      hash: await safeHashFile(`${root}/externals/${link}`, unreadable),
    });
  }
  const externalsFile = toRouterFile('externals', 'externals', 1, [{ label: rootLabel }], indexFile, externalRows);
  files.push(externalsFile);

  // stores/ — a FlowStoreRef also covers `db:<Entity>` tokens (real entities,
  // already routed under data/) and undefined store tokens the validator
  // flags separately. Only a ref with a `body` was actually read from a
  // stores/*.md file, so that's the filter for "this row belongs here".
  const storeRefs = new Map<string, FlowStoreRef>();
  for (const diagram of flowModel.diagrams) collectStoreRefs(diagram, storeRefs);
  const fileBackedStoreRefs = [...storeRefs.values()].filter(ref => ref.body !== undefined);
  const storeRows: RouterNode[] = [];
  for (const ref of fileBackedStoreRefs.sort((a, b) => a.name.localeCompare(b.name))) {
    const link = `${ref.name}.md`;
    storeRows.push({
      name: ref.name,
      kind: 'store',
      description: ref.description ?? '',
      link,
      hash: await safeHashFile(`${root}/stores/${link}`, unreadable),
    });
  }
  const storesFile = toRouterFile('stores', 'stores', 1, [{ label: rootLabel }], indexFile, storeRows);
  files.push(storesFile);

  // root — the five sections are fixed by the folder-model spec, so their
  // meaning is the same in every model; only the counts are model-specific.
  const rootRows: RouterNode[] = [
    {
      name: 'Groups',
      kind: 'folder',
      description: `The subject-area registry that labels and colors entities. ${pluralize(groupNames.length, 'group')}.`,
      link: `groups/${indexFile}`,
      hash: groupsFile.digest,
    },
    {
      name: 'Data',
      kind: 'folder',
      description: `The entity model. ${pluralize(model.nodes.length, 'entity', 'entities')} across ${pluralize(groupNames.length, 'group')}.`,
      link: `data/${indexFile}`,
      hash: dataFile.digest,
    },
    {
      name: 'Flows',
      kind: 'folder',
      description: `Data flow diagrams. ${pluralize(topLevelDiagrams.length, 'flow')}, ${pluralize(countProcesses(topLevelDiagrams), 'process', 'processes')}.`,
      link: `flows/${indexFile}`,
      hash: flowsFile.digest,
    },
    {
      name: 'Externals',
      kind: 'folder',
      description: `Actors outside the system boundary that DFDs exchange data with. ${pluralize(flowModel.externals.length, 'external')}.`,
      link: `externals/${indexFile}`,
      hash: externalsFile.digest,
    },
    {
      name: 'Stores',
      kind: 'folder',
      description: `Non-database stores DFDs read and write. ${pluralize(fileBackedStoreRefs.length, 'store')}.`,
      link: `stores/${indexFile}`,
      hash: storesFile.digest,
    },
  ];
  const rootFile = toRouterFile('', 'root', 0, [], indexFile, rootRows, model._meta?.desc);
  files.push(rootFile);

  return files;
}
