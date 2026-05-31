# Bidirectional predicates


A predicate is the phrase that labels a relationship edge. Every relationship reads two ways, and ignatius lets you author both.

- **Forward** (parent to child): "Party *owes* SalesInvoice".
- **Reverse** (child to parent): "SalesInvoice *is owed by* Party".

The graph draws edges parent to child, so the forward reading matches the visual flow of the line. The reverse reading appears on hover and in the static dictionary.


## Why predicates carry business meaning


A predicate is not decoration on the line. It is the relationship stated in the language of the business, and it is the reason ignatius asks you to write a phrase instead of inferring "has many" / "belongs to" from the keys.

Generic ORM verbs add nothing to the conversation. "Party has many PaymentMethods" tells you the cardinality you already see in the crow's-foot marker and nothing about the domain. The relationship exists for a reason: a party *makes payments using* payment methods. That phrase carries the business fact the schema is there to record. Read the diagram aloud with good predicates and it narrates the business; read it with "has many" and it narrates the foreign keys.

So write predicates as verbs that a domain expert would recognize:

- Prefer "is classified by", "is realized as", "settles", "makes payments using" over "has", "has many", "belongs to".
- Phrase the forward reading from the parent and the reverse from the child, so each direction is a complete sentence on its own.
- Reach for the precise domain verb even when a generic one would parse. The precision is the point.

This carries past the diagram. Once the relationship has a name, the keys can take that name too. Instead of pausing on "what should I call this foreign key", let the predicate define it: a column named for `PaymentMethod is used in purchases for Party` documents itself, and the schema, the dictionary, and the code all speak the same sentence.


## Authoring a predicate


A predicate lives on the child (the foreign-key holder) inside each relationship. You can write it two ways.


### String form


A plain string sets both directions to the same phrase. Use it when one phrase reads acceptably in both directions, or when you do not care about the reverse reading yet.

```yaml
relationships:
  - target: Party
    on:
      party_id: party_id
    predicate: is a
```

This is equivalent to `{ fwd: "is a", rev: "is a" }`. Every existing string-form model keeps working unchanged.


### Object form


Provide both readings explicitly with `fwd` and `rev`. `fwd` reads parent to child; `rev` reads child to parent. Neither is derived from the other.

```yaml
relationships:
  - target: Identity
    on:
      party_id: party_id
    predicate: { fwd: is realized as, rev: is a }
```

If you supply only one key, the other defaults to an empty string. The reference model `models/key-inherited/` uses object-form predicates throughout; the other reference models use the string form.


## How predicates render


### In the graph (serve and static graph)


Each edge shows its forward predicate by default. Hover any entity and every line touching it reads outward from that entity:

- Edges where the hovered entity is the child flip to the reverse predicate.
- Edges where it is the parent already read from its side, so they stay on the forward predicate.

Move the pointer away and all labels return to forward. This keeps both readings legible without permanent label clutter.


### In the data dictionary


The dictionary has no hover affordance, so each relationship row shows the forward predicate as the primary label, and when the reverse differs it appends the reverse predicate in a muted secondary style. Both readings stay discoverable in the static output.
