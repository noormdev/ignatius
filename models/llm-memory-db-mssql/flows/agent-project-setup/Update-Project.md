---
process: Update Project
number: 3
inputs:
  - from: ext:LLM-Agent
    data: project_id and any combination of updated name, filepath, git_repo, main_branch, git_url
  - from: db:Project
    data: [project_id]
outputs:
  - to: db:Project
    data: [name, filepath, git_repo, main_branch, git_url, updated_at]
examples:
  in:
    - from: ext:LLM-Agent
      label: Partial update request targeting an existing project
      rows:
        - { project_id: 100, main_branch: "develop", git_url: "git@github.com:noorm/ignatius.git" }
    - from: db:Project
      label: Current project row read to confirm existence before update
      rows:
        - { project_id: 100 }
  out:
    - to: db:Project
      label: Project row with amended fields and refreshed timestamp
      rows:
        - { project_id: 100, name: "ignatius", filepath: "/Users/alonso/projects/noorm/ignatius", git_repo: "ignatius", main_branch: "develop", git_url: "git@github.com:noorm/ignatius.git", updated_at: "2026-06-13T14:30:00Z" }
---

An [[LLM-Agent]] corrects or extends the metadata of an existing [[Project]] workspace. The caller supplies the `project_id` that identifies the target row and provides any subset of editable fields: `name`, `filepath`, `git_repo`, `main_branch`, and `git_url`. Fields omitted from the request are left unchanged.

Before applying changes, this process reads [[Project]] to confirm the supplied `project_id` exists; the stored procedure raises an error if the row is not found. On a successful lookup it applies the provided values via an `UPDATE` statement and stamps `updated_at` with the current server time. Only the mutable metadata columns may be changed — `project_id`, `agent_id`, and `created_at` are immutable after creation.

This process is typically invoked when a repository is moved, a remote URL changes, or a team adopts a new integration branch convention.
