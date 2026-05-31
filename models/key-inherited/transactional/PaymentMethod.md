---
entity: PaymentMethod
group: transactional
pk:
  - party_id
  - payment_method_id
columns:
  party_id:
    type: integer
    desc: "Owning party — foreign key to Party."
  payment_method_id:
    type: integer
    desc: "Identifier of the payment method within the party."
  type:
    type: text
    desc: "Method category — foreign key to PaymentMethodType.code."
  label:
    type: text
    desc: "User-facing label (e.g. 'Visa ending 4242')."
examples:
  - party_id: 2
    payment_method_id: 1
    type: CREDIT_CARD
    label: Visa ending 4471
  - party_id: 1
    payment_method_id: 1
    type: BANK_TRANSFER
    label: Silicon Valley Bank ••1847
  - party_id: 3
    payment_method_id: 1
    type: CHECK
    label: Personal check account
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: { fwd: holds, rev: is held by }
  - target: PaymentMethodType
    on:
      type: code
    predicate: { fwd: classifies, rev: is classified by }
---

# PaymentMethod

A **PaymentMethod** is a means by which a Party can pay — a card, bank account, or check on file. It belongs to the party that holds it and is classified by a `PaymentMethodType`.

It exists as a stored, reusable record so a party can pay repeatedly without re-entering details, and so each `Payment` can point at exactly the instrument that settled it.
