---
process: Verify Token
number: 1
inputs:
  - from: ext:User
    data: credentials
  - from: db:Party
    data: [party_id]
outputs:
  - to: proc:CreateSession
    data: auth context
---

Verifies the token and passes auth context to CreateSession.
The proc:CreateSession flow is sibling-internal and must NOT appear in boundary columns.
