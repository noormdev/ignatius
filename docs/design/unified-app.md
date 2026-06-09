# Unified single-page app — collapse graph / dict / flow into one React surface


## Problem


Today ignatius ships what the user perceives as "three apps":


| Surface | Tech | Live route | Static CLI | Nav in/out |
|---------|------|-----------|-----------|-----------|
| ERD graph | React + Cytoscape | `/` (index.html) | `graph -o g.html` | `href` full reload |
| Data dictionary | **JS-less HTML string** (`generateDict`, 1820 L) | `/dict` | `dict -o d.html` | `href` full reload |
| Flow (DFD) | React + custom SVG | `/flow` | `flow -o f.html` (+ sibling `.dict.html`) | `href` full reload |


Plus a fourth, half-hidden surface: the flow **process** dictionary (`generateFlowDict`, 923 L), another JS-less HTML string at `/flow-dict`.


Reality is subtler than "three apps": the ERD and Flow viewers already share **one** compiled bundle, dispatched by `window.__IGNATIUS_SURFACE__` — but they load as **separate full pages** with `href` navigation between them. The two dictionaries are the true outliers: server-rendered HTML strings with no React, no client interactivity.


Costs of the split:


- **Three page loads, three boots.** Switching graph → dict → flow is a full reload each time.
- **Two dictionaries, two generators.** `generateDict` (entities) and `generateFlowDict` (processes) are parallel string builders with their own CSS, theme vars, findings panels, and FABs — duplicating chrome the React app already owns, and forcing a reader to open two pages to see "the model's reference".
- **A `db:` store in a DFD is a data entity, but only shows plain markdown.** The flow viewer's ⓘ dialog renders a store's markdown body — even though that store *is* an ERD entity with a far richer dialog (attributes, child relationships, sample values) already built for the graph.
- **CLI surface sprawl.** `graph` / `dict` / `flow` each emit a file; `flow` emits two. "The model" is four HTML files.


## Goals / Non-goals


**Goals**


- One React app. `serve` renders a single page; **Graph**, **Dictionary**, and **Flows** are in-app views switched without a reload.
- **The Dictionary is one inline, fully-laid-out, searchable reference page that fuses the entity data dictionary and the flow process dictionary.** Entities, processes, external entities, and data stores are all rendered *in full* on a single page. Keep the current data-dictionary format for entity data; extend that same laid-out style to the process-model things. A React search box filters the page live across titles, descriptions, properties, and data types; navigation is anchor-tag links. **No dialogs on this page** — the point of a dictionary is to see everything at once, nothing hidden.
- **The rich entity dialog is reused for data entities wherever they appear.** A graph node tap opens it (today); a **`db:` store node in a DFD** opens the *same* dialog (attributes, child relationships, descriptions, example values) instead of plain markdown. Every non-entity flow node (process, external, non-`db` store) keeps the plain markdown ⓘ dialog.
- One static artifact. A single `export -o model.html` self-contained file carries all three views offline; it **replaces** `graph` / `dict` / `flow`.
- Shared chrome across views: the entity dialog, theme toggle, branding, findings panel, FAB — mounted once, not re-implemented per surface. **Branding and the FAB use the ERD graph's version** (the more elaborated one) as canonical, replacing the flow viewer's separate `FlowChrome` variants. **Theme config works on all three views, including DFDs** — the flow SVG stylesheet ignores theme today and must consume the same theme vars.
- Keep every engine already built: parse, validate, fingerprint, position persistence, drill-down, the flow markdown doc dialogs, predicates, AK markers.


**Non-goals**


- No router library. Extend the hand-rolled `src/hash-router.ts`; do not add `react-router`.
- No second compiled bundle.
- No redesign of the Cytoscape ERD renderer, the flow SVG renderer, validation rules, or the markdown/`ignatius.yml` authoring format.
- No redesign of the inline dictionary *format* — keep the current data-dictionary layout for entities and apply the same laid-out style to processes/externals/stores.


## Conceptual model


**One model, two ways to read it: spatial surfaces with rich dialogs, and one flat searchable reference.**


The entity model and the flow model load once. Three views project that data:


- **Graph** — the Cytoscape ERD. A node is a data entity; tapping it opens the rich entity dialog.
- **Flows** — the DFD viewer. A `db:` store node is a data entity → its ⓘ badge opens the **same** rich entity dialog. A process / external / non-`db` store → its ⓘ badge opens the plain markdown doc dialog.
- **Dictionary** — one flat page fusing both dictionaries: every entity (full inline detail), every process, external, and data store, all laid out, filtered by a live search box, cross-linked by anchors. No dialogs here.


The rich entity dialog is **app-level shared chrome**, reachable from any spatial surface that shows a data entity (graph node, `db:` store). Plain markdown is the fallback for everything that is not an entity. The Dictionary is the exhaustive reference you scan and search, not click into.


```mermaid
flowchart TD
  subgraph load["Load once"]
    M["entity model + findings"]
    F["flow model + layout keys"]
  end
  load --> APP["App() — single mount"]
  APP --> R["view state ↔ #view= hash"]
  R -->|graph| G["Cytoscape ERD"]
  R -->|dict| D["Dictionary — one flat searchable page<br/>(entities + processes + externals + stores)"]
  R -->|flow| FL["Flow SVG viewer"]
  G -->|tap entity node| DLG["Rich entity dialog (shared)"]
  FL -->|ⓘ on db: store = entity| DLG
  FL -->|ⓘ on process / external / non-db store| MD["Markdown doc dialog"]
  MD -->|[[Entity]] link| DLG
  MD -->|[[flow node]] link| MD
  D -->|anchor links| D
```


Caption: data entities (graph nodes, `db:` stores) open the one rich dialog; non-entity flow nodes open markdown; the Dictionary is a flat, searchable, anchor-linked page with no dialogs.


## Approaches


| # | Approach | Sketch | Pros | Cons |
|---|----------|--------|------|------|
| A | **In-app view router (recommended)** | `view` state + `#view=` hash; one mount; build/teardown active renderer; Dictionary is a React inline page fusing both dictionaries with live search; rich entity dialog lifted to app level and reused by `db:` stores; one `export` injects both models | True SPA; one fused reference; entity dialog reused, not re-built; one static file | Renderer lifecycle on switch; porting two string generators to inline React; test/doc churn |
| B | Iframe-host the dicts | SPA shell + `<iframe src="/dict">` / `/flow-dict` | Smallest dict change | Not one app; breaks offline `export` (iframe needs a server); theme/SSE desync; can't fuse the two dicts or share the entity dialog |
| C | Three routes, shared header | keep full pages, unify only nav styling | minimal code | doesn't meet the ask; still four boots, two dicts |
| D | Micro-frontend shell | module federation host + remotes | "proper" SPA | massive over-engineering; violates no-router/no-second-bundle |


## Recommendation


**Approach A.** It is the only one that satisfies the locked decisions: full collapse to one `export`; one fused, dialog-free, searchable Dictionary; the rich entity dialog reused for `db:` stores.


Leverage points that bound the cost:


- **The rich entity dialog already exists** (`SelectedEntityModal`) and renders attributes, child relationships, descriptions, and sample values. Reusing it for `db:` stores is wiring, not new UI — and the dialog is being lifted to app level anyway.
- **The fused Dictionary is mostly a mechanical port.** The two string generators already produce the exact inline layout we want; porting them to JSX (and dropping their duplicated chrome/theme/findings, which the app already owns) yields *less* code, and a search filter over rendered sections is a small addition.
- **Renderer lifecycle** (the real cost of A) is bounded: the flow viewer already builds/tears down on diagram swap, and the ERD already tears down Cytoscape + navigator on unmount (the minimap-leak fix on this branch proves the teardown path). View switching reuses those paths.


Sequencing keeps every checkpoint green: unify graph↔flow nav and lift shared chrome first; shared data load; Dictionary entity section; fuse the process-model section; reuse the entity dialog for `db:` stores; the `export` command; route + test/doc cleanup. Old surfaces keep working until their replacement lands.


## Rejected, with reasons


- **Iframe-hosted dicts (B).** A second document defeats the goal: it can't fuse the two dictionaries into one searchable page, can't share the entity dialog, desyncs theme/SSE, and breaks offline `export` (an iframe `src` needs a server). Rejected.
- **Keep the string generators as-is (C).** Leaves two dictionaries on two pages and the `db:` store stuck on plain markdown. Rejected.
- **Micro-frontend shell (D).** Contradicts the single-bundle, no-router constraints. Rejected.


## Backward-compatibility


Full collapse breaks `ignatius dict|graph|flow -o …` scripts and any `dict.html` / `flow.html` deep links. The repo is pre-1.0 (0.6.0) so a break is defensible, but a silent one is hostile.


**Decision: hard-remove the three subcommands with a helpful error**, not deprecated aliases. An alias can only *delegate to `export`*, which produces a **different artifact** — one `model.html`, not the old `graph.html` + `dict.html` + `flow.html` + `flow.dict.html`. A `dict` command that silently emits a unified file is *more* surprising than a clear `dict was removed — use: ignatius export -o model.html` error. The alias's apparent value (script compatibility) is illusory because it cannot reproduce the old per-surface outputs. (User may veto in favor of aliases.)


## Open questions


- **Merge `/api/model` + `/api/flow`?** One endpoint returning `{ model, flow, validation, layoutKeys }` is cleaner for a single boot, but two endpoints already work, and CP3's shared findings state covers the `db:`-store dialog's need for entity findings. Lean: keep two, co-fetch on boot — smaller diff. Revisit if SSE refresh races.
- **Default view + dialog in the hash.** Default `view=graph`. The hash carries `view` + `entity`; opening an entity from the Dictionary's anchor is in-page scroll, not a dialog. Resolved.


## Resolved (carried into the spec)


- **Dictionary mount model** — keep-mounted React subtree; search text + scroll survive a detour to another view and back. The two spatial renderers build/teardown on switch (the proven, leak-hardened path); keep-all-mounted was rejected for them (a `display:none` Cytoscape container has zero dimensions and needs a forced resize on re-show).
- **Render-effect re-key is a structural rework, not a "switch."** The flow-init, ERD-validate, and ERD-build effects are mount-once and `__IGNATIUS_SURFACE__`-gated; CP1 re-keys them to `view` state and hoists the data/SSE effect to survive switches. Named as a known cost, not an open question.
- **`db:` store → entity dialog is a data-shape change.** The current resolver returns a markdown-reduced `FlowDoc`; the dialog needs a full `ModelNode` + entity findings. CP6 builds a new resolution path and plumbs entity findings into the flow surface.
