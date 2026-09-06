<ignatius-guide>

# LLM Memory DB (MSSQL)

Reverse-engineered IDEF1X model of the llm-memory-db-mssql schema — an agent long-term memory store. Agents record memories, notes, milestones, tasks, and artifacts within projects; everything is taggable and every relevance/tracking change is journaled as an immutable state transition.

## Walking this model

Start at [index.md](index.md). Every router lists its folder's
children by name, kind, description, and a link. A row whose Kind is
`folder` leads to another router; any other Kind is a leaf with real
content: an entity, a flow process, an external, or a store.

## Conventions

- Key style: mixed. Some entities carry a parent-inherited primary key and others carry a surrogate primary key with foreign keys held outside it, so no single convention holds here. Check each entity's `pk:` before assuming one.
- `[[Entity]]` inside a body is a cross-reference to another entity file.
  It is not a router link, and it resolves only in the app's viewer.

## Currency

This guide and the routers were generated together. Root router digest:
`sha256:daaeac611ff09e37b12a733a65f899e5932a1f234a8545033e122d3044aacf14`. Run `ignatius validate --index` to check whether the
model has drifted since.

</ignatius-guide>
