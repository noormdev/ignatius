---
entity: Party
group: identity
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Unique identifier for the party."
  type:
    type: text
    desc: "Party kind — foreign key to PartyType.code (Business or Person)."
subtypes:
  - exclusive: true
    desc: Every Party is exactly one of Business or Person
    members:
      Business:
        type: PartyType.code.BUSINESS
      Person:
        type: PartyType.code.PERSON
relationships:
  - target: PartyType
    on:
      type: code
    predicate: is classified by
---

# Party

A **Party** is any individual or organization the business transacts with — every customer, vendor, employee, and partner. It is the identity spine the rest of the model hangs off: orders are placed by a Party, invoices are owed by a Party, payment methods are held by a Party.

Modeling everyone as one Party — rather than separate Customer, Vendor, and Employee tables — means a real-world entity is represented exactly once. The same company can be both a customer and a vendor without duplicating its identity, and a person who is an employee today and a customer tomorrow keeps one continuous record.

## Subtypes

Every Party is exactly one of two kinds — mutually exclusive and total:

- **Business** — a legal entity (corporation, LLC, partnership), where `type = PartyType.code.BUSINESS`.
- **Person** — a natural person, where `type = PartyType.code.PERSON`.

The Party record holds what is common to both; the subtype holds what is specific — legal name and tax id for a Business, given and family name and birthdate for a Person.
