## Verification loop (CP-3)

After writing any files, run:
```
ignatius dict <model-root> -o /tmp/ignatius-skill-check.html
```

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

**Loop behavior:**

- Findings present → reflect before acting. Read each finding, map it to the Q&A step that produced it, and re-ask only those steps (prior answers prefilled) rather than regenerating the whole file. Report each as: `[<sev>] <ruleId> @ <location>: <message>` + fix hint from table above.
  - Ask: "Revise the file(s) to fix these findings? (y/n)"
  - If yes: rewrite, re-run.
  - If no: leave as-is, surface findings to user, exit.
- Max 5 attempts. On attempt 5 failure: "Max attempts reached. Remaining findings: <list>. Fix manually."
- Exit code 0, no stderr lines → structurally clean, but do not stop here. Run the final self-check below before declaring done.

**Final self-check (runs after a clean `dict`):**

The linter validates structure; it cannot see whether the business story was captured. Before reporting success, confirm:

1. The entity body states its purpose, and any business rules, constraints, or lifecycle the user mentioned are written down with their source and justification (Step E9). If the user gave context that did not make it into the body, add it now.
2. Each predicate reads as a true sentence in both directions (`<Parent> <fwd> <Child>`, `<Child> <rev> <Parent>`) in domain language, not a generic "has many".
3. For any entity with a mandatory parent (non-null FK) or a subtype cluster: sketch 2–3 sample rows and read them back against the rules. Does a real row violate exclusivity? Can a child exist with a null parent it shouldn't? Sample instances surface wrong rules that pass every structural check — this is the check the linter cannot perform. If the body has a `## Sample rows` section, verify the rows actually satisfy the stated rules.

Only when structure is clean **and** these hold: report "Verified clean — 0 findings, business context captured, sample rows consistent."

---

