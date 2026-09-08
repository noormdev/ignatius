---
label: Tag junctions
entities:
  - Project_Tag
  - Artifact_Tag
  - Milestone_Tag
  - Task_Tag
---

The four junction tables Merge Tag reconciles together whenever it folds a
duplicate [[Tag]] into its canonical target: each is anti-joined against the
target, net-new rows are re-pointed, and the source's rows are deleted.
