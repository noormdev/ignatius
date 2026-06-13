---
process: Create Task
number: 2
inputs:
  - from: ext:LLM-Agent
    data: new task (milestone_id, title, content, reason)
  - from: db:Task
    data: [milestone_id, task_no]
outputs:
  - to: db:Task
    data: [milestone_id, task_no, tracking_status, agent_id, title, content, reason]
  - to: ext:LLM-Agent
    data: composite task identity (milestone_id + task_no)
examples:
  in:
    - from: ext:LLM-Agent
      label: Request to add a task to the spotlight-grid milestone
      rows:
        - { milestone_id: 9001, title: "Build SpotlightOverlay", content: "Implement the position:fixed SVG overlay component that draws bezier leader lines and off-screen chips for the DD browse-lens spotlight feature.", reason: "First building block of the spotlight grid — overlay must exist before wiring interactions." }
    - from: db:Task
      label: Existing tasks for milestone 9001 (to derive next task_no)
      rows:
        - { milestone_id: 9001, task_no: 0 }
  out:
    - to: db:Task
      label: Persisted task row
      rows:
        - { milestone_id: 9001, task_no: 1, tracking_status: not-started, agent_id: 1, title: "Build SpotlightOverlay", content: "Implement the position:fixed SVG overlay component that draws bezier leader lines and off-screen chips for the DD browse-lens spotlight feature.", reason: "First building block of the spotlight grid — overlay must exist before wiring interactions." }
    - to: ext:LLM-Agent
      label: Confirmation with composite task identity
      rows:
        - { milestone_id: 9001, task_no: 1 }
---

Adds a new [[Task]] to an existing [[Milestone]].

Task numbering is milestone-scoped: the process reads the current maximum `task_no` for the given `milestone_id` from [[Task]] and assigns `MAX(task_no) + 1`. The first task in a milestone receives `task_no = 1`. This approach keeps numbers stable — deleting a later task does not renumber earlier ones.

The task is created with `tracking_status = 'not-started'`. The `agent_id` records the creating agent. Both `milestone_id` and `task_no` are returned together, since `task_no` alone is meaningless without its parent milestone.

[[Task_Dependency]] relationships between tasks are added separately via the [[Add-Task-Dependency]] process after all relevant tasks exist.
