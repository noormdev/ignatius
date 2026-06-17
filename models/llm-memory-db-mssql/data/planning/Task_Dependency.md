---
entity: Task_Dependency
group: planning
pk:
  - milestone_id
  - task_no
  - dep_milestone_id
  - dep_task_no
columns:
  milestone_id: { type: integer, desc: "Dependent task — milestone part of the composite FK" }
  task_no: { type: integer, desc: "Dependent task — task_no part of the composite FK" }
  dep_milestone_id: { type: integer, desc: "Prerequisite task — milestone part of the composite FK" }
  dep_task_no: { type: integer, desc: "Prerequisite task — task_no part of the composite FK" }
  dependency_verb: { type: text, desc: "Semantic label for this dependency edge (blocks, requires, follows)" }
  reason: { type: text, desc: "Explanation of why this dependency exists" }
  created_at: { type: datetime, default: now, desc: "Row creation timestamp" }
relationships:
  - target: Task
    on: { milestone_id: milestone_id, task_no: task_no }
    predicate: { fwd: is the dependent in, rev: depends through }
  - target: Task
    on: { dep_milestone_id: milestone_id, dep_task_no: task_no }
    predicate: { fwd: is depended upon in, rev: targets }
  - target: DependencyVerb
    on: { dependency_verb: dependency_verb }
    predicate: { fwd: labels, rev: is labeled by }
examples:
  - { milestone_id: 9001, task_no: 2, dep_milestone_id: 9001, dep_task_no: 1, dependency_verb: requires, reason: "Focus mode wiring requires the SpotlightOverlay component to exist first." }
  - { milestone_id: 9002, task_no: 1, dep_milestone_id: 9001, dep_task_no: 2, dependency_verb: follows, reason: "DD sidebar nesting work follows completion of the spotlight grid milestone." }
  - { milestone_id: 9001, task_no: 2, dep_milestone_id: 9002, dep_task_no: 1, dependency_verb: blocks, reason: "Hierarchical nesting blocks releasing focus mode to users." }
---

# Task_Dependency

A Task_Dependency is a directed edge in the task dependency graph, recording that one [[Task]] depends on another via a semantic [[DependencyVerb]] (blocks, requires, follows).
Both endpoints are composite keys inherited from [[Task]], making this an associative entity over the self-referential relationship.
