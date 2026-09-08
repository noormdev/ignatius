---
process: Process One
number: 1
inputs:
  - from: db:SubA
    data: [id]
  - from: db:SubB
    data: [id]
outputs:
  - to: ext:Downstream
    data: status
---

Reads only the two subtypes; the basetype Base is never touched by any flow.
