# Folder model: data/ + flows/, registries at root, no underscore

## Problem

A model root mixes two parsers under one `_*`-prefix convention. Entities are
discovered by globbing `**/*.md` from the root and skipping any path segment
starting with `_` (plus the `flows/` subtree); group definitions live in
`_groups/`; the process model lives under `flows/` with reserved `_externals/`
(shared at the flows root AND redefinable per-DFD) and per-DFD `_stores/`.

Two problems follow:

- The `_*` sigil is opaque. Pickup rules are "everything not underscored, except
  `flows/`" — authors can't tell what will be scanned without knowing the rule.
- There is nowhere safe to keep free-form notes. Any non-`_` markdown the author
  drops in is silently parsed as an entity; anything they want ignored must be
  hidden behind a reserved prefix.

## Goals / Non-goals

**Goals**

- Exactly two scanned content roots: `data/` (entities) and `flows/` (DFDs).
- The three registries hoisted to the model root as plain named folders, no
  underscore: `groups/`, `externals/`, `stores/`. Each is shared/global.
- Externals and stores declared **once** at the root; no per-DFD nesting.
- Any top-level folder outside `{data, flows, groups, externals, stores}` is
  free-form and never picked up into the data graph or the flow diagrams.

**Non-goals**

- Migration tooling for existing `_*` models — deferred (separate issue per #16).
- Renaming `flows/` to `processes/` — the name is kept.
- `ignatius.yml` schema changes beyond what discovery requires (none needed).
- Back-compat reading of the old layout — see Recommendation (hard-cut).

## Approaches

| # | Approach | Sketch | Cost | Risk |
|---|----------|--------|------|------|
| A | Inside-root, keep `_` | `data/_groups`, `flows/_externals`, `flows/_stores` | low | `_*` survives — #16's goal unmet; needs name-reservation lint to separate registries from content within a root |
| B | Hoist to root, drop `_` | `groups/ externals/ stores/ data/ flows/` siblings | low | `groups/` (data metadata) sits at root not under `data/` — mild oddity |

## Recommendation

**Approach B**, decided with the user. Once the registries are top-level named
siblings, the `_` prefix does no disambiguation work — the scanner recognizes a
fixed name set and ignores everything else — so it is dropped. B is the only
option that delivers #16's stated goal ("kill the `_special` convention
completely") rather than relocating it. The cost (a `groups/` registry at the
root rather than nested under `data/`) is accepted to keep all registries
uniform and the pickup rule trivial: *five known top-level names, everything else
ignored.*

**Back-compat: hard-cut, shipped as a minor bump** (decided with the user). The
parser reads only the new layout. Old `_*`/nested models stop parsing. Rationale:
the user is currently the sole consumer, so a clean break costs nobody; a hard-cut
leaves zero `_*` code paths (a fallback would keep alive the exact thing #16
removes). Version: **minor** (`0.10.0` — 0.9.0 already shipped via #11) — the user explicitly accepts a breaking
change under a minor pre-1.0 bump and will reserve 1.0.0 for when they are ready.
Implication for the ship step: the commit is `feat(...)` with **no** `!` and **no**
`BREAKING CHANGE:` footer, so release-please cuts a minor, not a major; the
breaking nature is described in the commit body prose instead.

**Migration: a throwaway prompt, not a CLI command.** Instead of a bundled
`ignatius migrate` verb (rejected — extra surface, and #16 defers migration
tooling), the run produces `tmp/migrate-folder-model.md` — a self-contained prompt
the user can run (in another Claude session, or follow by hand) to convert any of
their own old-layout models. It is gitignored and never ships. The in-repo models
and fixtures are migrated directly as part of the implement loop.

Conceptual before/after:

```
OLD                                  NEW
model/                               model/
  ignatius.yml                         ignatius.yml
  _groups/                             groups/         <- hoisted, no _
  catalog/  identity/  …  (entities)   externals/      <- hoisted, no _, shared
  flows/                               stores/         <- hoisted, no _, shared
    _externals/        (shared)        data/           <- entities live here only
    order-to-cash/                       catalog/ identity/ …
      _stores/         (per-DFD)       flows/
      Create-Sales-Order.md              order-to-cash/
      Create-Sales-Order/  (sub-DFD)       Create-Sales-Order.md
  <free notes parsed as entities>        Create-Sales-Order/   (sub-DFD kept)
                                       notes/  <- free-form, ignored
```

## Resolved questions

- **Groups dir absent.** The parser currently throws when the groups dir is
  missing. New behavior: `groups/` is **optional** — absent means zero groups, no
  throw. Required so `broken-flows-model` (no groups) parses.
- **flows-leveling 3× `User.md` collision.** The fixture redefines the same
  `User` external at three nesting levels via the old per-DFD override. Under the
  global model there is one `User` → collapse to a single `externals/User.md`
  (keep the richest body if they differ). Fixture-only; not a real-world pattern.

## Open questions

- None blocking. Whether the historical (shipped-feature) specs that mention
  `_*` incidentally get a light find-replace or are left as dated records is a
  judgment call settled in the spec (amend only the live-contract specs).
