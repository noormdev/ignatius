# DFD layout and leveling — research

Evidence base for redesigning the ignatius DFD viewer. Two problems: the diagrams have no leveling hierarchy (flat, independent diagrams with no system-level overview), and the hand-rolled banded-preset layout produces crossing edges, overlapping long-column-list labels, and scattered related stores.

Gathered 2026-06-13 via a multi-source research pass (19 sources fetched, 83 claims extracted, 25 verified by 3-vote adversarial verification — 22 confirmed, 3 refuted and excluded). Primary sources preferred; version-specific claims re-verified against npm/GitHub on 2026-06-13.

This is an evaluation artifact, not a spec or design. It feeds `docs/design/` + `docs/spec/` for the DFD overhaul.


## 1. DFD leveling — the canonical model to adopt

The Yourdon/SSADM hierarchy, confirmed against Ed Yourdon's own Chapter 9 and University of Cape Town software-engineering course notes (both primary), and already partly recorded in [`docs/research/ssadm-dfd-rules.md`](ssadm-dfd-rules.md):

- **Context diagram (Level 0)** — the entire system drawn as ONE process, showing only the data flows between the system and its external entities. Defines the system boundary.
- **Level 1** — the "exploded view" of that single process into the major sub-processes plus the data stores they share. The same external data-flows that appear on Level 0 must also appear on Level 1.
- **Lower levels (2, 3, …)** — each explodes one process into its own figure, with no fixed depth limit. Bottom-level processes are "elementary" and are not decomposed further (the leaves).

A convention caveat surfaced and must be stated explicitly to avoid off-by-one breadcrumbs: some tools (e.g. Visual Paradigm) treat "context diagram" and "Level 0" as two distinct layers. Adopt the UCT/Yourdon convention ignatius already implies — **context = Level 0** — and say so.

> A "3-tier context / Figure-0 / leaf" framing that inserts a distinct "Figure 0" tier between the context and Level 1 was **refuted** in verification (0-3). The canon is context (Level 0) → Level 1 exploded view → lower levels. Do not adopt the three-tier framing.


### Balancing — the cross-level invariant

The one consistency rule binding the levels:

- The data flows into and out of a parent process must correspond to the data flows into and out of the entire child figure that describes it — no boundary inflows/outflows appear or vanish across the boundary.

Important qualifier (UCT, flagged by a verifier): balancing is the property of a *correctly balanced* pair, not a prohibition on ever adding a flow. Decomposition may legitimately surface a new input, which is then added to **both** the child and the parent so the pair stays balanced. Consequence for ignatius: an auto-derivation step cannot silently rewrite the parent — it must run as a **reconciliation / lint pass**. ignatius already has the right home for this: the Class-A soft warning `flow.unbalanced_decomposition`.


### Numbering across levels

Strictly hierarchical, decompositional, dotted — and exactly the scheme ignatius already uses (`compareDottedProcesses`, `ProcessUsage.dottedNumber`, CP24 sidebar nesting):

- Process `N` explodes to a figure whose processes are `N.1`, `N.2`, `N.3`; process `2.2` explodes to figure `2.2` with `2.2.1`, `2.2.2`, …
- Data stores in the expansion of process 4 are `D4.1`, `D4.2`, `D4.3`; deeper levels `D4.1.1`, …
- Numbers are identifiers only — they do **not** imply sequence or priority.


## 2. Auto-deriving the context + Level-1 overview

Feasible, but governed by two Yourdon rules that a naive "union of all process↔store edges" would violate:

- **Store promotion rule.** A shared store is shown at the *highest* level where it first interfaces two or more processes, then repeated in every lower-level diagram that partitions those processes. A store local to a single child figure is **not** shown at higher levels — it is subsumed into the parent process. So the derivation must count the distinct processes touching each store across the leaf set, promote a store only when its degree ≥ 2 at the relevant level, and subsume degree-1 local stores into the parent.
- **Balancing rule** (above). Because decomposition can legitimately add boundary flows, derivation must reconcile rather than rewrite.

Pitfalls of auto-derivation:

- **Mis-promotion** of single-process-local stores if degree isn't counted across the leaf set.
- **Naming collisions** — the same logical store appearing under different labels in different leaves would be treated as distinct. Surface these for the author.
- **Balancing drift** — the derived parent must stay balanced with its children; route discrepancies through `flow.unbalanced_decomposition`, not a silent edit.

Recommended posture: the **context diagram can be reliably auto-derived** (union of all flows crossing the outermost external boundary). The **Level-1 overview is derivable** with the degree≥2 promotion rule, but given the naming-collision and balancing risks, treat the derived overview as a *proposal reconciled by a lint pass* — or let the author confirm/adjust it — rather than an authoritative silent rewrite.


## 3. Layout engines — comparison

The field-standard answer to crossing edges + overlapping variable-size edge labels + scattered related nodes is a **Sugiyama-style layered engine** with three properties: (1) partition/layer constraints to pin ordered bands, (2) compound nodes to cluster related nodes, and (3) label-aware layout that reserves space for labels *during* layout rather than fitting them afterward.

Versions/sizes verified via `npm view` on 2026-06-13.

| Engine | Layered/Sugiyama | Band pinning (partition/layer) | Port-side constraints | Compound/grouping | Edge-label placement | Orthogonal routing | Headless (positions-only) | Size (unpacked) | Health |
|--------|------------------|-------------------------------|----------------------|-------------------|----------------------|--------------------|---------------------------|-----------------|--------|
| **ELK / elkjs** 0.11.1 | ✅ full pipeline | ✅ `partitioning` + `layerConstraint=FIRST/LAST` | ✅ TOP/BOTTOM/LEFT/RIGHT | ✅ compound nodes | ✅ first-class (label-as-dummy-node) | ✅ | ✅ "positions only, no rendering" | ~8 MB (GWT kernel; worker build available) | ✅ Eclipse-backed; **already a direct dep** (`^0.9.3`) |
| dagre / @dagrejs/dagre 3.0.0 | ✅ | ❌ none | ❌ | ✅ clusters | ⚠️ space reservation only (`width`/`height`/`labelpos`), no placement strategy | ❌ | ✅ | ~1.2 MB | ✅ maintained (legacy core last touched 2022) |
| @antv/layout 2.0.0 | ⚠️ via bundled dagre `^0.8.5` | ❌ (inherits dagre limits) | ❌ | ✅ ComboCombined | ❌ not mentioned | ❌ | ✅ `forEachNode`, worker via `enableWorker` | ~11 MB | ✅ TS-typed |
| d3-dag 1.2.1 | ✅ | ❌ | ❌ | ❌ explicitly unsupported | ❌ | ❌ | ✅ `node.x/node.y` | ~0.6 MB | ✅ TS-first; **DAG-only** (cycles must be pre-broken) |
| Graphviz-in-JS (@viz-js/viz 3.28 / @hpcc-js/wasm 2.34) | ✅ (dot) | ❌ no incremental band/port | ❌ no port-side enum | ✅ clusters | ✅ dummy-node like ELK (or `xlabel` post-route) | ✅ (dot) | ⚠️ via `-Tplain`/`-Txdot`, DOT-text I/O | ~5 MB / ~37 MB wasm | ✅ |

**ELK is the only engine in the candidate set that does all of {layered Sugiyama, partition+layer band pinning, port-side constraints, compound grouping, first-class edge-label placement, headless positions-only}.**

ELK specifics confirmed from primary Eclipse docs:

- Flagship **Layered** algorithm = full Sugiyama pipeline. Defaults: cycle breaking `GREEDY`, layering `NETWORK_SIMPLEX`, crossing minimization `LAYER_SWEEP` (barycenter/median), coordinate assignment `BRANDES_KOEPF` (groups nodes into blocks for straight edges / fewer bends). Five node-placement strategies available.
- **Band pinning** via `partitioning.activate=true` + per-node `partitioning.partition` index (lower index placed ahead along the layout axis), plus `layerConstraint=FIRST/LAST` to pin extremes. Under `elk.direction=DOWN`, partitions stack into horizontal bands.
- **Edge labels** are first-class: `edgeLabels.placement=CENTER` default, `centerLabelPlacementStrategy=MEDIAN_LAYER`, `EdgeLabelSideSelection=SMART_DOWN`, configurable spacing. Mechanism: a **label dummy node** sized to the label is inserted into the edge *before* layer assignment, so the layout reserves exact space — the technique originated in ELK's KLay-Layered predecessor at CAU Kiel and was motivated specifically by data-flow diagrams with variable-size labels.

> A claim that edge-label placement is supported across *most* ELK algorithms including bundled Dot was **refuted** (0-3) — it is a Layered feature, not universal. A specific "35.5% bend reduction on Ptolemy II" Brandes-Köpf benchmark was also **refuted** (0-3); do not cite it.


## 4. Recommended approach for ignatius

Replace the hand-rolled banded-preset positioner ([`src/flow-view/flow-layout.ts`](../../src/flow-view/flow-layout.ts), 475L) with **elkjs driven headlessly** (positions only), feeding the **existing** custom SVG renderer ([`src/flow-view/FlowDiagramSvg.tsx`](../../src/flow-view/FlowDiagramSvg.tsx), 1422L — it already consumes `FlowElementData` node positions, so it can consume ELK positions with no renderer rewrite). Keep the renderer; swap the position source.

- **(a) Bands.** Give each node a `partitioning.partition` index by role — source-externals = 0, input-stores = 1, process-row = 2, output-stores = 3, sink-externals = 4 — with `partitioning.activate=true` and `elk.direction=DOWN` so partitions stack into horizontal bands. Additionally pin pure source/sink externals with `layerConstraint=FIRST/LAST`.
- **(b) Store grouping.** Model semantically-related stores (e.g. the five tag junctions; the audit `StateTransition` family) as ELK compound (child) nodes inside a parent group node so related stores cluster instead of scattering.
- **(c) Edge labels.** Let ELK place the long column-list labels via its label-as-dummy-node mechanism (`edgeLabels.placement=CENTER`, `centerLabelPlacementStrategy`, label spacing), accepting the larger-drawing tradeoff — or mitigate with line-breaks / fall back to a Graphviz-style `xlabel` post-placement if size becomes unacceptable.
- **(d) Leveling integration.** Layout stays **per-diagram** (each level/figure laid out independently, as today). The leveling/balancing logic is orthogonal: it lives in the parser/validator. Auto-derived context + Level-1 are reconciled via the existing `flow.unbalanced_decomposition` pass, and drill-down is keyed by the existing dotted-number scheme.

Confidence: **medium**, not high — the capabilities are primary-sourced, but the *tuned outcome* (does partitioning + DOWN actually yield clean 5-band layouts on ignatius's dense diagrams; is the label size penalty acceptable) is not yet demonstrated. A spike against the dense diagrams (`memory-lifecycle`, `tag-administration`, a synthetic large DFD) should precede committing the full implementation.


## 5. Risks and tradeoffs

- **Drawing-size inflation.** ELK's space-reserving edge labels make dense DFDs with long column-list labels physically larger (documented ~3× at 100 vertices in the CAU Kiel thesis). Mitigate with semantic line-breaks, on-edge positioning, or a Graphviz-style `xlabel` post-layout fallback.
- **Band-constraint fragility.** `partitioning` + `layerConstraint` can behave unexpectedly when stacked with compound hierarchy or non-Partition cycle-breaking (elkjs#327, elk#623). Use partitioning as the single band lever, set cycle-breaking to model-order/Partition, and avoid combining with `layerChoiceConstraint`.
- **Bundle weight.** The GWT-compiled kernel is ~8 MB unpacked. Use the `elk-worker` build to keep it off the main thread and out of the critical-path bundle.
- **Async API.** `elkjs` `layout()` is promise-based; the current preset positioner is synchronous, so the SVG render path must become async.
- **Auto-derivation correctness.** Silent context/Level-1 generation risks mis-promoting local stores and breaking balance — keep it a reconciliation/lint pass rather than an authoritative rewrite, and surface same-logical-store naming collisions.


## 6. Open questions (for the spike / design doc)

- Does ELK partitioning + `DOWN` actually produce clean 5-band DFD layouts on ignatius's real dense diagrams, or does crossing minimization fight the band constraint enough to need per-diagram tuning? (Spike against `order-to-cash` + a synthetic large DFD.)
- Is the drawing-size inflation from space-reserving edge labels acceptable for the long column-list labels, or should labels be line-broken / truncated / moved to `xlabel`-style post-placement? (Needs real label-width measurement.)
- Can reliable auto-derivation of context + Level-1 be built from the leaf flow files given the degree≥2 store-promotion rule and same-store naming collisions, or is hand-authoring the overview (with only a balancing lint) safer? (Depends on store-naming consistency across leaves.)
- Should ELK replace **only** the DFD positioner, or also unify with the ER graph's `cytoscape-elk` path into a single ELK-based layout layer for both DG and DFD views?


## Sources

Primary:

- Ed Yourdon, *Just Enough Structured Analysis*, Ch. 9 (leveling, balancing, numbering, store promotion) — https://www.businessanalystlearnings.com/s/Yourdon-DFD.pdf
- University of Cape Town, SE course notes Ch. 6 (context = Level 0, exploded view, balancing, dotted numbering) — https://www.cs.uct.ac.za/mit_notes/software/pdfs/Chp06.pdf
- ELK Layered algorithm reference — https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
- ELK "Constraining the Model" (partitioning, layerConstraint) — https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html
- ELK edge-label placement option — https://eclipse.dev/elk/reference/options/org-eclipse-elk-edgeLabels-placement.html
- ELK node-placement strategy — https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-nodePlacement-strategy.html
- kieler/elkjs (positions-only, worker build) — https://github.com/kieler/elkjs
- CAU Kiel report 1802 + Carstens thesis (label dummy nodes, DFD motivation, size tradeoff) — https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/report-1802.pdf , https://rtsys.informatik.uni-kiel.de/~biblio/downloads/theses/jjc-mt.pdf
- Hu, label placement taxonomy — https://arxiv.org/pdf/0911.0626
- dagre wiki — https://github.com/dagrejs/dagre/wiki
- @antv/layout — https://github.com/antvis/layout
- d3-dag — https://github.com/erikbrinkman/d3-dag
- Graphviz `xlabel` — https://graphviz.org/docs/attrs/xlabel/

Secondary: Visual Paradigm DFD leveling docs; Tutorialspoint DFD balancing; draw.io DFD hierarchy blog; SvelteFlow layouting-libraries comparison.
