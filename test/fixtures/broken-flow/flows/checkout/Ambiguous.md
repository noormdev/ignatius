---
process: Ambiguous Process
number: 5
inputs:
  - from: Ambiguous
    data: bare reference
outputs:
  - to: ext:Shopper
    data: out
---

Ambiguous: uses bare "Ambiguous" endpoint which matches both ext:Ambiguous
(from _externals/Ambiguous.md) and proc:Ambiguous (this process itself) →
fires ambiguous_endpoint.
