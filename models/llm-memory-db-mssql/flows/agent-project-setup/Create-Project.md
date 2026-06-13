---
process: Create Project
number: 2
inputs:
  - from: ext:LLM-Agent
    data: project name, filepath, git_repo, main_branch, git_url, and owning agent_id
  - from: db:Agent
    data: [agent_id]
outputs:
  - to: db:Project
    data: [agent_id, name, filepath, git_repo, main_branch, git_url]
  - to: ext:LLM-Agent
    data: newly assigned project_id
examples:
  in:
    - from: ext:LLM-Agent
      label: Project creation request including workspace metadata
      rows:
        - { agent_id: 1, name: "ignatius", filepath: "/Users/alonso/projects/noorm/ignatius", git_repo: "ignatius", main_branch: "main", git_url: "git@github.com:noorm/ignatius.git" }
    - from: db:Agent
      label: Owner agent record validated before insert
      rows:
        - { agent_id: 1 }
  out:
    - to: db:Project
      label: New project row persisted under the owning agent
      rows:
        - { agent_id: 1, name: "ignatius", filepath: "/Users/alonso/projects/noorm/ignatius", git_repo: "ignatius", main_branch: "main", git_url: "git@github.com:noorm/ignatius.git" }
    - to: ext:LLM-Agent
      label: Confirmed project identity returned to caller
      rows:
        - { project_id: 100 }
---

An [[LLM-Agent]] creates a [[Project]] workspace that will scope all future memories, notes, milestones, tasks, and artifacts for a particular codebase or area of work. Before inserting, this process reads [[Agent]] to confirm the supplied `agent_id` identifies a valid, non-sentinel owner — the stored procedure raises an error if the agent does not exist.

On successful validation the process inserts a new [[Project]] row, binding it to the owner via the foreign key `agent_id`. The `filepath` records where the project lives on disk, `git_repo` is the short repository name, `main_branch` is the integration branch (typically `main` or `master`), and `git_url` is the full remote clone URL. `created_at` and `updated_at` are set by the database at insert time. The assigned `project_id` is returned so the agent can scope subsequent operations to this workspace.
