import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { resolveFlowKindPalette, type FlowKindKey, type FlowKindEntry } from '../../../theme/theme-defaults';
import { sortGroupNodes, nodeMatchesSearch, processMatchesSearch, externalMatchesSearch, storeMatchesSearch, compareDottedProcesses } from '../../logic/search';
import { resolveBodyClick, upgradeMissingLinksInContainer } from '../../dom/body-links';
import { buildSpotlightConnections } from '../../logic/spotlight';
import { buildFlowSpotlightConnections } from '../../logic/flow-spotlight';
import { buildFlowDocResolver } from '../../logic/doc-resolver';
import type { FlowDocResult } from '../../logic/doc-resolver';
import { SpotlightOverlay } from '../../components/entity/SpotlightOverlay';
import { EntityCard } from '../../components/entity/EntityCard';
import { GridCard } from '../../components/entity/GridCard';
import { ProcessGridCard, ExternalGridCard, StoreGridCard } from '../../components/entity/FlowNodeGridCard';
import { ExternalCard } from '../../components/flow-node/ExternalCard';
import { StoreCard } from '../../components/flow-node/StoreCard';
import { ProcessCard } from '../../components/process/ProcessCard';
import { FlowNodeModal } from '../../components/flow-node/FlowNodeModal';

// Lens persistence key.
const LENS_STORAGE_KEY = 'ignatius-dict-lens';

function readStoredLens(): 'read' | 'browse' {
  try {
    const v = localStorage.getItem(LENS_STORAGE_KEY);
    if (v === 'browse') return 'browse';
  } catch {}
  return 'read';
}

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
  onOpenEntity,
  themeMode,
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
  onOpenEntity: (id: string) => void;
  themeMode: 'dark' | 'light';
}) {
  const { globalErrors, entityErrors } = findings;

  // Lens state: 'read' = full document view (default); 'browse' = compact grid.
  // Persisted to localStorage; invalid stored value → 'read'.
  const [lens, setLens] = useState<'read' | 'browse'>(readStoredLens);

  // ── Spotlight state (CP3) ──────────────────────────────────────────────────
  // hoverId: card currently under the pointer; pinnedId: card clicked to pin.
  // Active spotlight = pinnedId ?? hoverId.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // CP14: labelHoverCardId — which CONNECTED (lit) card the pointer is currently over.
  // Distinct from hoverId (which changes the active spotlight node when unpinned).
  // When non-null, the overlay reveals pills only for this card's connection(s).
  const [labelHoverCardId, setLabelHoverCardId] = useState<string | null>(null);
  // CP15: focusId — when non-null, the browse grid is filtered to {focusId} ∪ connected-card-set.
  // Component state only; never written to URL hash.
  const [focusId, setFocusId] = useState<string | null>(null);

  // CP10: local state for the FlowNodeModal opened from browse-lens grid cards.
  // The resolver is rebuilt from allDiagrams via useMemo (see below).
  const [openFlowResult, setOpenFlowResult] = useState<FlowDocResult | null>(null);

  function switchLens(next: 'read' | 'browse') {
    try {
      localStorage.setItem(LENS_STORAGE_KEY, next);
    } catch {}
    setHoverId(null);
    setPinnedId(null);
    setLabelHoverCardId(null);
    setFocusId(null);
    setLens(next);
  }

  // Spotlight active id — may be a bare entity id or a "<kind>:<name>" flow-node token.
  // Detection: flow-node tokens always contain ":" (entity ids are PascalCase, no colon).
  const activeId = pinnedId ?? hoverId;
  const activeIsEntity = activeId !== null && !activeId.includes(':');

  // FK connections — entity only. Computed here since modelIndex is available.
  const spotlightConnections = useMemo(() => {
    if (activeId === null || !activeIsEntity || modelIndex === null) return [];
    return buildSpotlightConnections(modelIndex, activeId);
  }, [activeId, modelIndex]);

  // Flow-lookup token for the active card:
  //   entity  → "db:<entityId>" (its flow endpoint token)
  //   flow-node → the card's own raw token (already "<kind>:<name>")
  const activeFlowToken = activeId === null
    ? null
    : activeIsEntity
      ? `db:${activeId}`
      : activeId;

  // NOTE: flowSpotlightConnections and the unified spotlitIds are computed later
  // (after allDiagrams is declared) so allDiagrams is in scope for the useMemo deps.

  // Ref for the browse-lens container — passed to SpotlightOverlay for ResizeObserver.
  const browseLensRef = useRef<HTMLDivElement | null>(null);

  // Clear pinnedId, focusId (and labelHoverCardId) when the committed search term changes.
  // CP15: search and focus are mutually exclusive — a search-term change clears focus.
  // Use a ref to track the previous term so we only clear on genuine changes.
  // Exception: when activateFocus() clears the search (focus→no-search), the echo must
  // NOT clear focusId — the sentinel focusClearingSearchRef guards that one echo.
  const prevSearchTermRef = useRef(searchText);
  useEffect(() => {
    if (prevSearchTermRef.current !== searchText) {
      prevSearchTermRef.current = searchText;
      if (focusClearingSearchRef.current) {
        // activateFocus() caused this change — skip clearing both pinnedId and focusId.
        // The pin must stay active so focus mode can render {focusId} ∪ connected.
        focusClearingSearchRef.current = false;
        setLabelHoverCardId(null);
        // pinnedId and focusId intentionally NOT cleared — activateFocus() is about to set focusId.
        return;
      }
      setPinnedId(null);
      setLabelHoverCardId(null);
      setFocusId(null);
    }
  }, [searchText]);

  // Esc key clears focus first (if focused), then pin. CP15: focus takes Esc priority.
  // Using a ref so the handler sees the current focusId without re-registering.
  const focusIdRef = useRef<string | null>(null);
  focusIdRef.current = focusId;

  useEffect(() => {
    if (lens !== 'browse') return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (focusIdRef.current !== null) {
          // Clear focus first; leave pin intact so user can still see the spotlit state.
          setFocusId(null);
        } else {
          setPinnedId(null);
          setLabelHoverCardId(null);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lens]);

  // CP14: Refs for stable access inside useCallback handlers without adding deps.
  // spotlitIdsRef: the current lit set (active ∪ connected cards).
  // activeIdRef: the current active spotlight id.
  const spotlitIdsRef = useRef<ReadonlySet<string>>(new Set());
  const activeIdRef = useRef<string | null>(null);

  // Card interaction callbacks — stable via useCallback so GridCard doesn't rerender
  // on every spotlight state change (cards without dim/spotlit class stay static).
  const handleCardMouseEnter = useCallback((id: string) => {
    setHoverId(id);
    // CP14: If a spotlight is active and this card is a connected (lit) card
    // (but not the active card itself), reveal its label by tracking it as labelHoverCardId.
    const active = activeIdRef.current;
    if (active !== null && id !== active && spotlitIdsRef.current.has(id)) {
      setLabelHoverCardId(id);
    }
  }, []);
  const handleCardMouseLeave = useCallback((_id: string) => {
    setHoverId(null);
    setLabelHoverCardId(null);
  }, []);
  const handleCardClick = useCallback((id: string) => {
    setPinnedId(prev => {
      const next = prev === id ? null : id;
      // Spec: unpinning clears focusId. Focus without a pin is always invalid.
      if (next === null) setFocusId(null);
      return next;
    });
    setLabelHoverCardId(null);
  }, []);

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

  // Lens refs for the beforeprint/afterprint lens force — mirrors the CP10 pattern.
  // beforeprint forces 'read' so the full document renders; afterprint restores.
  const lensRef = useRef(lens);
  lensRef.current = lens;
  const savedLensRef = useRef<'read' | 'browse'>('read');

  // Debounced search: keystrokes land in local state immediately (input stays
  // responsive); the committed term (searchText, which drives filtering and the
  // CP9 highlight walk) updates 200ms after typing pauses. External commits
  // (print clear/restore) sync back into the input and cancel any pending commit.
  const [searchInput, setSearchInput] = useState(searchText);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sentinel distinguishing our own commit echoing back through the searchText
  // prop from a genuinely external change. Without it, the echo of a commit
  // would cancel a pending timer for keystrokes typed right after the commit.
  const lastCommittedRef = useRef<string | null>(null);
  // CP15: Sentinel set by activateFocus() before it calls onSearchChange('') so
  // the searchText effect knows to skip clearing focusId on that one echo.
  // The effect consumes it (resets to false) so normal user typing still clears.
  const focusClearingSearchRef = useRef(false);

  useEffect(() => {
    if (lastCommittedRef.current !== null && searchText === lastCommittedRef.current) {
      lastCommittedRef.current = null;
      return; // own-commit echo — input already shows this value
    }
    lastCommittedRef.current = null;
    if (searchDebounceRef.current !== null) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    setSearchInput(searchText);
  }, [searchText]);

  // Clear any pending commit on unmount.
  useEffect(() => () => {
    if (searchDebounceRef.current !== null) clearTimeout(searchDebounceRef.current);
  }, []);

  function handleSearchInput(value: string) {
    setSearchInput(value);
    if (searchDebounceRef.current !== null) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      lastCommittedRef.current = value;
      onSearchChangeRef.current(value);
    }, 200);
  }

  useEffect(() => {
    function handleBeforePrint() {
      savedSearchRef.current = searchTextRef.current;
      if (searchTextRef.current !== '') onSearchChangeRef.current('');
      // Force read lens for print — browse chrome (grid, toggle) is suppressed by
      // @media print rules, but forcing the lens here ensures the read-lens DOM
      // is present (not just hidden) so the full document renders for printing.
      savedLensRef.current = lensRef.current;
      if (lensRef.current !== 'read') setLens('read');
    }

    function handleAfterPrint() {
      if (savedSearchRef.current !== '') {
        onSearchChangeRef.current(savedSearchRef.current);
        savedSearchRef.current = '';
      }
      // Restore the prior lens after printing, then clear the saved value so a
      // stale lens can't be restored on a subsequent print (mirrors savedSearchRef clear).
      if (savedLensRef.current !== 'read') {
        setLens(savedLensRef.current);
      }
      savedLensRef.current = 'read';
    }

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  // Empty deps: register once on mount, unregister on unmount.
  // Handlers read searchTextRef/onSearchChangeRef/savedSearchRef/lensRef/savedLensRef
  // (all stable refs). setLens is stable across renders.
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

  // Deduplicate externals by id across ALL diagrams (recursively including sub-DFDs).
  // Mirrors collectStoreRefs — an external that only appears in a sub-DFD (same bug
  // class CP18 fixed for stores) is now captured and has a valid card to scroll to.
  const externalById: Record<string, FlowExternal> = {};
  function collectExternals(diagrams: FlowDiagram[]): void {
    for (const d of diagrams) {
      for (const ext of d.externals) externalById[ext.id] = ext;
      collectExternals(d.subDfds);
    }
  }
  collectExternals(allDiagrams);
  const allExternals = Object.values(externalById);

  // Deduplicate non-db stores by name across ALL diagrams (recursively including sub-DFDs).
  // CP18: must walk sub-DFDs so stores that only appear in a sub-DFD (e.g. queue:OrderIntake
  // in Create-Sales-Order) are captured. Previously only top-level diagrams were iterated.
  const storeByName: Record<string, FlowStoreRef> = {};
  function collectStoreRefs(diagrams: FlowDiagram[]): void {
    for (const d of diagrams) {
      for (const s of d.storeRefs) {
        if (s.kind !== 'db') storeByName[s.name] = s;
      }
      collectStoreRefs(d.subDfds);
    }
  }
  collectStoreRefs(allDiagrams);
  const allNonDbStores = Object.values(storeByName).filter(s => s.bodyHtml !== undefined);

  // CP18: Full set of non-db stores for the browse lens — includes every store referenced
  // by any flow edge, even those without a _stores/*.md doc file (e.g. queue:OrderIntake).
  // The read lens and ddNonDbStoreNames stay on allNonDbStores (bodyHtml-filtered) — correct.
  const allBrowseStores = Object.values(storeByName);

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

  // CP11: flow connections for the active spotlight card.
  // Defined here (after allDiagrams) so the dep is in scope.
  const flowSpotlightConnections = useMemo(() => {
    if (activeFlowToken === null || allDiagrams.length === 0) return [];
    return buildFlowSpotlightConnections(allDiagrams, activeFlowToken);
  }, [activeFlowToken, allDiagrams]);

  // CP11: unified lit set — {activeId} ∪ FK-connected ids ∪ flow-connected card ids.
  // Replaces the earlier entity-only spotlitIds.
  const spotlitIds = useMemo<ReadonlySet<string>>(() => {
    if (activeId === null) return new Set();
    const ids = new Set<string>();
    ids.add(activeId);
    for (const c of spotlightConnections) ids.add(c.otherId);
    for (const c of flowSpotlightConnections) ids.add(c.otherCardId);
    return ids;
  }, [activeId, spotlightConnections, flowSpotlightConnections]);

  // CP15: focus set — {focusId} ∪ connected-card-set(focusId).
  // Computed from the same spotlight logic so cross-domain connections are included.
  // When focusId is null, focusSet is null (no filter applied).
  const focusSet = useMemo<ReadonlySet<string> | null>(() => {
    if (focusId === null) return null;
    const ids = new Set<string>();
    ids.add(focusId);
    // FK connections (entity-focused only).
    const focusIsEntity = !focusId.includes(':');
    if (focusIsEntity && modelIndex !== null) {
      for (const c of buildSpotlightConnections(modelIndex, focusId)) ids.add(c.otherId);
    }
    // Flow connections (all card types).
    if (allDiagrams.length > 0) {
      const focusFlowToken = focusIsEntity ? `db:${focusId}` : focusId;
      for (const c of buildFlowSpotlightConnections(allDiagrams, focusFlowToken)) {
        ids.add(c.otherCardId);
      }
    }
    return ids;
  }, [focusId, modelIndex, allDiagrams]);

  // CP14: keep refs in sync so stable handleCardMouseEnter can read current values.
  spotlitIdsRef.current = spotlitIds;
  activeIdRef.current = activeId;

  // CP10: flow kind palette for browse-lens card accents.
  const kindPalette = useMemo(
    () => resolveFlowKindPalette(themeMode, model.theme?.flowKinds),
    [themeMode, model.theme],
  );

  // CP10: flow doc resolver for the browse-lens ⓘ button on flow-node cards.
  // Rebuilt whenever the diagram set changes (SSE / static load).
  const resolveFlowDoc = useMemo(
    () => buildFlowDocResolver(allDiagrams, model),
    [allDiagrams, model],
  );

  // CP15: activate focus mode — sets focusId = pinnedId, clears search (mutually exclusive).
  function activateFocus() {
    if (pinnedId === null) return;
    // Focus clears search (the two never compose).
    if (searchText !== '') {
      // Set sentinel BEFORE calling onSearchChange so the searchText useEffect knows
      // this change is from us and should NOT clear focusId (we're about to set it).
      focusClearingSearchRef.current = true;
      onSearchChange('');
      setSearchInput('');
      if (searchDebounceRef.current !== null) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      lastCommittedRef.current = '';
    }
    setFocusId(pinnedId);
  }

  // CP15: exit focus — clear focusId, leave pinnedId intact (spotlight stays active).
  function exitFocus() {
    setFocusId(null);
  }

  // Open the FlowNodeModal for a given flow token (from browse-lens ⓘ buttons).
  function openFlowNode(token: string) {
    const result = resolveFlowDoc(token);
    if (!result) return;
    if (result.kind === 'entity') {
      onOpenEntity(result.entityId);
    } else {
      setOpenFlowResult(result);
    }
  }

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
    // CP18: browse lens uses allBrowseStores (full set) so undocumented stores are visible.
    for (const s of allBrowseStores) visibleStoreNames[s.name] = true;
  } else {
    for (const p of allProcessesDeep) {
      if (processMatchesSearch(p, term)) visibleProcessIds[p.id] = true;
    }
    for (const e of allExternals) {
      if (externalMatchesSearch(e, term)) visibleExternalIds[e.id] = true;
    }
    // CP18: search filter also iterates the full set.
    for (const s of allBrowseStores) {
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
    // CP18: depends on allBrowseStores (full set) since visibleStoreNames is now derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [term, allBrowseStores],
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

    const lowerTerm = term.toLowerCase();
    const ranges: Range[] = [];

    // Walk all text nodes under the dict-view container. The search input lives
    // outside this container (in the fixed bar), so no exclusion guard needed.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
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

      {/* CP17: Fixed top search bar — frosted, centered, sits above scrolled content. */}
      <div className="dict-search-bar">
        <div className="dict-search-bar-inner">
          <div className="dict-search">
            <input
              type="search"
              className="dict-search-input"
              placeholder="Search entities, columns, processes, stores…"
              value={searchInput}
              onChange={e => handleSearchInput(e.currentTarget.value)}
              aria-label="Search dictionary"
            />
            <div className="dict-lens-toggle" role="group" aria-label="Dictionary lens">
              <button
                type="button"
                className={`dict-lens-btn${lens === 'read' ? ' dict-lens-btn--active' : ''}`}
                onClick={() => switchLens('read')}
                aria-pressed={lens === 'read'}
              >
                Read
              </button>
              <button
                type="button"
                className={`dict-lens-btn${lens === 'browse' ? ' dict-lens-btn--active' : ''}`}
                onClick={() => switchLens('browse')}
                aria-pressed={lens === 'browse'}
              >
                Browse
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main dict content */}
      <div className="dict-view" data-ignatius="dict-view">
        <div className="dict-view-inner">

        {/* Reader legend — read lens only; not meaningful in browse/grid view */}
        {lens === 'read' && <details className="dict-reader-legend" open>
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
        </details>}

        {/* No-results message when search matches nothing across all kinds */}
        {hasSearch && !hasAnyVisible && (
          <p className="dict-no-results">No results match "{term}"</p>
        )}

        {/* ── Browse lens: compact entity card grid ── */}
        {lens === 'browse' && (
          // Empty grid area click (click on the .dict-browse-lens background, not a card) clears pin.
          // Cards stop propagation via their own click handlers (they toggle pinnedId instead).
          <div
            ref={browseLensRef}
            className="dict-browse-lens"
            onClick={() => { setPinnedId(null); setFocusId(null); }}
          >
            {/* CP15: Focus bar — shown while pinned and not yet focused; allows activating focus mode. */}
            {pinnedId !== null && focusId === null && (
              <div className="dict-focus-bar" onClick={e => e.stopPropagation()}>
                <span className="dict-focus-bar-label">Pinned: <strong>{pinnedId}</strong></span>
                <button
                  type="button"
                  className="dict-focus-btn"
                  onClick={e => { e.stopPropagation(); activateFocus(); }}
                  aria-label="Focus: show only connected cards"
                >
                  Focus neighborhood
                </button>
              </div>
            )}

            {/* CP15: Show-all bar — shown while in focus mode; allows exiting back to full grid. */}
            {focusId !== null && (
              <div className="dict-focus-bar dict-focus-bar--active" onClick={e => e.stopPropagation()}>
                <span className="dict-focus-bar-label">Focused: <strong>{focusId}</strong> and neighbors</span>
                <button
                  type="button"
                  className="dict-focus-btn dict-focus-btn--exit"
                  onClick={e => { e.stopPropagation(); exitFocus(); }}
                  aria-label="Exit focus mode — show all cards"
                >
                  Show all
                </button>
              </div>
            )}

            {groupOrder.map(key => {
              const cfg = model.groups[key];
              if (!cfg) return null;
              const sorted = groupOrderedNodes[key];
              if (!sorted || sorted.length === 0) return null;
              // CP15: when focused, only render cards in the focus set.
              const visibleNodes = sorted.filter(n =>
                visibleSet[n.id] && (focusSet === null || focusSet.has(n.id))
              );
              if (visibleNodes.length === 0) return null;
              return (
                <section key={key} className="dict-browse-group">
                  <div
                    className="dict-browse-group-header"
                    style={{ borderLeftColor: cfg.color, color: cfg.color }}
                  >
                    {cfg.label}
                  </div>
                  <div className="dict-grid">
                    {visibleNodes.map(n => {
                      const spotlitClass = activeId === null
                        ? ''
                        : spotlitIds.has(n.id)
                          ? 'dict-grid-card--spotlit'
                          : 'dict-grid-card--dim';
                      return (
                        <GridCard
                          key={n.id}
                          node={n}
                          groupColor={cfg.color}
                          spotlitClass={spotlitClass}
                          onOpenEntity={onOpenEntity}
                          onMouseEnter={handleCardMouseEnter}
                          onMouseLeave={handleCardMouseLeave}
                          onClick={handleCardClick}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {/* Ungrouped entities */}
            {(() => {
              const visibleUngrouped = ungrouped.filter(n =>
                visibleSet[n.id] && (focusSet === null || focusSet.has(n.id))
              );
              if (visibleUngrouped.length === 0) return null;
              return (
                <section className="dict-browse-group">
                  <div className="dict-browse-group-header" style={{ borderLeftColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}>
                    Ungrouped
                  </div>
                  <div className="dict-grid">
                    {visibleUngrouped.map(n => {
                      const spotlitClass = activeId === null
                        ? ''
                        : spotlitIds.has(n.id)
                          ? 'dict-grid-card--spotlit'
                          : 'dict-grid-card--dim';
                      return (
                        <GridCard
                          key={n.id}
                          node={n}
                          groupColor={undefined}
                          spotlitClass={spotlitClass}
                          onOpenEntity={onOpenEntity}
                          onMouseEnter={handleCardMouseEnter}
                          onMouseLeave={handleCardMouseLeave}
                          onClick={handleCardClick}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* ── CP10: Flow-node grid sections (Processes / Externals / Stores) ── */}
            {hasDiagrams && (() => {
              // Processes section — sorted by dotted number; CP15: filter by focus set.
              const visibleProcs = [...allProcessesDeep]
                .filter(p => visibleProcessIds[p.id] && (focusSet === null || focusSet.has(`proc:${p.id}`)))
                .sort(compareDottedProcesses);

              // Externals section — sorted alphabetically by display label; CP15: filter by focus set.
              const visibleExts = allExternals
                .filter(e => visibleExternalIds[e.id] && (focusSet === null || focusSet.has(`ext:${e.id}`)))
                .sort((a, b) => a.label.localeCompare(b.label));

              // Data stores section — sorted alphabetically by displayName; CP15: filter by focus set.
              // CP18: uses allBrowseStores (full set) so undocumented stores like queue:OrderIntake appear.
              const visibleStores = allBrowseStores
                .filter(s => visibleStoreNames[s.name] && (focusSet === null || focusSet.has(`${s.kind}:${s.name}`)))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));

              return (
                <>
                  {visibleProcs.length > 0 && (
                    <section className="dict-browse-group dict-browse-flow-group">
                      <div className="dict-browse-group-header dict-browse-flow-header">
                        Processes
                      </div>
                      <div className="dict-grid">
                        {visibleProcs.map(proc => {
                          const procToken = `proc:${proc.id}`;
                          const procSpotlitClass = activeId === null
                            ? ''
                            : spotlitIds.has(procToken)
                              ? 'dict-grid-card--spotlit'
                              : 'dict-grid-card--dim';
                          return (
                            <ProcessGridCard
                              key={proc.id}
                              process={proc}
                              spotlitClass={procSpotlitClass}
                              onOpenNode={openFlowNode}
                              onMouseEnter={handleCardMouseEnter}
                              onMouseLeave={handleCardMouseLeave}
                              onClick={handleCardClick}
                            />
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {visibleExts.length > 0 && (
                    <section className="dict-browse-group dict-browse-flow-group">
                      <div className="dict-browse-group-header dict-browse-flow-header">
                        External entities
                      </div>
                      <div className="dict-grid">
                        {visibleExts.map(ext => {
                          const extToken = `ext:${ext.id}`;
                          const extSpotlitClass = activeId === null
                            ? ''
                            : spotlitIds.has(extToken)
                              ? 'dict-grid-card--spotlit'
                              : 'dict-grid-card--dim';
                          return (
                            <ExternalGridCard
                              key={ext.id}
                              external={ext}
                              kindPalette={kindPalette}
                              themeMode={themeMode}
                              spotlitClass={extSpotlitClass}
                              onOpenNode={openFlowNode}
                              onMouseEnter={handleCardMouseEnter}
                              onMouseLeave={handleCardMouseLeave}
                              onClick={handleCardClick}
                            />
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {visibleStores.length > 0 && (
                    <section className="dict-browse-group dict-browse-flow-group">
                      <div className="dict-browse-group-header dict-browse-flow-header">
                        Data stores
                      </div>
                      <div className="dict-grid">
                        {visibleStores.map(store => {
                          const storeToken = `${store.kind}:${store.name}`;
                          const storeSpotlitClass = activeId === null
                            ? ''
                            : spotlitIds.has(storeToken)
                              ? 'dict-grid-card--spotlit'
                              : 'dict-grid-card--dim';
                          return (
                            <StoreGridCard
                              key={storeToken}
                              store={store}
                              kindPalette={kindPalette}
                              spotlitClass={storeSpotlitClass}
                              onOpenNode={openFlowNode}
                              onMouseEnter={handleCardMouseEnter}
                              onMouseLeave={handleCardMouseLeave}
                              onClick={handleCardClick}
                            />
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ── Read lens: full document entity sections ── */}
        {lens === 'read' && (
          <>
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
          </>
        )}

        {/* ── Process-model section (CP5) — read lens only ── */}
        {lens === 'read' && hasDiagrams && (
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
        </div>{/* .dict-view-inner */}
      </div>

      {/* CP10: FlowNodeModal for browse-lens flow-node card ⓘ buttons.
          Opened by openFlowNode(); closed via setOpenFlowResult(null). */}
      {openFlowResult?.kind === 'node' && (
        <FlowNodeModal
          node={openFlowResult.node}
          allProcesses={openFlowResult.allProcesses}
          doc={openFlowResult.doc}
          onClose={() => setOpenFlowResult(null)}
          onNavigate={(token) => {
            const result = resolveFlowDoc(token);
            if (!result) return;
            if (result.kind === 'entity') {
              setOpenFlowResult(null);
              onOpenEntity(result.entityId);
            } else {
              setOpenFlowResult(result);
            }
          }}
        />
      )}

      {/* CP4/CP12: Leader-line overlay — rendered when browse lens is active and a spotlight is set.
          Position:fixed SVG outside the scrolling dict-view so it spans the full viewport.
          CP12: flowConnections draws dashed flow lines alongside solid FK lines. */}
      {lens === 'browse' && activeId !== null && (
        <SpotlightOverlay
          activeId={activeId}
          connections={spotlightConnections}
          flowConnections={flowSpotlightConnections}
          labelHoverCardId={labelHoverCardId}
          gridContainerRef={browseLensRef}
        />
      )}
    </>
  );
}

export { DictionaryView };
