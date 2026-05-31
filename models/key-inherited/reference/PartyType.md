---
entity: PartyType
reference: true
group: reference
pk:
  - code
columns:
  code:
    type: text
    desc: "Enumerable code value (BUSINESS, PERSON)."
  description:
    type: text
    desc: "Human-readable label for the code."
examples:
  - code: BUSINESS
    description: Legal entity (corporation, LLC, partnership)
  - code: PERSON
    description: Natural human individual
---

# PartyType

A **PartyType** is the controlled vocabulary that splits every Party into a Business or a Person. It exists so the Business/Person distinction is a constrained, referential value — not free text that drifts into "biz", "B", or "company" across systems.

Keeping the set of kinds in its own table means new classifications are added as data, and every Party's `type` is guaranteed to resolve to a known code.
