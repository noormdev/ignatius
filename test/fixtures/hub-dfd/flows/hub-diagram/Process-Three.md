---
process: Process Three
number: 3
inputs:
  - from: db:HubStoreA
    label: hub id
    data: [id]
  - from: db:HubStoreB
    label: hub id
    data: [id]
outputs:
  - to: db:LogStoreOne
    label: log entry
    data: [id]
  - to: db:LogStoreTwo
    label: log entry
    data: [id]
---

Reads only the two hubs; writes the same-adjacency log pair no one else touches.
