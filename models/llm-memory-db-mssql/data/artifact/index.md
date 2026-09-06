<ignatius-breadcrumb>

↑ [Data](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/artifact" count="3" depth="2" digest="sha256:99edafb57a7c3053111cc128feb0cc538772d48f6ff9d450d200b1b4306f51b3">

| Name | Kind | Description | Go |
|---|---|---|---|
| Artifact | Independent | A file or document produced by an agent during work on a project, versioned through RelevanceStatus. | [Artifact](Artifact.md) |
| Milestone_Artifact | Associative | Junction linking a milestone to the artifacts produced under it; cascades on delete. | [Milestone_Artifact](Milestone_Artifact.md) |
| Task_Artifact | Associative | Junction linking a composite-keyed task to the artifacts it produced, finer-grained than Milestone_Artifact. | [Task_Artifact](Task_Artifact.md) |

</ignatius-index>
