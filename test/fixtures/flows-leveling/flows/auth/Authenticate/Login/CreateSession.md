---
process: Create Session
number: 2
inputs:
  - from: proc:VerifyToken
    data: auth context
  - from: db:Party
    data: [party_id]
outputs:
  - to: db:Party
    data: [party_id]
---

Creates a session record after successful token verification.
