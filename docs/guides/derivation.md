# What gets derived


You describe the structure. ignatius derives the rest, so the diagram reflects the schema instead of labels you maintain by hand.


## Cardinality


Cardinality comes from the primary-key layout, the relationship type, and foreign-key nullability. There is no `cardinality` field to set.

- An identifying edge where the child's primary key equals the foreign key exactly is one-to-one.
- A child with extra primary-key columns beyond the foreign key is one-to-many.
- A nullable foreign key makes the parent side optional.

An edge is *identifying* when the foreign-key columns are part of the child's primary key. That too is derived from the key shape, never declared per edge.


## Classification


Classification comes from how an entity connects to others, applied in this order:

1. **Classifier** — flagged as a reference/classifier entity.
2. **Subtype** — appears as a member of another entity's subtype cluster.
3. **Associative** — two or more identifying parents.
4. **Dependent** — exactly one identifying parent.
5. **Independent** — none of the above.

Classification sets the node shape, so the diagram reflects structure without you labeling it. If a file does declare a `classification` that contradicts the derived one, the validator surfaces the mismatch rather than trusting the label.


## Subtype clusters


Subtype clusters render with diamond joiners between the basetype and its members. An exclusive cluster shows an X in the diamond; an inclusive one leaves it empty. An exclusive cluster needs a discriminator column that says which subtype a basetype row is; an inclusive cluster does not, because multiple subtypes can coexist for the same row.


## Where the full rules live


The complete derivation algorithm, including the five-rule classification order and the cardinality matrix, is specified in:

- `docs/design/markdown-driven-erd.md` — the entity format and visual notation.
- `docs/spec/derive-classification.md` — the classification derivation contract.
