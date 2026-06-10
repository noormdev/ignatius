/**
 * Synthetic model generator for perf testing.
 *
 * Writes a valid ignatius model into tmp/synthetic-model-<n>/ with:
 *   - ignatius.yml + a few _groups/*.md
 *   - ~n entity files spread across groups (realistic IDEF1X structure)
 *   - FK relationships wiring entities into a connected graph (~1.4–1.8× edges per node)
 *   - ≥2 subtype clusters (basetype + members) to exercise compound-parent layout
 *
 * Usage:
 *   bun scripts/gen-synthetic-model.ts [--n 300] [--out tmp/my-model]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'path';

// ── CLI args ──────────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dir, '..');

function argValue(flag: string, def: string): string {
  const i = process.argv.indexOf(flag);
  const next = process.argv[i + 1];
  return i >= 0 && next !== undefined ? next : def;
}

const N = parseInt(argValue('--n', '300'), 10);
const OUT = resolve(argValue('--out', join(ROOT, `tmp/synthetic-model-${N}`)));

// ── Domain model ─────────────────────────────────────────────────────────────

const GROUPS: Array<{ id: string; label: string; color: string; desc: string }> = [
  { id: 'core',       label: 'Core',          color: '#2ea043', desc: 'Foundational entities shared across domains.' },
  { id: 'catalog',    label: 'Catalog',        color: '#1f6feb', desc: 'Products, variants, and pricing.' },
  { id: 'sales',      label: 'Sales',          color: '#a371f7', desc: 'Orders, line items, and fulfillment.' },
  { id: 'finance',    label: 'Finance',        color: '#f78166', desc: 'Invoices, payments, and allocations.' },
  { id: 'ops',        label: 'Operations',     color: '#ffa657', desc: 'Warehousing, stock, and logistics.' },
  { id: 'reporting',  label: 'Reporting',      color: '#6e7681', desc: 'Denormalized reporting aggregates.' },
];

// Each group gets an approximate share of the total N entities.
// Weights sum to 1; reporting is small to simulate a thin read layer.
const GROUP_WEIGHTS = [0.18, 0.20, 0.22, 0.18, 0.16, 0.06];

// Subtype cluster definitions. Each cluster gets one basetype entity and 2+ member entities.
// All members share the basetype PK (key-inherited pattern).
const CLUSTERS = [
  {
    id: 'Party',
    group: 'core',
    desc: 'Any person or organization the business interacts with.',
    members: ['Person', 'Organization'],
  },
  {
    id: 'Product',
    group: 'catalog',
    desc: 'Any sellable item — physical good or digital service.',
    members: ['PhysicalProduct', 'DigitalProduct'],
  },
  {
    id: 'Channel',
    group: 'sales',
    desc: 'The channel through which a sale originates.',
    members: ['WebChannel', 'PartnerChannel'],
  },
];

// ── Entity name generation ────────────────────────────────────────────────────

// Roots to combine into entity names per group
const ROOTS: Record<string, string[]> = {
  core:      ['Address', 'Contact', 'Country', 'Currency', 'Language', 'Locale',
               'Region', 'TimeZone', 'Tag', 'Classification', 'Status', 'EventLog',
               'AuditTrail', 'Setting', 'Config', 'Permission', 'Role', 'User',
               'Tenant', 'Department', 'Team', 'Metric'],
  catalog:   ['Category', 'Brand', 'Supplier', 'Variant', 'Attribute', 'AttributeValue',
               'PriceList', 'Price', 'Discount', 'Bundle', 'Component', 'Image',
               'Media', 'Tag', 'Review', 'Rating', 'Spec', 'Feature'],
  sales:     ['Quote', 'Opportunity', 'Lead', 'Account', 'Contract', 'Shipment',
               'ShipmentItem', 'Carrier', 'TrackingEvent', 'ReturnRequest', 'ReturnItem',
               'Coupon', 'Promotion', 'Voucher', 'Refund', 'Adjustment'],
  finance:   ['Invoice', 'InvoiceLine', 'CreditNote', 'CreditNoteLine', 'PaymentTerm',
               'TaxRate', 'TaxLine', 'CurrencyRate', 'Ledger', 'LedgerEntry',
               'CostCenter', 'Budget', 'BudgetLine', 'Reconciliation'],
  ops:       ['Warehouse', 'Location', 'Bin', 'StockMove', 'Inventory',
               'InventoryItem', 'PurchaseOrder', 'PurchaseOrderLine', 'Receipt',
               'ReceiptLine', 'Vendor', 'VendorContact', 'QualityCheck', 'Lot'],
  reporting: ['SalesSummary', 'RevenueSummary', 'StockSummary', 'CustomerLifetimeValue',
               'ProductPerformance', 'CohortReport'],
};

function entityName(group: string, idx: number): string {
  const roots = ROOTS[group] ?? ['Entity'];
  if (idx < roots.length) return roots[idx] ?? `Entity${idx}`;
  // Additional names: suffix with ordinal to avoid collisions
  const base = roots[idx % roots.length] ?? 'Entity';
  const suffix = Math.floor(idx / roots.length) + 2;
  return `${base}${suffix}`;
}

// ── FK column generation ──────────────────────────────────────────────────────

function fkColName(targetPk: string): string {
  // e.g. party_id → party_id; if target PK is just "id", use snake(target)_id
  return targetPk;
}

function toSnake(pascal: string): string {
  return pascal
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

// ── Markdown / YAML generation ────────────────────────────────────────────────

function yamlStr(v: string): string {
  // Simple scalar quoting — avoids YAML special chars
  if (/[:#\[\]{},&*?|<>=!%@`]/.test(v) || v.includes('\n')) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

function writeIgnatiusYml(dir: string): void {
  const content = `name: Synthetic Model (n=${N})

theme:
  dark:
    background: "#16171b"
    surface: "#1f2127"
    border: "#363941"
    text: "#e8e9ec"
    textMuted: "#9aa0a9"
    edgeIdentifying: "#9aa0a9"
    edgeReferential: "#454852"
  light:
    background: "#f7f7f8"
    surface: "#eceef0"
    border: "#d6dade"
    text: "#23262b"
    textMuted: "#646b73"
    edgeIdentifying: "#646b73"
    edgeReferential: "#c2c8ce"
`;
  writeFileSync(join(dir, 'ignatius.yml'), content);
}

function writeGroupFile(dir: string, g: typeof GROUPS[0]): void {
  const content = `---
label: ${yamlStr(g.label)}
color: ${yamlStr(g.color)}
---

${g.desc}
`;
  writeFileSync(join(dir, `${g.id}.md`), content);
}

type EntitySpec = {
  id: string;
  group: string;
  pk: string;
  columns: Array<{ name: string; type: string; desc: string; nullable?: boolean }>;
  relationships: Array<{ target: string; on: string; targetPk: string; nullable?: boolean }>;
  isBasetype?: boolean;
  subtypes?: string[];
  isSubtype?: boolean;
  basetypeId?: string;
};

function writeEntityFile(dir: string, spec: EntitySpec): void {
  const pkCol = spec.pk;
  const lines: string[] = ['---', `entity: ${spec.id}`, `group: ${spec.group}`, 'pk:'];
  lines.push(`  - ${pkCol}`);

  // For subtypes, include basetype FK in PK too (key-inherited)
  if (spec.isSubtype && spec.basetypeId) {
    // nothing extra — pkCol IS the basetype FK
  }

  lines.push('columns:');
  lines.push(`  ${pkCol}:`);
  lines.push(`    type: integer`);
  if (spec.isSubtype && spec.basetypeId) {
    lines.push(`    desc: ${yamlStr(`Foreign key to ${spec.basetypeId}.`)}`);
  } else {
    lines.push(`    desc: ${yamlStr(`Primary key of ${spec.id}.`)}`);
  }

  for (const col of spec.columns) {
    lines.push(`  ${col.name}:`);
    lines.push(`    type: ${col.type}`);
    if (col.nullable) lines.push(`    nullable: true`);
    lines.push(`    desc: ${yamlStr(col.desc)}`);
  }

  // FK columns from relationships (not the PK ones)
  for (const rel of spec.relationships) {
    if (rel.on === pkCol) continue; // already in columns as pk
    lines.push(`  ${rel.on}:`);
    lines.push(`    type: integer`);
    if (rel.nullable) lines.push(`    nullable: true`);
    lines.push(`    desc: ${yamlStr(`Foreign key to ${rel.target}.`)}`);
  }

  if (spec.isBasetype && spec.subtypes && spec.subtypes.length > 0) {
    lines.push('subtypes:');
    lines.push('  - exclusive: true');
    lines.push(`    desc: "Every ${spec.id} is exactly one subtype."`);
    lines.push('    members:');
    for (const m of spec.subtypes) {
      lines.push(`      ${m}:`);
      lines.push(`        type: ${toSnake(spec.id)}_type.${m.toUpperCase()}`);
    }
  }

  if (spec.relationships.length > 0) {
    lines.push('relationships:');
    for (const rel of spec.relationships) {
      lines.push(`  - target: ${rel.target}`);
      lines.push(`    on:`);
      lines.push(`      ${rel.on}: ${rel.targetPk}`);
      lines.push(`    predicate: { fwd: belongs to, rev: has }`);
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(`# ${spec.id}`);
  lines.push('');
  lines.push(`A synthetic entity in the **${spec.group}** domain.`);
  lines.push('');

  writeFileSync(join(dir, `${spec.id}.md`), lines.join('\n'));
}

// ── Build entity graph ────────────────────────────────────────────────────────

function buildEntityGraph(n: number): EntitySpec[] {
  const specs: EntitySpec[] = [];

  // First: emit the cluster basetypes + members
  const clusterEntityIds = new Set<string>();
  for (const cluster of CLUSTERS) {
    clusterEntityIds.add(cluster.id);
    for (const m of cluster.members) clusterEntityIds.add(m);
  }

  for (const cluster of CLUSTERS) {
    const pkCol = `${toSnake(cluster.id)}_id`;
    specs.push({
      id: cluster.id,
      group: cluster.group,
      pk: pkCol,
      columns: [
        { name: `${toSnake(cluster.id)}_type`, type: 'text', desc: `Subtype discriminator.` },
        { name: 'name',    type: 'text', desc: `Human-readable name.` },
        { name: 'is_active', type: 'boolean', desc: `Whether the record is active.` },
      ],
      relationships: [],
      isBasetype: true,
      subtypes: cluster.members,
    });

    for (const memberId of cluster.members) {
      const basePk = pkCol;
      specs.push({
        id: memberId,
        group: cluster.group,
        pk: basePk,
        columns: [
          { name: 'description', type: 'text', nullable: true, desc: `Description specific to ${memberId}.` },
          { name: 'metadata',    type: 'jsonb', nullable: true, desc: `Additional metadata.` },
        ],
        relationships: [
          { target: cluster.id, on: basePk, targetPk: basePk },
        ],
        isSubtype: true,
        basetypeId: cluster.id,
      });
    }
  }

  // Non-cluster entities distributed across groups
  const remaining = n - specs.length;
  const countPerGroup: number[] = GROUP_WEIGHTS.map(w => Math.round(w * remaining));
  // Fix rounding drift on last group
  const totalAssigned = countPerGroup.reduce((a, b) => a + b, 0);
  const lastIdx = countPerGroup.length - 1;
  countPerGroup[lastIdx] = (countPerGroup[lastIdx] ?? 0) + (remaining - totalAssigned);

  // Collect all entity ids in creation order (for FK wiring)
  const allIds: string[] = specs.map(s => s.id);
  const idToGroupIdx: Record<string, number> = {};
  for (const s of specs) {
    idToGroupIdx[s.id] = GROUPS.findIndex(g => g.id === s.group);
  }

  // Create non-cluster entities per group
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const g = GROUPS[gi];
    if (!g) continue;
    let perGroup = countPerGroup[gi] ?? 0;
    let localIdx = 0;
    while (perGroup > 0) {
      const name = entityName(g.id, localIdx);
      if (!clusterEntityIds.has(name)) {
        const id = name;
        allIds.push(id);
        idToGroupIdx[id] = gi;
        perGroup--;
      }
      localIdx++;
    }
  }

  // Now build specs for all non-cluster entities with FK wiring
  // Strategy: each entity gets 1–3 FK refs to earlier entities in the list
  // (DAG wiring — avoids cycles, gives ~1.4–1.8× edge/node ratio)
  const nonClusterIds = allIds.filter(id => !clusterEntityIds.has(id));

  // Build a pool of "hub" entities that others commonly reference
  // (Party, Product, Channel clusters + first few per group)
  const hubIds = [
    ...CLUSTERS.map(c => c.id),
    ...nonClusterIds.slice(0, Math.min(20, nonClusterIds.length)),
  ];

  // Target: ~1.4–1.7 edges/node (FK density similar to real business models).
  // Strategy: every entity gets exactly 1 FK (to a hub or same-group predecessor),
  // and every 3rd entity gets a second FK to a nearby predecessor.
  // This keeps the graph connected but avoids the O(n^3+) ELK penalty from
  // high-density fully-connected subgraphs.
  function pickFkTargets(idx: number, id: string): Array<{ target: string; on: string; targetPk: string; nullable?: boolean }> {
    const rels: Array<{ target: string; on: string; targetPk: string; nullable?: boolean }> = [];
    if (idx === 0) return rels;

    const gi = idToGroupIdx[id] ?? 0;

    // Primary FK: to a hub entity (connects every node into the main graph)
    const hub = hubIds[idx % hubIds.length];
    if (hub && hub !== id) {
      const hubPk = `${toSnake(hub)}_id`;
      rels.push({ target: hub, on: hubPk, targetPk: hubPk });
    }

    // Secondary FK: 1 additional for every 3rd entity (gives ~1.33 avg total)
    if (idx % 3 === 0) {
      const candidateIdx = Math.max(0, idx - Math.ceil(nonClusterIds.length / 15));
      const candidateId = allIds[candidateIdx];
      if (candidateId && candidateId !== id && !rels.find(r => r.target === candidateId)) {
        const cPk = `${toSnake(candidateId)}_id`;
        if (!rels.find(r => r.on === cPk)) {
          rels.push({ target: candidateId, on: cPk, targetPk: cPk, nullable: true });
        }
      }
    }

    // Same-group FK: only for entities later in a group (every 5th to keep density low)
    if (idx % 5 === 0) {
      const samePeers = nonClusterIds.slice(0, idx).filter(p => idToGroupIdx[p] === gi);
      if (samePeers.length > 0) {
        const peer = samePeers[samePeers.length - 1];
        if (peer && !rels.find(r => r.target === peer)) {
          const peerPk = `${toSnake(peer)}_id`;
          if (!rels.find(r => r.on === peerPk)) {
            rels.push({ target: peer, on: peerPk, targetPk: peerPk, nullable: true });
          }
        }
      }
    }

    return rels;
  }

  for (let idx = 0; idx < nonClusterIds.length; idx++) {
    const id = nonClusterIds[idx];
    if (!id) continue;
    const gi = idToGroupIdx[id] ?? 0;
    const g = GROUPS[gi];
    if (!g) continue;
    const pkCol = `${toSnake(id)}_id`;
    const rels = pickFkTargets(idx, id);

    const ownColumns: EntitySpec['columns'] = [
      { name: 'name',       type: 'text',      desc: `Name of the ${id} record.` },
      { name: 'code',       type: 'text',      nullable: true, desc: `Short code or slug.` },
      { name: 'created_at', type: 'datetime',  desc: `When this record was created.` },
      { name: 'is_active',  type: 'boolean',   desc: `Whether the record is active.` },
    ];

    specs.push({
      id,
      group: g.id,
      pk: pkCol,
      columns: ownColumns,
      relationships: rels,
    });
  }

  return specs;
}

// ── Writer ────────────────────────────────────────────────────────────────────

function generate(targetDir: string, entityCount: number): void {
  mkdirSync(join(targetDir, '_groups'), { recursive: true });

  writeIgnatiusYml(targetDir);

  for (const g of GROUPS) {
    writeGroupFile(join(targetDir, '_groups'), g);
    mkdirSync(join(targetDir, g.id), { recursive: true });
  }

  const specs = buildEntityGraph(entityCount);

  for (const spec of specs) {
    writeEntityFile(join(targetDir, spec.group), spec);
  }

  const edgeCount = specs.reduce((sum, s) => sum + s.relationships.length, 0);
  console.log(`[gen] wrote ${specs.length} entities, ${edgeCount} FK edges → ${targetDir}`);
}

generate(OUT, N);
