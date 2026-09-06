/**
 * agents.ts — `AGENTS.md` / `CLAUDE.md` shim / `SKILL.md` content, written
 * into the model root only. Every file carries no entity, column, or
 * relationship content: name, description, the router filename, the
 * key-style convention, the `[[Entity]]` body rule, and the root digest are
 * the only payload, so adding entities never touches these files beyond a
 * count and a digest.
 *
 * `AGENTS.md` and the `CLAUDE.md` shim are entirely region-owned, via
 * `replaceRegion`. `SKILL.md` is the one exception (spec SC12): the harness
 * needs `name`/`description` frontmatter to discover the skill, so the
 * generator owns that block directly and puts everything else in a region.
 */

import { stringify as stringifyYaml } from 'yaml';
import type { Model, ModelEdge, ModelNode } from '../model/parse';
import { replaceRegion } from './region';

export type KeyStyle = 'key-inherited' | 'orm-oriented' | 'mixed' | 'undetermined';

/**
 * A model's roots (entities nothing else migrates a key from, and nothing
 * else declares as its parent) always carry a plain surrogate PK, even in an
 * otherwise pure key-inherited model — `Party` in `models/key-inherited` is
 * exactly this. So a single root or two is noise, not a second convention;
 * `MIXED_SHARE_THRESHOLD` is the point past which the minority signature is
 * common enough to call the model genuinely mixed rather than pure-with-roots.
 */
const MIXED_SHARE_THRESHOLD = 0.2;

/**
 * Derived from PK shape, not from `ModelEdge.identifying` alone: a
 * non-identifying edge into a reference/catalog table (a line item pointing
 * at its `Product`) is normal in a healthy key-inherited model, so an
 * entity's outgoing edges being non-identifying doesn't by itself mean
 * "surrogate" — every real key-inherited model has a mix of both. What does
 * discriminate is PK shape, checked structurally rather than by column name:
 * a composite PK is always the parent's key columns migrated in. A
 * single-column PK is a migrated key only if that entity is the source of an
 * identifying edge (its own PK column was contributed by a parent); a
 * single-column PK on an entity that sources no identifying edge is a
 * surrogate, whatever the column is named — `id`, `artifact_id`, `code`, or
 * anything else a real schema's naming convention produces. Classifier/lookup
 * entities (`reference: true`) are excluded outright: an enum table's PK
 * shape says nothing about how the model's real entities key themselves.
 */
export function deriveKeyStyle(nodes: ModelNode[], edges: ModelEdge[]): KeyStyle {
  if (nodes.length === 0) return 'undetermined';
  const identifyingSources = new Set(edges.filter(e => e.identifying).map(e => e.source));
  const relevant = nodes.filter(n => n.classification !== 'Classifier');
  const compositeCount = relevant.filter(n => n.pk.length > 1).length;
  const singlePkNodes = relevant.filter(n => n.pk.length === 1);
  const migratedSingleCount = singlePkNodes.filter(n => identifyingSources.has(n.id)).length;
  const surrogateCount = singlePkNodes.length - migratedSingleCount;
  const keyInheritedCount = compositeCount + migratedSingleCount;
  const total = keyInheritedCount + surrogateCount;
  if (total === 0) return 'undetermined';
  const minorityShare = Math.min(keyInheritedCount, surrogateCount) / total;
  if (minorityShare >= MIXED_SHARE_THRESHOLD) return 'mixed';
  return surrogateCount > keyInheritedCount ? 'orm-oriented' : 'key-inherited';
}

function keyStyleSentence(style: KeyStyle): string {
  switch (style) {
    case 'key-inherited':
      return 'key-inherited. A child entity carries its parent\'s key columns inside its own primary key.';
    case 'orm-oriented':
      return 'orm-oriented. Entities use a surrogate `id` primary key, with foreign keys held outside the primary key.';
    case 'mixed':
      return 'mixed. Some entities carry a parent-inherited primary key and others carry a surrogate primary key with foreign keys held outside it, so no single convention holds here. Check each entity\'s `pk:` before assuming one.';
    case 'undetermined':
      return 'not determinable. This model declares no relationships to derive a convention from.';
  }
}

export function buildAgentsGuide(model: Model, indexFile: string, keyStyle: KeyStyle, rootDigest: string): string {
  const name = model._meta?.name ?? 'This model';
  const description = model._meta?.desc;
  const lines = [
    `# ${name}`,
    '',
    ...(description ? [description, ''] : []),
    '## Walking this model',
    '',
    `Start at [${indexFile}](${indexFile}). Every router lists its folder's`,
    'children by name, kind, description, and a link. A row whose Kind is',
    '`folder` leads to another router; any other Kind is a leaf with real',
    'content: an entity, a flow process, an external, or a store.',
    '',
    '## Conventions',
    '',
    `- Key style: ${keyStyleSentence(keyStyle)}`,
    '- `[[Entity]]` inside a body is a cross-reference to another entity file.',
    "  It is not a router link, and it resolves only in the app's viewer.",
    '',
    '## Currency',
    '',
    'This guide and the routers were generated together. Root router digest:',
    `\`${rootDigest}\`. Run \`ignatius validate --index\` to check whether the`,
    'model has drifted since.',
  ];
  return lines.join('\n');
}

export function buildClaudeShim(): string {
  return [
    '@AGENTS.md',
    '',
    'This folder is a data model, generated by ignatius. Read AGENTS.md',
    'before editing anything under it.',
  ].join('\n');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'model';
}

export function buildSkillMeta(model: Model): { name: string; description: string } {
  const modelName = model._meta?.name ?? 'Model';
  const groupNames = Object.keys(model.groups).sort();
  const entityCount = model.nodes.length;
  const groupList = groupNames.length > 0 ? ` (${groupNames.join(', ')})` : '';
  const description =
    `Data model for ${modelName}: ${entityCount} ${entityCount === 1 ? 'entity' : 'entities'} ` +
    `across ${groupNames.length} group${groupNames.length === 1 ? '' : 's'}${groupList}. ` +
    `Use when asked about ${modelName}'s schema, entities, or data flows.`;
  return { name: slugify(modelName), description };
}

export function buildSkillBody(indexFile: string): string {
  return [
    '# Model skill',
    '',
    'See [AGENTS.md](AGENTS.md) for how to walk this model, starting at',
    `[${indexFile}](${indexFile}).`,
  ].join('\n');
}

async function readIfExists(path: string): Promise<string> {
  return (await Bun.file(path).exists()) ? await Bun.file(path).text() : '';
}

/** Splits a file into its `---`-delimited YAML frontmatter block (if any) and the remaining body. */
function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match[0], body: content.slice(match[0].length) };
}

/**
 * Writes `AGENTS.md`, `SKILL.md`, and, when `writeClaude`, the `CLAUDE.md`
 * shim into `root` only. Each write is region-scoped: existing bytes outside
 * the generator's own region (a hand-written `CLAUDE.md`'s prose, for
 * instance) survive verbatim.
 */
export async function writeGuidance(root: string, model: Model, rootDigest: string, writeClaude: boolean): Promise<void> {
  const indexFile = model._meta?.indexFile ?? 'index.md';
  const keyStyle = deriveKeyStyle(model.nodes, model.edges);

  const withPathPrefix = <T>(relPath: string, fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`${relPath}: ${message}`);
    }
  };

  const agentsPath = `${root}/AGENTS.md`;
  const agentsExisting = await readIfExists(agentsPath);
  const guide = buildAgentsGuide(model, indexFile, keyStyle, rootDigest);
  await Bun.write(agentsPath, withPathPrefix('AGENTS.md', () => replaceRegion(agentsExisting, 'ignatius-guide', {}, guide)));

  const skillPath = `${root}/SKILL.md`;
  const skillExisting = await readIfExists(skillPath);
  const { body: skillBodyExisting } = splitFrontmatter(skillExisting);
  const normalizedBody = skillBodyExisting.replace(/^(\r?\n)+/, '');
  const { name, description } = buildSkillMeta(model);
  const frontmatter = stringifyYaml({ name, description }).trimEnd();
  const skillBody = withPathPrefix('SKILL.md', () => replaceRegion(normalizedBody, 'ignatius-skill', {}, buildSkillBody(indexFile)));
  await Bun.write(skillPath, `---\n${frontmatter}\n---\n\n${skillBody}`);

  if (!writeClaude) return;
  const claudePath = `${root}/CLAUDE.md`;
  const claudeExisting = await readIfExists(claudePath);
  const shim = buildClaudeShim();
  await Bun.write(claudePath, withPathPrefix('CLAUDE.md', () => replaceRegion(claudeExisting, 'ignatius-claude-shim', {}, shim)));
}
