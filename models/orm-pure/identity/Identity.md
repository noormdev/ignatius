---
entity: Identity
group: identity
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  party_id:
    type: integer
    desc: "The Party whose identity documents this groups — foreign key to Party (1:1)."
ak:
  - rule: one identity container per party
    columns:
      - party_id
relationships:
  - target: Party
    on:
      party_id: id
    predicate: identifies
---

# Identity

An **Identity** is the container for the government-issued documents a Party holds — license, passport, SSN, ITIN. It sits one-to-one with a Party and groups that party's proofs of identity in one place.

It exists so identity documents attach to a single, stable hub rather than scattering foreign keys across the Party record. A Party may hold any combination of documents, or none — the container is always present even when empty.

## Subtypes

The document types are an **inclusive** cluster — a Party may hold any number of them at once:

- **License**, **Passport**, **SSN**, **ITIN** — each is an optional, independently-held document. Presence is existence-based: a row exists only for the documents the party actually has.
