# SSADM data flow diagram rules — research reference


Canonical SSADM / DFD notation and rules, captured with sources during the process-flows design (`docs/design/process-flows.md`, `docs/spec/process-flows.md`). Reference material, not a contract: it records what the methodology says and where it came from, so the `ignatius flow` feature and any future flow-authoring skill can cite a single grounded source instead of re-deriving it. Where ignatius deviates from canon, the deviation is recorded in the *Adoption* table at the end.


## Elements and notation


| Element | Symbol | SSADM specifics |
|---------|--------|-----------------|
| External entity | oval / ellipse, outside the system boundary | source or sink; singular-noun name + a lowercase-letter id. All data originates from one and leaves only via one. Repeated on the page → a line across the top-left corner per occurrence. |
| Process | box in three parts | top-left = process number (id only, not a sequence); main area = description (imperative verb phrase); bottom strip = location / responsible role (physical DFDs only). Must transform data — output differs from input. |
| Data store | open-ended rectangle, two parts | left box = marker letter + number (`D1`, `M2`); main = name. Canonical markers: `D` computerised, `M` manual, `T` transient. Repeated → second vertical line on the left edge per occurrence. |
| Data flow | named directed arrow | labelled with what the data *is*. A flow between two external entities is drawn **dashed** (outside the system, shown for context only). |


## Connection legality (the hard rules)


Formal rule: **every data flow must have at least one endpoint that is a process.** Equivalent statement: information always flows to or from a process. This single rule forbids the four illegal connections:

| Connection | Legal? |
|------------|--------|
| external ↔ process | ✅ |
| process ↔ data store | ✅ |
| process ↔ process | ✅ canonically (see contested note below) |
| data store ↔ data store | ❌ neither end is a process |
| external ↔ data store | ❌ neither end is a process |
| external ↔ external | ❌ (the dashed context flow is the only exception) |

A process may not act as a pure source or sink (it must transform). Stores and externals may not connect directly to each other — a process must mediate.


## Process-to-process: contested


The canonical position **permits** process→process flows; a stricter, widely-taught variant forbids them. Both traditions are real, which is why public sources conflict. Recorded here because ignatius deliberately picks the minority position.

- **Permits:** Visual Paradigm's connection matrix lists process→process explicitly; Wikipedia's "at least one endpoint must be a process" rule is *satisfied* by a process→process flow (both ends are processes); SSADM teaching that says "data flows between processes within the system" assumes it; the UCT/SSADM textbook's four prohibitions do not include it.
- **Forbids:** a common pedagogical variant requires every flow to have exactly one process end and one non-process end, forcing data to visibly rest in a store or external between processes.

**ignatius decision:** adopt the strict variant as a *default warning* (`flow.process_to_process`, Class A), silenceable via `ignatius.yml` → `flow_rules: { process_to_process: false }`. Rationale: it surfaces where data passes untracked, but never blocks a valid SSADM diagram.


## Process well-formedness


Every process must have **at least one input and at least one output** flow. Named violations:

- **Black hole** — input(s), no output.
- **Miracle** — output(s), no input.
- **Grey hole** — output unjustifiable from the input (the input cannot produce the claimed output).


## Leveling (functional decomposition)


- **Context diagram (Level 0):** the whole system as one process box, surrounded by external entities and the flows crossing the boundary. Defines scope.
- **Level 1:** top-level DFD using all four element types. Rule of thumb ~3–7 processes (some texts allow up to ~9). More than that → group detail down a level.
- **Level 2, 3, …:** each process can be exploded into its own lower-level DFD. No fixed depth limit.
- **Elementary (bottom-level) processes:** not decomposed further; each gets an Elementary Process Description.


## Balancing (consistency between levels)


When a process is decomposed, **the flows in/out of the parent process must be preserved** as the flows crossing the boundary of the child diagram. Inputs and outputs are conserved across levels — nothing appears or vanishes. A leveled set is consistent iff every parent/child pair balances.


## Data Flow Modelling progression


The SSADM-specific lifecycle of a DFD (what distinguishes it from a one-off Yourdon/Gane-Sarson diagram). The same notation is reused across stages:

1. **Current Physical DFD** — how the existing system works, with physical detail: who/where, manual stores (`M`), document and resource flows.
2. **Logical DFD (logicalisation)** — strip the physical "how/who/where"; keep only the essential *what*. Location strips drop; manual mechanisms become logical processes.
3. **Required System DFD** — the logical model of the *new* system, including new requirements; carried into design and re-physicalised.


## Layout / readability heuristics


- One process is one transform; if a flow goes straight through unchanged, the process is probably misplaced.
- Keep flows unidirectional — two arrows for a request/response pair, not one double-headed arrow.
- Name every flow and every process.
- A store only ever read, or only ever written, across the whole leveled set usually signals a missing process.


## How ignatius adopts these


| Canonical rule | ignatius status | Mechanism |
|----------------|-----------------|-----------|
| External / process / store / flow elements | adopted | `FlowExternal`, `FlowProcess`, `FlowStoreRef`, `FlowEdge` |
| Store markers `D`/`M`/`T` | extended | `D` (db, ERD-linked), `C` cache, `Q` queue, `F` file, `Do` doc, `M` manual — per-kind markers so the resting place is visible |
| At-least-one-process-endpoint | adopted | `flow.illegal_connection` (Class B): store↔store, ext↔store, ext↔ext |
| Process→process permitted | inverted to a warning | `flow.process_to_process` (Class A, silenceable) |
| Black hole / miracle | adopted | `flow.process_no_input` / `flow.process_no_output` (Class A) |
| Store / external / process existence | adopted + extended | `flow.unknown_store` (db only) / `flow.unknown_external` / `flow.unknown_process` (Class B) |
| Attribute-level flows vs the data model | ignatius-specific keystone | `flow.unknown_attribute` (Class A): a `db:` flow's column list checked against the entity — the DFD as a demand list on the ERD |
| Flow line style (solid arrow; direction = read/write; dashed only for ext↔ext context) | adopted | all flows render as one uniform solid arrow, direction conveys read vs write; the ext↔ext dashed context flow never occurs (ext↔ext is illegal — see above). An earlier dashed-read/solid-write invention was removed (2026-06-06). |
| Leveling / decomposition | adopted (structural) | process file + same-named folder = sub-DFD, drill-down |
| Balancing | adopted as a soft warning | `flow.unbalanced_decomposition` (Class A) — set-diff, not hard enforcement |
| Current-physical → logical → required progression | deferred | out of scope for v1 |
| Logicalisation, ELH, LDS | not planned | LDS is already the ERD; ELH out of scope |


## Sources


- [Elements of data-flow diagrams — UCT Software Engineering notes, Ch.6](https://www.cs.uct.ac.za/mit_notes/software/htmls/ch06s05.html)
- [Decomposing diagrams into lower levels — UCT, Ch.6](https://www.cs.uct.ac.za/mit_notes/software/htmls/ch06s08.html)
- [DFD Principles — UWE (Drewry)](http://www.cems.uwe.ac.uk/~kg-doyle/tdrewry/dfds.htm)
- [Data Flow Diagram Connection Rules — Visual Paradigm](https://www.visual-paradigm.com/support/documents/vpuserguide/1284/992/36119_dataflowdiag.html)
- [Data-flow diagram — Wikipedia](https://en.wikipedia.org/wiki/Data-flow_diagram)
- [Rules for Data Flow Diagram — GeeksforGeeks](https://www.geeksforgeeks.org/software-engineering/rules-for-data-flow-diagram/)
- [SSADM overview & DFD physical/logical — ConceptDraw](https://www.conceptdraw.com/How-To-Guide/ssadm)
