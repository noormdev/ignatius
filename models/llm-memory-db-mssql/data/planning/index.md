<ignatius-breadcrumb>

↑ [Data](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/planning" count="4" depth="2" digest="sha256:caef7de10e95233a9be7b18968f39991cbe35dc5497dab7fa6c96a73c8056f19">

| Name | Kind | Description | Go |
|---|---|---|---|
| Milestone | Independent | A tracked deliverable scoped to a project, with independent tracking and relevance status axes. | [Milestone](Milestone.md) |
| Project_Milestone | Associative | Junction attaching a milestone to one or more projects. | [Project_Milestone](Project_Milestone.md) |
| Task | Dependent | An atomic unit of work advancing a milestone, keyed by a milestone-scoped task number. | [Task](Task.md) |
| Task_Dependency | Dependent | Directed edge recording that one task depends on another, both endpoints composite-keyed task references. | [Task_Dependency](Task_Dependency.md) |

</ignatius-index>
