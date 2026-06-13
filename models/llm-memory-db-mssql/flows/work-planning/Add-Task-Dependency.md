---
process: Add Task Dependency
number: 4
inputs:
  - from: ext:LLM-Agent
    data: dependency request (milestone_id, task_no, dep_milestone_id, dep_task_no, dependency_verb, reason)
  - from: db:DependencyVerb
    data: [dependency_verb]
  - from: db:Task_Dependency
    data: [milestone_id, task_no, dep_milestone_id, dep_task_no]
outputs:
  - to: db:Task_Dependency
    data: [milestone_id, task_no, dep_milestone_id, dep_task_no, dependency_verb, reason]
examples:
  in:
    - from: ext:LLM-Agent
      label: Wire task 2 as blocked by task 1 within milestone 9001
      rows:
        - { milestone_id: 9001, task_no: 2, dep_milestone_id: 9001, dep_task_no: 1, dependency_verb: blocks, reason: "Focus mode (task 2) requires SpotlightOverlay (task 1) to be renderable before it can be activated." }
    - from: db:DependencyVerb
      label: Validate verb is allowed
      rows:
        - { dependency_verb: blocks }
    - from: db:Task_Dependency
      label: Existing dependency edges checked for idempotency and cycle detection
      rows: []
  out:
    - to: db:Task_Dependency
      label: New dependency edge
      rows:
        - { milestone_id: 9001, task_no: 2, dep_milestone_id: 9001, dep_task_no: 1, dependency_verb: blocks, reason: "Focus mode (task 2) requires SpotlightOverlay (task 1) to be renderable before it can be activated." }
---

Registers a directed dependency edge between two [[Task]]s, labelled with a [[DependencyVerb]].

Before inserting, three guards run:

1. **Verb validation** — the requested `dependency_verb` must exist in [[DependencyVerb]]. Unknown verbs are rejected.
2. **Idempotency** — if an identical `(milestone_id, task_no, dep_milestone_id, dep_task_no)` row already exists, the insert is skipped and success is returned. This makes the operation safe to call multiple times.
3. **Self-reference** — a task may not depend on itself (`milestone_id = dep_milestone_id AND task_no = dep_task_no`). Rejected unconditionally.
4. **Cycle detection** — a transitive closure walk over existing [[Task_Dependency]] rows checks whether adding this edge would form a cycle. If the dependency target already transitively depends on the source, the request is rejected. The dependency graph must remain a directed acyclic graph (DAG).

Only when all guards pass is the row written. The `reason` column captures the agent's justification for the dependency, making the DAG human-readable as a planning artifact.
