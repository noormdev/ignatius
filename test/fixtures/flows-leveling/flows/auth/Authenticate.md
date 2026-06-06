---
process: Authenticate
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

Handles authentication. Delegates to Login sub-process.
