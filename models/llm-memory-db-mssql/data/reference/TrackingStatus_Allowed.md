---
entity: TrackingStatus_Allowed
group: reference
pk:
  - from_status
  - to_status
columns:
  from_status:
    type: text
    desc: "Tracking status code that is the source of this permitted transition"
  to_status:
    type: text
    desc: "Tracking status code that is the legal destination of this transition"
relationships:
  - target: TrackingStatus
    on: { from_status: tracking_status }
    predicate: { fwd: "is the source of", rev: "starts from" }
  - target: TrackingStatus
    on: { to_status: tracking_status }
    predicate: { fwd: "is the target of", rev: "ends at" }
examples:
  - { from_status: pending, to_status: in_progress }
  - { from_status: in_progress, to_status: done }
  - { from_status: in_progress, to_status: blocked }
---

# TrackingStatus_Allowed

Encodes the legal edges of the [[TrackingStatus]] transition graph. The stored-procedure layer checks this table before journaling a state change on a [[Milestone]] or task, ensuring only permitted progressions are recorded.
