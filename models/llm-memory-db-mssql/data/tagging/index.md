<ignatius-breadcrumb>

↑ [Data](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="entity-group" path="data/tagging" count="6" depth="2" digest="sha256:5a5caf2d2bdf43dbee5a1f5c6072682c1eb2c36c3e934400902480ba91069ed9">

| Name | Kind | Description | Go |
|---|---|---|---|
| Artifact_Tag | Associative | Junction attaching a tag to an artifact; cascades on tag delete. | [Artifact_Tag](Artifact_Tag.md) |
| Memory_Tag | Associative | Junction attaching a tag to a memory; cascades on tag delete. | [Memory_Tag](Memory_Tag.md) |
| Milestone_Tag | Associative | Junction attaching a tag to a milestone; cascades on tag delete. | [Milestone_Tag](Milestone_Tag.md) |
| Project_Tag | Associative | Junction attaching a tag to a project; cascades on tag delete. | [Project_Tag](Project_Tag.md) |
| Tag | Independent | A reusable, uniquely-named label an agent applies to classify memories, artifacts, milestones, tasks, and projects. | [Tag](Tag.md) |
| Task_Tag | Associative | Junction attaching a tag to a composite-keyed task, the only tagging junction with a two-column FK. | [Task_Tag](Task_Tag.md) |

</ignatius-index>
