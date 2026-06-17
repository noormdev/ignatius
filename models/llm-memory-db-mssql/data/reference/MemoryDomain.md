---
entity: MemoryDomain
group: reference
pk:
  - domain
columns:
  domain:
    type: text
    desc: "Code identifying the broad subject area a memory belongs to"
reference: true
examples:
  - { domain: coding }
  - { domain: architecture }
  - { domain: preferences }
---

# MemoryDomain

Controlled vocabulary of broad subject areas used to classify long-term memories stored in the agent memory system, such as coding practices, architectural decisions, and user preferences.
