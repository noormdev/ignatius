---
id: schema-validation-linter-error-ux
title: Schema validation/linter + entity & global error UX in the viewer
created: "2026-05-30"
origin: |
    recovered from session cd4c9886 transcript via /atomic-improve 2026-05-30; originally requested mid-build, never filed
severity: question
review_by: "2026-07-29"
status: open
---

User request (verbatim, recovered from cd4c9886 transcript):

"Focus on failure modes and what happens when you have an incomplete schema, or schemas that are not properly configured. This might mean we need a linter of some sort to validate what the user is doing and maybe show them an [error] if something is off — maybe show an exclamation-point triangle when an entity is not properly configured, in a way where when you click on that warning triangle it tells you exactly what's wrong or what's missing. It should still render if something is incomplete, but render incorrectly; or if it's something that's going to break, it should be omitted and there should be a global error. So you'd have two errors: a global error (something went wrong in your parsing) and an entity error (something is misconfigured only for this entity)."

Scope:
- Linter/validator over parsed model: detect incomplete / misconfigured entities.
- Two-tier error model: global parse error vs per-entity error.
- Viewer UX: clickable warning triangle on misconfigured entities → explains what's missing.
- Render-on-incomplete behavior: render incrementally; omit + global-error the breaking cases.

User asked to write specs/designs for this FIRST. Run /atomic-plan before implementing.

---

## Strategist enrichment (2026-05-30, opus, read-only)

### Core gap: bad data reaches Cytoscape and white-screens

`parseModels()` assumes well-formed input. The crash surface is **split between parser and renderer**: the parser throws only on structural-YAML problems; renderers throw on semantic problems the parser let through. There is no validation gate before `cytoscape()` (`App.tsx:633`, no try/catch, no ErrorBoundary). This is the central thing to fix.

### Current failure behavior (gap map) — verified against parse.ts / App.tsx / dict.ts

| Malformed input | What happens now | Evidence | Class |
|---|---|---|---|
| No `---` frontmatter fence | throws `'No YAML frontmatter found'` → whole model fails | parse.ts:84 | global |
| Empty frontmatter (`parseYaml('')→null`) | TypeError reading `.entity` off null → whole model fails | parse.ts:87,184 | global |
| Missing `pk` | `undefined` stored; **deferred crash** in dict.ts:41/122, App.tsx:275/930 | parse.ts:188 | needs default |
| Missing `columns` | `undefined`; crashes dict.ts:43, App.tsx:270 | parse.ts:189 | needs default |
| **FK to nonexistent target entity** | parser doesn't validate (fallback keyed on `source`, not `target`); **Cytoscape throws → viewer white-screens**; dict tolerates (dead anchor) | parse.ts:222-229; App.tsx:609-633 | **omit+global** |
| Dangling FK *column* in `on` | optional-chained → silently treated non-nullable → wrong cardinality, no error | parse.ts:116 | degrade+warn |
| Subtype cluster, basetype absent | built anyway; viewer builds joiner from missing node → Cytoscape throws | parse.ts:203-215; App.tsx:577 | **omit+global** |
| Subtype, no discriminator col | not checked; discriminator dropped at parse (only `Object.keys` kept) | parse.ts:205-207 | degrade+warn |
| `sort_key` non-number | throws WITH entity context — the only existing field-level validation | parse.ts:154-156 | (existing) |
| Unknown `classification` | dict → neutral grey badge; viewer → unstyled node. No error — already the desired degrade. | dict.ts:19-22; App.tsx:158 | benign |

**Two cross-cutting findings:** (1) **classification casing is inconsistent** — parse.ts:106 + App.tsx:158 capitalize, dict.ts:15 lowercases, dict.ts:174 uses `kernel` (not in `KNOWN_CLASSIFICATIONS`). A validator must pick one canon or false-positive. (2) The two-tier model implicitly assumes validation runs *before* render — today there's no such gate.

### Render-vs-omit boundary (crisp rule)

**If the defect can be represented as a node/edge without throwing a consumer → Class A (render degraded + entity warning triangle). If rendering requires referencing something that doesn't exist → Class B (omit + global error).** Dangling-reference = omit; missing-own-data = degrade.

- **Class A (render + triangle):** missing columns (default `{}`), missing pk (default `[]`), unknown classification, dangling FK *column*, nonexistent `group` ref, subtype w/o discriminator.
- **Class B (omit + global banner):** FK to nonexistent *target* (omit the **edge**, keep the source entity), subtype cluster w/ absent basetype (omit joiner wiring), unparseable frontmatter (omit entity — must be caught *inside* the parse loop, parse.ts:181, since there's no Model yet).

Subtlety to confirm: "omit it" = omit the broken **reference/edge**, not the whole entity (dropping an entity because one of 3 FKs has a typo is too destructive).

### Two-tier error model + rule-ID registry

- **Entity error** carries `{ entityId, ruleId, severity:'warning', message }`. Viewer: triangle glyph on node → click selects entity, opens existing detail panel (App.tsx:915+) with a validation section (no new modal needed). Dict: warning badge in entity header (dict.ts:117).
- **Global error** carries `[{ ruleId, omitted:{kind,id}, reason }]`. Surfaced as ONE dismissible top banner (omitted things aren't on the diagram to attach a triangle to), rendered *instead of* white-screening.
- **Rule-ID registry** (`ruleId → {title, explanation, tier}`, namespaced `entity.*`/`edge.*`/`cluster.*`/`parse.*`) is the linchpin — powers both the click→explanation UX and a future CI linter. Keep IDs stable.

### Validation as a shared layer (recommendation, high confidence)

**Standalone pass over the parsed Model, not inline in parse.ts:** `validateModel(model) → { entityErrors, globalErrors, cleanedModel }` (cleanedModel has Class-B stripped). Why: (1) three consumers (viewer, dict, future CI linter) need the same verdicts; the static `graph` output injects `window.__MODEL__` (App.tsx:406) and never re-runs `parseModels`, so a viewer-side pass can re-validate the injected model — inline-parse can't. (2) Pure `Model→errors` is unit-testable with hand-built literals (matches `test/checks/` idiom). (3) Dangling-target detection needs the full node set (`nodeMap` only complete at parse.ts:219). **One exception stays in parse.ts:** unparseable frontmatter — wrap parse.ts:181, record a `parse.*` global error, skip the file instead of rejecting the whole promise. That's the single non-additive control-flow change.

### Open questions

1. Omit-edge vs omit-entity for dangling FK target? (recommend edge-only).
2. parse.ts changes control flow (catch per-file YAML failure in scan loop) — in scope? (required).
3. Default `pk`/`columns` to `[]`/`{}` in parse (one change, unblocks 5 consumers) vs harden each consumer? Changes the parsed-model contract (`pk: string[]` currently required, parse.ts:18).
4. Canonical classification casing — pick one (likely lowercase per dict.ts:15) or fix inconsistency in a separate PR first.
5. `_meta.yaml` / `_branding.yaml` malformed → in scope or deferred?
6. Static-output posture: fail the build on Class-B (CI linter) or embed banner (viewer)? Likely embed for `graph`, `--strict` flag for CI.

### Scope boundaries

- No validation DSL / lint config file — rules are code against the `Model` type.
- No autofix / suggestions — report, don't rewrite the user's markdown.
- Don't touch `_groups`/`_theme`/`_branding` optionality (working-as-intended).
- Don't redesign `deriveCardinality` — it stays total; flag the *inputs* that make its output untrustworthy, don't add an "unknown" cardinality.
- No separate CLI `lint` subcommand this pass (but design the layer so one drops in without refactor — a 4th subcommand alongside serve/dict/graph is a clean follow-up).
- No per-edge triangles in v1 — node triangles + global banner cover the stated UX.

Pairs with [[model-validation-test-suite]] — the validator's rule IDs are what those tests assert against.
