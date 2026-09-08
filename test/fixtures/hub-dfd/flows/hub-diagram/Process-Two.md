---
process: Process Two
number: 2
inputs:
  - from: db:HubStoreA
    label: hub id
    data: [id]
  - from: db:HubStoreB
    label: hub id
    data: [id]
  - from: db:GrantAlpha
    label: grant alpha id
    data: [id]
  - from: db:GrantBeta
    label: grant beta id
    data: [id]
outputs:
  - to: ext:Downstream
    label: status
    data: status
---

Reads both hubs plus the author-clustered grant stores as plain db: entries.
