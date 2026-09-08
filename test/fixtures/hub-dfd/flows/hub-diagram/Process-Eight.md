---
process: Process Eight
number: 8
inputs:
  - from: db:HubStoreA
    label: hub id
    data: [id]
  - from: db:HubStoreB
    label: hub id
    data: [id]
outputs:
  - to: ext:Downstream
    label: status
    data: status
---

Reads only the two hubs.
