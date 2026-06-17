---
entity: TrackingStatus
group: reference
pk:
  - tracking_status
columns:
  tracking_status:
    type: text
    desc: "Code identifying the progress state of a task or milestone"
reference: true
examples:
  - { tracking_status: pending }
  - { tracking_status: in_progress }
  - { tracking_status: done }
---

# TrackingStatus

Controlled vocabulary for progress states applied to planning entities such as tasks and milestones. Legal transitions between states are enforced by [[TrackingStatus_Allowed]].
