---
process: Login
number: 1
inputs:
  - from: ext:User
    data: credentials
  - from: db:Party
    data: [party_id]
outputs:
  - to: db:Party
    data: [party_id]
---

Verifies user credentials and establishes a login context.
