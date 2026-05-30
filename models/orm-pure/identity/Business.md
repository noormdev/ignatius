---
entity: Business
group: identity
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  party_id:
    type: integer
    desc: "The Party this business is — foreign key to Party."
  legal_name:
    type: text
    desc: "Registered legal name of the business."
  tax_id:
    type: text
    desc: "Government tax identifier (e.g. EIN); unique."
ak:
  - rule: unique tax identifier
    columns:
      - tax_id
  - rule: one Business per Party
    columns:
      - party_id
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is a
---

# Business

A **Business** is the specialization of a Party that is a legal entity — a corporation, LLC, or partnership. It carries the attributes that only make sense for an organization: a registered legal name and a government tax identifier.

It exists as its own entity so those organization-only fields live where they belong, instead of nulling them out on every Person record. A Business shares its identity with its Party — it does not invent a new one.

## Business rules

- **Tax id is unique** — no two businesses may share the same government tax identifier.
