---
entity: User
group: core
pk:
  - user_id
columns:
  user_id:
    type: integer
    desc: "User surrogate key."
  email:
    type: text
    desc: "Login email."
subtypes:
  - exclusive: true
    desc: "Every User is exactly one of these subtypes."
    members:
      - Admin
      - Guest
      - Ghost
---

**User** — triggers two cluster rules at once.

`cluster.no_discriminator` (Class A) — the `members` are declared as a plain array, not the object form that carries discriminator column/value pairs. The basetype is decorated with a ⚠ triangle whose detail explains the missing discriminator.

`cluster.missing_member` (Class A) — the array references `Ghost`, an entity that does not exist in the model. `Ghost` is dropped from `cleanedModel.subtypeClusters[i].members` so the graph still renders the cluster with its valid members, and the basetype carries another finding.
