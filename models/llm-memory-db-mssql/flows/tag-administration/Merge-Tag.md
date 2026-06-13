---
process: Merge Tag
number: 4
inputs:
  - from: ext:LLM-Agent
    data: source and target tag references (source_tag_id, target_tag_id)
  - from: db:Tag
    data: [tag_id]
  - from: db:Memory_Tag
    data: [tag_id, memory_id]
  - from: db:Project_Tag
    data: [tag_id, project_id]
  - from: db:Artifact_Tag
    data: [tag_id, artifact_id]
  - from: db:Milestone_Tag
    data: [tag_id, milestone_id]
  - from: db:Task_Tag
    data: [tag_id, milestone_id, task_no]
outputs:
  - to: db:Memory_Tag
    data: [tag_id, memory_id]
  - to: db:Project_Tag
    data: [tag_id, project_id]
  - to: db:Artifact_Tag
    data: [tag_id, artifact_id]
  - to: db:Milestone_Tag
    data: [tag_id, milestone_id]
  - to: db:Task_Tag
    data: [tag_id, milestone_id, task_no]
  - to: db:Tag
    data: [tag_id]
  - to: ext:LLM-Agent
    data: merge summary (attachments_moved, source_tag_id deleted)
examples:
  in:
    - from: ext:LLM-Agent
      label: Fold duplicate "perf" tag into canonical "performance"
      rows:
        - { source_tag_id: 45, target_tag_id: 42 }
    - from: db:Tag
      label: Existence guard — both tags must be present
      rows:
        - { tag_id: 45 }
        - { tag_id: 42 }
    - from: db:Memory_Tag
      label: Source attachments to re-point (anti-joined against target's existing links)
      rows:
        - { tag_id: 45, memory_id: 5002 }
    - from: db:Project_Tag
      label: No project attachments on source
      rows: []
    - from: db:Artifact_Tag
      label: Source has one artifact attachment
      rows:
        - { tag_id: 45, artifact_id: 3001 }
    - from: db:Milestone_Tag
      label: No milestone attachments on source
      rows: []
    - from: db:Task_Tag
      label: No task attachments on source
      rows: []
  out:
    - to: db:Memory_Tag
      label: Re-pointed memory link (memory 5002 now under tag 42)
      rows:
        - { tag_id: 42, memory_id: 5002, created_at: "2026-06-13T10:10:00Z" }
    - to: db:Project_Tag
      label: No rows moved (source had none)
      rows: []
    - to: db:Artifact_Tag
      label: Re-pointed artifact link
      rows:
        - { tag_id: 42, artifact_id: 3001, created_at: "2026-06-13T10:10:00Z" }
    - to: db:Milestone_Tag
      label: No rows moved
      rows: []
    - to: db:Task_Tag
      label: No rows moved
      rows: []
    - to: db:Tag
      label: Source tag deleted
      rows:
        - { tag_id: 45 }
    - to: ext:LLM-Agent
      label: Merge summary
      rows:
        - { attachments_moved: 2, source_tag_id: 45, deleted: true }
---

Folds a duplicate [[Tag]] into a canonical one, re-pointing all five junction tables to the target and then deleting the source.

Before any writes, the process reads [[Tag]] to confirm both `source_tag_id` and `target_tag_id` exist. Either missing → error returned, nothing changed.

For each of the five junction tables — [[Memory_Tag]], [[Project_Tag]], [[Artifact_Tag]], [[Milestone_Tag]], and [[Task_Tag]] — the procedure selects the source tag's attachments that do not already exist on the target (anti-join), inserts those net-new rows under `target_tag_id`, then deletes all rows still pointing at `source_tag_id`. Pairs that already exist on the target are silently dropped, preserving idempotency.

After all junction tables are reconciled, the source [[Tag]] row itself is deleted. The entire operation runs inside a single transaction: either all five junctions are migrated and the source is removed, or nothing is written.

The returned summary tells the agent how many attachment rows moved in total and confirms the source was deleted. The agent is responsible for choosing which tag is canonical before calling this process — the procedure does not evaluate names or descriptions.
