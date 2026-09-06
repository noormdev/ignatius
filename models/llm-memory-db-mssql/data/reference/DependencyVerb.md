---
entity: DependencyVerb
group: reference
description: Controlled vocabulary of edge labels (blocks, requires, follows) for the task dependency graph.
pk:
  - dependency_verb
columns:
  dependency_verb:
    type: text
    desc: "Code describing the directional relationship type between two tasks in the dependency graph"
reference: true
examples:
  - { dependency_verb: blocks }
  - { dependency_verb: requires }
  - { dependency_verb: follows }
---

# DependencyVerb

Controlled vocabulary of edge labels for the [[Task_Dependency]] graph, describing how one task relates to another — whether it blocks, requires, or follows the target task.
