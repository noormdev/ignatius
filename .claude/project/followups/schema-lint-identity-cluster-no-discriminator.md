---
id: schema-lint-identity-cluster-no-discriminator
title: Identity cluster fires cluster.no_discriminator — array-form members
created: "2026-05-30"
origin: |
    docs/spec/schema-lint-and-error-ux.md, CP-2 (commit 244d723); user deferred at Phase 3
severity: risk
review_by: "2026-07-29"
status: open
file: models/identity/_groups/identity.md
---

The Identity subtype cluster declares members in array form (`members: [Person, Organization, ...]`) rather than the object form that carries discriminator values. The validator emits `cluster.no_discriminator` because hasDiscriminator is false.

Decide one of:
- Convert Identity members to object form with explicit discriminator values
- Accept array form as intentionally-discriminator-less authoring (some clusters genuinely have no single discriminator column)
- Loosen the rule predicate to fire only when array form AND the basetype has no clearly-discriminating column

Surfaced from CP-2 real-models sanity check.
