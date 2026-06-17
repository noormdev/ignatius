---
entity: StateTransitionType
group: reference
pk:
  - state_transition_type
columns:
  state_transition_type:
    type: text
    desc: "Code identifying which entity and state dimension a transition journal entry belongs to"
reference: true
examples:
  - { state_transition_type: milestone-tracking }
  - { state_transition_type: task-tracking }
  - { state_transition_type: memory-relevance }
---

# StateTransitionType

Controlled vocabulary that classifies audit journal entries by which entity type and state dimension changed — for example, a milestone's tracking status or a memory's relevance status.
