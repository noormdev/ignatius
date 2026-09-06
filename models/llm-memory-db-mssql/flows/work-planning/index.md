<ignatius-breadcrumb>

↑ [Flows](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/work-planning" count="5" depth="2" digest="sha256:aec5a4c22e33a647c289c9b955463e7287071c13b00253ce6a71bba80d15bc3f">

| Name | Kind | Description | Go |
|---|---|---|---|
| Add-Task-Dependency | process | Wires a directed, cycle-checked dependency edge between two tasks | [Add-Task-Dependency](Add-Task-Dependency.md) |
| Close-Milestone | process | Closes a milestone and cascades abandonment to its open child tasks | [Close-Milestone](Close-Milestone.md) |
| Create-Milestone | process | Creates a planned unit of work and returns its new milestone_id | [Create-Milestone](Create-Milestone.md) |
| Create-Task | process | Adds a task to a milestone, assigning the next milestone-scoped task_no | [Create-Task](Create-Task.md) |
| Set-Task-Tracking | process | Advances or regresses a task's tracking status through a gated transition | [Set-Task-Tracking](Set-Task-Tracking.md) |

</ignatius-index>
