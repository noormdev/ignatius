---
entity: MemoryCategory
group: reference
pk:
  - category
columns:
  category:
    type: text
    desc: "Code identifying the epistemic kind of a memory entry"
reference: true
examples:
  - { category: fact }
  - { category: decision }
  - { category: convention }
---

# MemoryCategory

Controlled vocabulary for the epistemic kind of a memory entry — whether it records an observed fact, a design decision, a convention, or a gotcha to avoid.
