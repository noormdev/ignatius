# Validation and findings


ignatius lints the parsed model and reports problems on every surface: the live viewer, the static dictionary, the static graph, and CLI stderr. The goal is to show partial information with a visible warning rather than crash or silently mislead.


## Two severity tiers


Each rule has a class that decides how a defect is handled.

| Class | Severity | Behavior |
|---|---|---|
| **A** | warning | The entity still renders, decorated with a ⚠ badge. The problem is degraded, not hidden. |
| **B** | error | The broken reference (an edge, a cluster, or an unparseable file) is omitted, and the omission is named in a global banner. |

Class B omits the broken *reference*, not the whole entity. A typo in one of three foreign keys strips that one edge; the entity stays.


## Where findings appear


- **Live viewer (`serve`)** — a collapsible findings panel in the top-right corner lists every current finding and updates on each save. Click an entity-scoped row to pan, zoom, and select the affected entity. The panel hides entirely when there are no findings.
- **Static export (`export`)** — a dismissible banner lists global errors in all three views (Graph, Dictionary, Flows). The Dictionary's affected entities get inline warning disclosures; Graph nodes get corner ⚠ badges; foreign keys to missing targets render as amber "missing" links.
- **CLI stderr** — `export` and `validate` print findings as `<severity>  <rule-id>  <location>  <message>`, errors first. The command exits `1` when any errors are present, `0` otherwise.


## Rule catalog


### Parse-time rules


These fire while reading files, before a model exists. The file is excluded from the model.

| Rule ID | Class | Meaning |
|---|---|---|
| `parse.invalid_yaml` | B | The YAML frontmatter could not be parsed. |
| `parse.missing_id` | B | The frontmatter parsed but has no `entity` field. |
| `parse.empty_frontmatter` | B | The file has `---` fences but nothing between them. |


### Entity rules


All Class A: the entity renders, flagged with a warning.

| Rule ID | Meaning |
|---|---|
| `entity.missing_pk` | `pk` is absent or empty. Cardinality falls back to dependent. |
| `entity.missing_columns` | `columns` is absent or empty. The attribute table renders empty. |
| `entity.invalid_field_type` | A field has the wrong shape (e.g. `pk` is a string, not an array). Coerced to a safe default. |
| `entity.unknown_group` | `group` references a name with no `_groups/<name>.md`. Renders without a color band. |
| `entity.example_unknown_column` | An `examples:` row has a key that is not in `pk` or `columns`. **Live server only** — `ignatius validate` never prints this rule; the warning appears in the running app. |


### Body rules


| Rule ID | Class | Meaning |
|---|---|---|
| `body.unknown_link` | A | A `[[wiki-link]]` in the body targets an entity that does not exist. The link renders as muted, non-clickable text. |


### Edge rules


| Rule ID | Class | Meaning |
|---|---|---|
| `edge.unknown_target` | B | The edge `target` is not a known entity. The edge is stripped. |
| `edge.dangling_fk_column` | A | The `on` mapping references a column missing on the source entity. The edge is kept; the source is flagged. |


### Cluster rules


| Rule ID | Class | Meaning |
|---|---|---|
| `cluster.missing_basetype` | B | The cluster's basetype is not a known entity. The whole cluster is stripped. |
| `cluster.missing_member` | A | A cluster member is not a known entity. That member is dropped; the cluster is kept. |
| `cluster.no_discriminator` | A | An exclusive cluster has no discriminator column. Inclusive clusters are exempt. |


### Flow rules


These run whenever the model has a `flows/` directory (see [Process flows](flows.md)). Findings are scoped to a diagram and process rather than an entity.

| Rule ID | Class | Meaning |
|---|---|---|
| `flow.unknown_store` | B | A `db:` store names no known entity. Edges touching it are stripped. |
| `flow.unknown_external` | B | An `ext:` token has no matching external definition. Edges are stripped. |
| `flow.unknown_process` | B | A `proc:` token names no process in the diagram. Edges are stripped. |
| `flow.illegal_connection` | B | Neither endpoint of a flow is a process. The edge is stripped. |
| `flow.unknown_attribute` | A | A `db:` flow names a column absent from the entity's `pk` and `columns`. |
| `flow.ambiguous_endpoint` | A | A bare endpoint name exists in more than one namespace — qualify it with a prefix. |
| `flow.process_to_process` | A | A direct process-to-process flow. Silenceable with `flow_rules: { process_to_process: false }` in `ignatius.yml`. |
| `flow.process_no_input` | A | A process has no input flows. |
| `flow.process_no_output` | A | A process has no output flows. |
| `flow.duplicate_number` | A | Two sibling processes declare the same `number:`. |
| `flow.unbalanced_decomposition` | A | A sub-DFD's boundary flows do not match the parent process's declared inputs and outputs. |


## Trying it out


The reference model `models/broken-demo/` is deliberately broken to exercise every surface. Serve it and watch the findings panel, or run `ignatius validate` to read the stderr output without generating any file:

```bash
ignatius serve models/broken-demo
ignatius validate models/broken-demo
ignatius export models/broken-demo -o /tmp/broken.html
```
