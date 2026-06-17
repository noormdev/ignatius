---
entity: License
group: identity
pk:
  - id
columns:
  id:
    type: integer
    desc: "Surrogate primary key."
  identity_id:
    type: integer
    desc: "Owning party's Identity container — foreign key to Identity."
  license_number:
    type: text
    desc: "Driver's license number."
  issuing_state:
    type: text
    desc: "US state that issued the license."
  issued_on:
    type: date
    desc: "Date the license was issued."
  expires_on:
    type: date
    desc: "Date the license expires."
ak:
  - rule: license number unique within state
    columns:
      - license_number
      - issuing_state
  - rule: one License per Identity
    columns:
      - identity_id
examples:
  - id: 1
    identity_id: 1
    license_number: V7423091
    issuing_state: CA
    issued_on: "2019-06-15"
    expires_on: "2027-06-15"
  - id: 2
    identity_id: 2
    license_number: TXD-884-2200
    issuing_state: TX
    issued_on: "2021-02-08"
    expires_on: "2029-02-08"
relationships:
  - target: Identity
    on:
      identity_id: id
    predicate: is a
---

# License

A **License** is a driver's license held by a Party, recorded as one of the identity documents under its `Identity` container. It captures the license number, the issuing state, and the validity window.

It is modeled separately because a license carries fields no other document does — issuing state and an expiry the business may need to act on (lapsed-license checks, renewals).

## Business rules

- **License number is unique within a state** — the same number may recur across states, but not within one.
- **Expires after it is issued** — the expiry date must fall after the issue date.
