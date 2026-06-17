---
entity: Party
group: auth
pk:
  - party_id
columns:
  party_id:
    type: integer
    desc: "Unique identifier for the party."
---

A Party is a principal in the authentication system — any actor who authenticates through the auth flow.
