## Verification loop (CP-3)

After writing any files, run the validate-only quality gate:
```
ignatius validate <model-root>
```

`validate` parses and validates without generating any HTML — the fast gate for
authoring loops. It prints findings to stderr and a one-line summary to stdout,
and exits non-zero when global (Class B) errors are present.

Parse stderr. Format: `<sev>  <ruleId>  <location>  <message>` (two spaces between fields).

**Rule reference table** (for reporting fix hints without grepping source):

| ruleId | Severity | Class | Title | Fix hint |
|--------|----------|-------|-------|----------|
| `parse.invalid_yaml` | error | B | Invalid YAML frontmatter | Fix YAML syntax — check indentation, unclosed brackets, invalid characters |
| `parse.missing_id` | error | B | Missing entity id | Add `entity: <EntityName>` to frontmatter |
| `parse.empty_frontmatter` | error | B | Empty frontmatter | Add at minimum `entity: <EntityName>` between the `---` fences |
| `entity.missing_pk` | warn | A | Missing primary key | Add `pk:` array with at least one column name |
| `entity.missing_columns` | warn | A | No columns defined | Add `columns:` map with at least the PK column types |
| `entity.invalid_field_type` | warn | A | Invalid field shape | `pk` must be an array of strings, `columns` must be a map — fix the field shape |
| `entity.unknown_group` | warn | A | Unknown group | Create `_groups/<name>.md` or correct the `group:` value |
| `edge.unknown_target` | error | B | Edge target not in model | Add the missing entity file or correct the `target:` name |
| `edge.dangling_fk_column` | warn | A | FK column not on source entity | Add the column to the entity's `columns` map or fix the `on:` mapping |
| `cluster.missing_basetype` | error | B | Subtype cluster basetype not in model | Add the basetype entity file or fix the basetype name |
| `cluster.missing_member` | warn | A | Subtype cluster member not in model | Add the member entity file or remove it from `members:` |
| `cluster.no_discriminator` | warn | A | Exclusive subtype cluster has no discriminator | Convert `members:` from list form to map form with discriminator values |
| `entity.example_unknown_column` | warn | A | Example row contains unknown key | Remove or rename the key — every key in an `examples:` row must be in `pk ∪ columns`. **This rule is live-server-only: `ignatius validate` never prints it.** Self-check example keys manually when writing (Step E7b); the warning only appears in the running app |

**Flow rule reference table** (`flow.*` findings appear when the model has a `flows/` directory; each maps back to a DFD authoring step in `references/dfd-authoring.md`):

| ruleId | Severity | Class | Title | Fix hint |
|--------|----------|-------|-------|----------|
| `flow.unknown_store` | error | B | `db:` store not an entity | The `db:<Entity>` name must match an existing entity id — fix the name or author the entity first (Step F4) |
| `flow.unknown_external` | error | B | `ext:` not defined | Add `flows/_externals/<Name>.md` or correct the `ext:<Name>` token (Step F3) |
| `flow.unknown_process` | error | B | `proc:` target not found | The referenced process has no file in this diagram — fix the name or author the process (Step F2) |
| `flow.illegal_connection` | error | B | Neither endpoint is a process | Every flow connects through a process — re-route the data via the process that moves it (see "How the pieces connect") |
| `flow.unknown_attribute` | warn | A | `db:` flow column not on entity | Each name in a `db:` flow's `data:` list must be in the entity's `pk ∪ columns` — fix the column name or add it to the entity (Step F5) |
| `flow.ambiguous_endpoint` | warn | A | Bare endpoint name in 2+ namespaces | Qualify the token with its prefix (`ext:`, `db:`, `proc:`, …) |
| `flow.process_to_process` | warn | A | Direct process-to-process flow | Pass the data through a store between the two processes (or silence with `flow_rules.process_to_process: false`) |
| `flow.process_no_input` | warn | A | Process has no input flows | Add at least one `inputs:` entry — every process takes data in (Step F5) |
| `flow.process_no_output` | warn | A | Process has no output flows | Add at least one `outputs:` entry — every process produces data (Step F5) |
| `flow.duplicate_number` | warn | A | Two processes share a `number:` | Renumber so each process id is unique within its diagram (Step F2) |
| `flow.unbalanced_decomposition` | warn | A | Sub-DFD boundary ≠ parent flows | Thread the same data through both levels — the child diagram's boundary flows must match the parent process's `inputs:`/`outputs:` (Step F8) |

**Loop behavior:**

- Findings present → reflect before acting. Read each finding, map it to the Q&A step that produced it, and re-ask only those steps (prior answers prefilled) rather than regenerating the whole file. Report each as: `[<sev>] <ruleId> @ <location>: <message>` + fix hint from table above.
  - Ask: "Revise the file(s) to fix these findings? (y/n)"
  - If yes: rewrite, re-run.
  - If no: leave as-is, surface findings to user, exit.
- Max 5 attempts. On attempt 5 failure: "Max attempts reached. Remaining findings: <list>. Fix manually."
- Exit code 0, no stderr lines → structurally clean, but do not stop here. Run the final self-check below before declaring done.
- Warnings (Class A) keep exit 0 but are still real findings — drive them to zero too, do not stop at "exit 0" while warnings remain.

**Final self-check (runs after a clean `validate`):**

The linter validates structure; it cannot see whether the business story was captured. Before reporting success, confirm:

1. The entity body states its purpose, and any business rules, constraints, or lifecycle the user mentioned are written down with their source and justification (Step E9). If the user gave context that did not make it into the body, add it now.
2. Each predicate reads as a true sentence in both directions (`<Parent> <fwd> <Child>`, `<Child> <rev> <Parent>`) in domain language, not a generic "has many".
3. Read the `examples:` frontmatter rows back against the rules. Does a row violate exclusivity? Can a child exist with a null parent it shouldn't? Is every row key in `pk ∪ columns` (validate will NOT check this — see the rule table)? Sample instances surface wrong rules that pass every structural check — this is the check the linter cannot perform. (Older entities may carry a prose `## Sample rows` body table instead — verify those rows the same way.)

**Flow self-check (runs whenever the write included flow files — in addition to the entity items above when entities were written too, as in a `discover` batch):**

1. Every process, external, and non-`db` store has a business body — a process with no *why* is a box with no meaning (Step F7).
2. Every process carries an `examples:` block with both `in:` and `out:` entries whose rows match the flow's `data:` labels (Step F6).
3. Every flow label is a complete data contract — a `db:` flow lists real entity columns, an `ext:`/`kind:` flow names the full payload, never a one-word summary (Step F5).
4. For any sub-DFD: the child diagram's boundary flows carry the same data as the parent process's `inputs:`/`outputs:` (Step F8).

Only when structure is clean **and** these hold: report "Verified clean — 0 findings, business context captured, sample rows consistent."

---

