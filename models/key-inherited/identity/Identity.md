---
entity: Identity
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "The Party whose identity documents this groups — foreign key to Party (1:1)."
subtypes:
  - exclusive: false
    desc: A Party may hold any combination of these — inclusive, existence-based
    members:
      - License
      - Passport
      - SSN
      - ITIN
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: { fwd: holds, rev: identifies }
---

# Identity

An **Identity** is the container for the government-issued documents a Party holds — license, passport, SSN, ITIN. It sits one-to-one with a Party and groups that party's proofs of identity in one place.

It exists so identity documents attach to a single, stable hub rather than scattering foreign keys across the Party record. A Party may hold any combination of documents, or none — the container is always present even when empty.

## Subtypes

The document types are an **inclusive** cluster — a Party may hold any number of them at once:

- **License**, **Passport**, **SSN**, **ITIN** — each is an optional, independently-held document. Presence is existence-based: a row exists only for the documents the party actually has.
