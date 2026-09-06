<ignatius-breadcrumb>

↑ [Flows](../index.md) · [LLM Memory DB (MSSQL)](../../index.md)

</ignatius-breadcrumb>

<ignatius-index scope="flow-diagram" path="flows/agent-project-setup" count="4" depth="2" digest="sha256:7947ff79b8b58ad0397bef67dd98f8f5fb04856d9023004a1d5f40fef315708d">

| Name | Kind | Description | Go |
|---|---|---|---|
| Create-Agent | process | Registers a new LLM agent identity and returns the assigned agent_id | [Create-Agent](Create-Agent.md) |
| Create-Project | process | Registers a codebase workspace under a validated owning agent | [Create-Project](Create-Project.md) |
| Delete-Agent | process | Retires an agent, reassigning its dependent rows to a sentinel agent | [Delete-Agent](Delete-Agent.md) |
| Update-Project | process | Amends a project's editable metadata after confirming it exists | [Update-Project](Update-Project.md) |

</ignatius-index>
