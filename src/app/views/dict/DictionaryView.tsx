import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Model, ModelNode } from '../../../model/parse';
import type {
  FlowDiagram,
  FlowProcess,
  FlowExternal,
  FlowStoreRef,
} from '../../../flows/flow-parse';
import type { FlowError } from '../../../flows/flow-validate';
import type { EntityError, GlobalError } from '../../../model/validate';
import type { ModelIndex } from '../../../model/model-index';
import { buildEntityUsageIndex } from '../../../flows/flow-usage-index';
import { sortGroupNodes, nodeMatchesSearch, processMatchesSearch, externalMatchesSearch, storeMatchesSearch, compareDottedProcesses } from '../../logic/search';
import { resolveBodyClick, upgradeMissingLinksInContainer } from '../../dom/body-links';
import { EntityCard } from '../../components/entity/EntityCard';
import { ExternalCard } from '../../components/flow-node/ExternalCard';
import { StoreCard } from '../../components/flow-node/StoreCard';
import { ProcessCard } from '../../components/process/ProcessCard';

function DictionaryView({
  model,
  modelIndex,
  findings,
  flowDiagrams,
  flowFindings,
  searchText,
  onSearchChange,
  dictNavOpen,
  onToggleNav,
}: {
  model: Model;
  modelIndex: ModelIndex | null;
  findings: { globalErrors: GlobalError[]; entityErrors: EntityError[] };
  flowDiagrams: FlowDiagram[] | null;
  flowFindings: { flowErrors: FlowError[]; globalErrors: GlobalError[] };
  searchText: string;
  onSearchChange: (v: string) => void;
  dictNavOpen: boolean;
  onToggleNav: () => void;
}) {
  const { globalErrors, entityErrors } = findings;

  // O(1) error lookup maps so per-entity/per-process filters are single map
  // lookups instead of O(n) array scans in every DictEntitySection/DictProcessSection.
  const errorsByEntityId = useMemo(() => {
    const m = new Map<string, EntityError[]>();
    for (const e of entityErrors) {
      const existing = m.get(e.entityId);
      if (existing !== undefined) {
        existing.push(e);
      } else {
        m.set(e.entityId, [e]);
      }
    }
    return m;
  }, [entityErrors]);

  const errorsByProcessId = useMemo(() => {
    const m = new Map<string, FlowError[]>();
    for (const e of flowFindings.flowErrors) {
      if (e.processId === undefined) continue;
      const existing = m.get(e.processId);
      if (existing !== undefined) {
        existing.push(e);
      } else {
        m.set(e.processId, [e]);
      }
    }
    return m;
  }, [flowFindings.flowErrors]);

  // CP10: beforeprint/afterprint — clear active search so the FULL dictionary
  // renders when the user prints, then restore the prior term on afterprint.
  //
  // Implementation note: savedSearchRef holds the term to restore. Using a ref
  // (not local let) because beforeprint calls onSearchChange(''), which triggers
  // a re-render that would re-run a deps-based effect and reset a local variable
  // before afterprint fires — losing the saved term. The ref is mutation-stable
  // across re-renders. searchTextRef gives handlers stable read access to the
  // current searchText without re-registering the event listeners on every change.
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const onSearchChangeRef = useRef(onSearchChange);
  onSearchChangeRef.current = onSearchChange;
  const savedSearchRef = useRef('');

  useEffect(() => {
    function handleBeforePrint() {
      savedSearchRef.current = searchTextRef.current;
      if (searchTextRef.current !== '') onSearchChangeRef.current('');
    }

    function handleAfterPrint() {
      if (savedSearchRef.current !== '') {
        onSearchChangeRef.current(savedSearchRef.current);
        savedSearchRef.current = '';
      }
    }

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  // Empty deps: register once on mount, unregister on unmount.
  // Handlers read searchTextRef/onSearchChangeRef/savedSearchRef (all stable refs).
  }, []);

  // Build missing-target set (entities referenced by FK but not present).
  const missingTargets = new Set(
    globalErrors
      .filter(e => e.ruleId === 'edge.unknown_target')
      .map(e => {
        const arrow = e.omitted.id.indexOf('→');
        return arrow >= 0 ? e.omitted.id.slice(arrow + 1) : e.omitted.id;
      }),
  );

  // Sort group order: sort_key ascending, then alphabetical by id.
  const groupOrder = Object.keys(model.groups).sort((a, b) => {
    const skA = model.groups[a]?.sort_key;
    const skB = model.groups[b]?.sort_key;
    if (skA !== undefined && skB !== undefined) {
      return skA !== skB ? skA - skB : a.localeCompare(b);
    }
    if (skA !== undefined) return -1;
    if (skB !== undefined) return 1;
    return a.localeCompare(b);
  });

  // Scroll-to-anchor navigation (anchor links within the dict panel).
  function scrollToEntity(entityId: string) {
    const el = document.getElementById(`entity-${entityId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Generalized scroll: resolves the correct DD section anchor regardless of
  // kind (entity / external / store / process). Used by body wiki-link clicks so
  // [[Customer]] (an external) reaches #external-Customer even though the href
  // written by the wiki plugin always says #entity-*.
  function scrollToSection(id: string) {
    const prefixes = ['entity', 'external', 'store', 'process'] as const;
    for (const prefix of prefixes) {
      const el = document.getElementById(`${prefix}-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
  }

  function scrollToMissing(id: string) {
    const el = document.getElementById(`missing-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Delegates to the shared module-level resolveBodyClick with the local scrollToSection.
  function handleDdBodyClick(e: React.MouseEvent<HTMLDivElement>) {
    resolveBodyClick(e, scrollToSection);
  }

  // Build node list filtered by search term.
  const hasSearch = searchText.trim().length > 0;
  const term = searchText.trim();

  // Subtypes-of lookup: which clusters is this node the basetype or member of?
  const subtypeIds: Record<string, true> = {};
  for (const c of model.subtypeClusters) {
    for (const m of c.members) subtypeIds[m] = true;
  }

  // Build group → sorted nodes mapping (pre-sorted, then optionally filtered).
  // Uses modelIndex.nodesByGroup for O(1) group lookup instead of filter-scan.
  const groupOrderedNodes: Record<string, ModelNode[]> = {};
  for (const key of groupOrder) {
    const cfg = model.groups[key];
    if (!cfg) continue;
    const groupNodes = modelIndex?.nodesByGroup.get(key) ?? model.nodes.filter(n => n.group === key);
    if (groupNodes.length === 0) continue;
    groupOrderedNodes[key] = sortGroupNodes(groupNodes, model.subtypeClusters);
  }

  const ungrouped = model.nodes
    .filter(n => !n.group || !model.groups[n.group])
    .sort((a, b) => a.id.localeCompare(b.id));

  // Determine which entity nodes pass the filter.
  const visibleSet: Record<string, true> = {};
  if (!hasSearch) {
    for (const n of model.nodes) visibleSet[n.id] = true;
  } else {
    for (const key of groupOrder) {
      const cfg = model.groups[key];
      if (!cfg) continue;
      // Use modelIndex.nodesByGroup for O(1) group lookup (no filter-scan).
      for (const n of (modelIndex?.nodesByGroup.get(key) ?? model.nodes.filter(n => n.group === key))) {
        if (nodeMatchesSearch(n, term, cfg.label)) visibleSet[n.id] = true;
      }
    }
    for (const n of ungrouped) {
      if (nodeMatchesSearch(n, term, '')) visibleSet[n.id] = true;
    }
  }

  const totalVisible = Object.keys(visibleSet).length;

  // Collect all processes / externals / non-db stores from all diagrams (flat).
  const allDiagrams = flowDiagrams ?? [];
  // Include sub-DFD processes recursively.
  function collectProcessesDeep(diagrams: FlowDiagram[]): FlowProcess[] {
    const result: FlowProcess[] = [];
    for (const d of diagrams) {
      result.push(...d.processes);
      result.push(...collectProcessesDeep(d.subDfds));
    }
    return result;
  }
  const allProcessesDeep = collectProcessesDeep(allDiagrams);

  // Deduplicate externals by id (same external may appear in multiple DFDs).
  const externalById: Record<string, FlowExternal> = {};
  for (const d of allDiagrams) {
    for (const ext of d.externals) externalById[ext.id] = ext;
  }
  const allExternals = Object.values(externalById);

  // Deduplicate non-db stores by name across diagrams.
  const storeByName: Record<string, FlowStoreRef> = {};
  for (const d of allDiagrams) {
    for (const s of d.storeRefs) {
      if (s.kind !== 'db') storeByName[s.name] = s;
    }
  }
  const allNonDbStores = Object.values(storeByName).filter(s => s.bodyHtml !== undefined);

  // O(1) membership sets for DD-card endpoint clickability (CP25).
  // Built from the same source arrays as allExternals/allNonDbStores so they stay in sync.
  const ddExternalIds: Record<string, true> = {};
  for (const ext of allExternals) ddExternalIds[ext.id] = true;
  const ddNonDbStoreNames: Record<string, true> = {};
  for (const s of allNonDbStores) ddNonDbStoreNames[s.name] = true;

  // Entity ↔ process usage index (CP7): maps entityId → ProcessUsage[].
  // Built here so DictEntitySection can render a Processes table per entity.
  // Memoized — DictionaryView is keep-mounted and re-renders on every parent
  // state change; allDiagrams is the only dependency that affects the index.
  const entityUsageIndex = useMemo(() => buildEntityUsageIndex(allDiagrams), [allDiagrams]);

  // Per-diagram top-level processes (for the nav and DFD headings).
  const hasDiagrams = allDiagrams.length > 0;
  const hasProcesses = allProcessesDeep.length > 0;

  // Flow-item visibility sets (keyed by process id, external id, store name).
  const visibleProcessIds: Record<string, true> = {};
  const visibleExternalIds: Record<string, true> = {};
  const visibleStoreNames: Record<string, true> = {};

  if (!hasSearch) {
    for (const p of allProcessesDeep) visibleProcessIds[p.id] = true;
    for (const e of allExternals) visibleExternalIds[e.id] = true;
    for (const s of allNonDbStores) visibleStoreNames[s.name] = true;
  } else {
    for (const p of allProcessesDeep) {
      if (processMatchesSearch(p, term)) visibleProcessIds[p.id] = true;
    }
    for (const e of allExternals) {
      if (externalMatchesSearch(e, term)) visibleExternalIds[e.id] = true;
    }
    for (const s of allNonDbStores) {
      if (storeMatchesSearch(s, term)) visibleStoreNames[s.name] = true;
    }
  }

  const totalFlowVisible =
    Object.keys(visibleProcessIds).length +
    Object.keys(visibleExternalIds).length +
    Object.keys(visibleStoreNames).length;

  const hasAnyVisible = totalVisible > 0 || totalFlowVisible > 0;

  // CP9: stable dep signals for the highlight effect — avoids inline JSON.stringify
  // allocations on every render. Each is a sorted join of keys; changes only when
  // the visible set actually changes (i.e. after the filtered render lands in DOM).
  const visibleSetKey = useMemo(
    () => Object.keys(visibleSet).sort().join('\0'),
    // visibleSet is rebuilt each render; its contents (not identity) matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, model.nodes],
  );
  const visibleProcessKey = useMemo(
    () => Object.keys(visibleProcessIds).sort().join('\0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allProcessesDeep],
  );
  const visibleExternalKey = useMemo(
    () => Object.keys(visibleExternalIds).sort().join('\0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allExternals],
  );
  const visibleStoreKey = useMemo(
    () => Object.keys(visibleStoreNames).sort().join('\0'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allNonDbStores],
  );

  // CP9: DOM highlight — apply CSS Custom Highlight API ranges over the visible
  // DD content whenever the committed search term changes. Runs after render so
  // the newly-visible sections are in the DOM. Clears on empty search.
  // Using useLayoutEffect (not useEffect) so highlights are applied synchronously
  // after DOM mutations, before the browser paints — avoids a flash of unhighlighted text.
  useLayoutEffect(() => {
    const HIGHLIGHT_NAME = 'dd-search-highlight';

    // Always clear previous highlight first.
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }

    if (!term || !hasSearch) return;
    if (typeof CSS === 'undefined' || !CSS.highlights) return;

    const container = document.querySelector<HTMLElement>('[data-ignatius="dict-view"]');
    if (!container) return;

    // Exclude the search input itself from highlighting.
    const searchInput = container.querySelector('.dict-search-input');

    const lowerTerm = term.toLowerCase();
    const ranges: Range[] = [];

    // Walk all text nodes under the dict-view container, excluding the search box.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // Skip text inside the search input.
        if (searchInput && searchInput.contains(node)) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue ?? '';
        return text.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node !== null) {
      const text = node.nodeValue ?? '';
      const lower = text.toLowerCase();
      let idx = lower.indexOf(lowerTerm);
      while (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + term.length);
        ranges.push(range);
        idx = lower.indexOf(lowerTerm, idx + 1);
      }
      node = walker.nextNode();
    }

    if (ranges.length > 0) {
      const highlight = new Highlight(...ranges);
      CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    }
  // Depend on the committed search term and the memoized visible-set key signals
  // so the effect re-runs after React re-renders the filtered items into the DOM.
  }, [term, visibleSetKey, visibleProcessKey, visibleExternalKey, visibleStoreKey]);

  // Client-side upgrade pass: entity bodies are rendered at parse time with
  // knownIds = entity IDs only, so a [[Customer]] reference in an entity body
  // emits a `.entity-link--missing` span even when Customer exists as a flow
  // external. After the DD mounts, walk all `.entity-link--missing` spans inside
  // the dict-view container and upgrade those whose target matches any known node
  // (entity / external / store / process) to live `<a class="entity-link">` links
  // wired to scrollToSection via their data-entity attribute.
  // Runs after every render so newly-visible bodies (after search) are covered.
  useEffect(() => {
    const container = document.querySelector<HTMLElement>('[data-ignatius="dict-view"]');
    if (!container) return;

    // Build a full set of all known IDs across all node kinds.
    const allKnownIds = new Set<string>();
    for (const n of model.nodes) allKnownIds.add(n.id);
    for (const ext of allExternals) allKnownIds.add(ext.id);
    for (const proc of allProcessesDeep) allKnownIds.add(proc.id);
    for (const store of allNonDbStores) allKnownIds.add(store.name);

    upgradeMissingLinksInContainer(container, allKnownIds);
  // Re-run whenever the set of visible items changes (model change, search, diagram load).
  }, [model, allExternals, allProcessesDeep, allNonDbStores, visibleSetKey, visibleProcessKey, visibleExternalKey, visibleStoreKey]);

  function scrollToProcess(processId: string) {
    const el = document.getElementById(`process-${processId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Build side-nav subtypeIds per-group for indent styling.
  function groupSubtypeIds(groupNodes: ModelNode[]): Record<string, true> {
    const ids: Record<string, true> = {};
    for (const c of model.subtypeClusters) {
      if (groupNodes.some(n => n.id === c.basetype)) {
        for (const m of c.members) ids[m] = true;
      }
    }
    return ids;
  }

  return (
    <>
      {/* Side nav panel — entity groups + process nav */}
      <nav
        className={`dict-nav-panel${dictNavOpen ? ' dict-nav-open' : ''}`}
        aria-label="Entity and process navigation"
      >
        <div className="dict-nav-inner">
          {groupOrder.map(key => {
            const cfg = model.groups[key];
            if (!cfg) return null;
            const sorted = groupOrderedNodes[key];
            if (!sorted || sorted.length === 0) return null;
            const stIds = groupSubtypeIds(sorted);
            const visibleNodes = sorted.filter(n => visibleSet[n.id]);
            if (visibleNodes.length === 0) return null;
            return (
              <div key={key} className="dict-nav-group">
                <div className="dict-nav-group-label" style={{ color: cfg.color }}>{cfg.label}</div>
                {visibleNodes.map(n => (
                  <a
                    key={n.id}
                    className={`dict-nav-link${stIds[n.id] ? ' dict-nav-subtype' : ''}`}
                    href={`#entity-${n.id}`}
                    onClick={e => { e.preventDefault(); scrollToEntity(n.id); }}
                  >
                    {n.id}
                  </a>
                ))}
              </div>
            );
          })}

          {/* Process nav groups */}
          {hasDiagrams && hasProcesses && (
            <div className="dict-nav-process-group">
              {allDiagrams.map(diagram => {
                // Collect all processes from this diagram recursively (matches body render).
                function collectNavProcesses(diagrams: FlowDiagram[]): FlowProcess[] {
                  const result: FlowProcess[] = [];
                  for (const d of diagrams) {
                    result.push(...d.processes);
                    result.push(...collectNavProcesses(d.subDfds));
                  }
                  return result;
                }
                const visibleProcs = collectNavProcesses([diagram]).filter(p => visibleProcessIds[p.id]);
                if (visibleProcs.length === 0) return null;
                // Sort processes hierarchically by dotted number (1 → 1.1 → 1.2 → 2 → 3).
                const sortedProcs = [...visibleProcs].sort(compareDottedProcesses);
                return (
                  <div key={diagram.id} className="dict-nav-group">
                    <div className="dict-nav-group-label">
                      {allDiagrams.length > 1 ? diagram.id : 'Processes'}
                    </div>
                    {sortedProcs.map(p => {
                      const depth = p.dottedNumber.split('.').length - 1;
                      const indentStyle = depth > 0
                        ? { paddingLeft: `calc(1rem + ${depth}rem)`, fontSize: '0.78rem' }
                        : undefined;
                      return (
                        <a
                          key={p.id}
                          className="dict-nav-link"
                          style={indentStyle}
                          href={`#process-${p.id}`}
                          onClick={e => { e.preventDefault(); scrollToProcess(p.id); }}
                        >
                          {p.dottedNumber} {p.label}
                        </a>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Main dict content */}
      <div className="dict-view" data-ignatius="dict-view">
        {/* Search — spans entities + processes + externals + stores */}
        <div className="dict-search">
          <input
            type="search"
            className="dict-search-input"
            placeholder="Search entities, columns, processes, stores…"
            value={searchText}
            onChange={e => onSearchChange(e.currentTarget.value)}
            aria-label="Search dictionary"
          />
        </div>

        {/* Reader legend */}
        <details className="dict-reader-legend" open>
          <summary>How to read this</summary>
          <div className="dict-reader-legend-grid">
            <section className="dict-reader-legend-cell">
              <h3>Groups</h3>
              <ul className="dict-legend-list">
                {Object.entries(model.groups).map(([key, cfg]) => (
                  <li key={key} className="dict-legend-item">
                    <span className="dict-swatch" style={{ background: cfg.color }} />
                    <span className="dict-legend-label">{cfg.label}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Classification</h3>
              <div className="dict-reader-legend-badges">
                {(['independent', 'dependent', 'associative', 'subtype', 'classifier'] as const).map(k => (
                  <span
                    key={k}
                    className="dict-badge"
                    style={{ background: `var(--badge-${k}-bg)`, color: `var(--badge-${k}-fg)` }}
                  >
                    {k}
                  </span>
                ))}
              </div>
              <p className="dict-reader-legend-note">Derived from the model — never authored directly.</p>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Predicate pills</h3>
              <div className="dict-reader-legend-pills">
                <span className="dict-predicate-pill dict-predicate-pill--primary">
                  is owned by<span className="dict-predicate-arrow"> →</span>
                </span>
                <span className="dict-predicate-pill dict-predicate-pill--inverse">
                  <span className="dict-predicate-arrow">← </span>owns
                </span>
              </div>
              <p className="dict-reader-legend-note">
                First pill: child's perspective. Second: parent as subject.
              </p>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Relationship type</h3>
              <p className="dict-reader-legend-note">
                <strong>Identifying</strong> — child PK contains parent PK.<br />
                <strong>Referential</strong> — FK reference, independent identity.
              </p>
            </section>
            <section className="dict-reader-legend-cell">
              <h3>Cardinality</h3>
              <p className="dict-reader-legend-note">
                Read as <code>parent → child</code>. <code>1 → many</code> = one parent, many children.
              </p>
            </section>
          </div>
        </details>

        {/* No-results message when search matches nothing across all kinds */}
        {hasSearch && !hasAnyVisible && (
          <p className="dict-no-results">No results match "{term}"</p>
        )}

        {/* Entity sections by group */}
        {groupOrder.map(key => {
          const cfg = model.groups[key];
          if (!cfg) return null;
          const sorted = groupOrderedNodes[key];
          if (!sorted || sorted.length === 0) return null;
          const visibleNodes = sorted.filter(n => visibleSet[n.id]);
          if (visibleNodes.length === 0) return null;
          return (
            <section key={key} className="dict-group-section">
              <div
                className="dict-group-header"
                style={{ borderLeft: `4px solid ${cfg.color}`, paddingLeft: '1rem' }}
              >
                <h1 className="dict-group-title" style={{ color: cfg.color }}>{cfg.label}</h1>
                {cfg.desc && (
                  <div
                    className="dict-group-desc"
                    dangerouslySetInnerHTML={{ __html: cfg.desc }}
                  />
                )}
              </div>
              {visibleNodes.map(n => (
                <EntityCard
                  key={n.id}
                  node={n}
                  edges={model.edges}
                  basetypeCluster={modelIndex?.basetypeClusterById.get(n.id)}
                  memberCluster={modelIndex?.clustersByMemberId.get(n.id)?.[0]}
                  nodeErrors={errorsByEntityId.get(n.id) ?? []}
                  missingTargets={missingTargets}
                  onNavigate={scrollToSection}
                  onNavigateMissing={scrollToMissing}
                  processUsages={entityUsageIndex.get(n.id)}
                  onScrollToProcess={scrollToProcess}
                />
              ))}
            </section>
          );
        })}

        {/* Ungrouped entities */}
        {ungrouped.filter(n => visibleSet[n.id]).map(n => (
          <EntityCard
            key={n.id}
            node={n}
            edges={model.edges}
            basetypeCluster={modelIndex?.basetypeClusterById.get(n.id)}
            memberCluster={modelIndex?.clustersByMemberId.get(n.id)?.[0]}
            nodeErrors={errorsByEntityId.get(n.id) ?? []}
            missingTargets={missingTargets}
            onNavigate={scrollToSection}
            onNavigateMissing={scrollToMissing}
            processUsages={entityUsageIndex.get(n.id)}
            onScrollToProcess={scrollToProcess}
          />
        ))}

        {/* Missing entity placeholders */}
        {[...missingTargets].map(id => (
          <section key={id} id={`missing-${id}`} className="dict-missing-section">
            <h2>{id} (omitted)</h2>
            <p>This entity was referenced but does not exist in the model.</p>
          </section>
        ))}

        {/* ── Process-model section (CP5) ── */}
        {hasDiagrams && (
          <>
            <h2 className="flow-dict-section-heading">Process Model</h2>

            {/* Per-DFD process sections */}
            {allDiagrams.map(diagram => {
              // Recursively collect processes from this diagram and its sub-DFDs.
              function collectVisible(diagrams: FlowDiagram[]): FlowProcess[] {
                const result: FlowProcess[] = [];
                for (const d of diagrams) {
                  for (const p of d.processes) {
                    if (visibleProcessIds[p.id]) result.push(p);
                  }
                  result.push(...collectVisible(d.subDfds));
                }
                return result;
              }
              const visibleProcs = collectVisible([diagram]);
              if (visibleProcs.length === 0) return null;

              return (
                <div key={diagram.id}>
                  {allDiagrams.length > 1 && (
                    <h3 className="flow-dfd-heading" id={`dfd-${diagram.id}`}>{diagram.id}</h3>
                  )}
                  {visibleProcs.map(proc => (
                    <ProcessCard
                      key={proc.id}
                      process={proc}
                      allProcesses={allProcessesDeep}
                      procErrors={errorsByProcessId.get(proc.id) ?? []}
                      onScrollToEntity={scrollToEntity}
                      onScrollToSection={scrollToSection}
                      externalIds={ddExternalIds}
                      nonDbStoreNames={ddNonDbStoreNames}
                    />
                  ))}
                </div>
              );
            })}

            {/* External entity sections */}
            {allExternals.filter(e => visibleExternalIds[e.id]).length > 0 && (
              <div className="flow-stores">
                {allExternals
                  .filter(e => visibleExternalIds[e.id])
                  .map(ext => (
                    <ExternalCard key={ext.id} external={ext}>
                      {ext.bodyHtml && (
                        <div
                          className="dict-entity-body"
                          dangerouslySetInnerHTML={{ __html: ext.bodyHtml }}
                          onClick={handleDdBodyClick}
                        />
                      )}
                    </ExternalCard>
                  ))
                }
              </div>
            )}

            {/* Non-db store sections — rendered under a dedicated "Data Stores" heading */}
            {allNonDbStores.filter(s => visibleStoreNames[s.name]).length > 0 && (
              <>
                <h2 className="flow-dict-section-heading">Data Stores</h2>
                <div className="flow-stores">
                  {allNonDbStores
                    .filter(s => visibleStoreNames[s.name])
                    .map(store => (
                      <StoreCard key={store.name} store={store}>
                        {store.bodyHtml && (
                          <div
                            className="dict-entity-body"
                            dangerouslySetInnerHTML={{ __html: store.bodyHtml }}
                            onClick={handleDdBodyClick}
                          />
                        )}
                      </StoreCard>
                    ))
                  }
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export { DictionaryView };
