---
entity: Base
pk:
  - id
columns:
  id:
    type: integer
subtypes:
  - exclusive: false
    desc: SubA and SubB share the Base identity spine.
    members:
      - SubA
      - SubB
---

Base.
