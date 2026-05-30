---
entity: PaymentMethod
group: transactional
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  party_id:
    type: integer
    desc: "Owning party — foreign key to Party."
  type:
    type: text
    desc: "Method category — foreign key to PaymentMethodType.code."
  label:
    type: text
    desc: "User-facing label (e.g. 'Visa ending 4242')."
relationships:
  - target: Party
    on:
      party_id: id
    predicate: is held by
  - target: PaymentMethodType
    on:
      type: code
    predicate: is classified by
---

# PaymentMethod

A **PaymentMethod** is a means by which a Party can pay — a card, bank account, or check on file. It belongs to the party that holds it and is classified by a `PaymentMethodType`.

It exists as a stored, reusable record so a party can pay repeatedly without re-entering details, and so each `Payment` can point at exactly the instrument that settled it.
