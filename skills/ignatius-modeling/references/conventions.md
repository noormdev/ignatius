## Conventions reference

### Column types

`text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`

### Column properties

| Property | Required | Notes |
|----------|----------|-------|
| `type` | Yes | One of the valid types above |
| `nullable` | No | Default false; omit unless true |
| `default` | No | Literal value or function name (e.g. `now`) |
| `desc` | No | Purpose of the column — not a restatement of the name |

### Classification derivation (for reference, never ask)

The parser derives classification from key/relationship shape:

| Condition (first match wins) | Classification |
|------------------------------|----------------|
| `reference: true` OR legacy classifier field | Classifier |
| Appears as member in another entity's `subtypes` cluster | Subtype |
| Has 2+ parents where FK cols are in child PK | Associative |
| Has 1 parent where FK cols are in child PK | Dependent |
| Otherwise | Independent |

Edge `identifying` is derived: true when the FK columns from `on:` appear in the child's `pk`.

### IDEF1X cardinality derivation (for reference)

**Identifying edges** (FK cols in child PK):
- Child is subtype → `1 : 0..1`
- Child PK = FK cols exactly → `1 : 1`
- Child PK has cols beyond FK → `1 : many`

**Referential edges** (FK cols outside child PK):
- FK not nullable + forms AK → `1 : 1`
- FK not nullable + no AK → `1 : many`
- FK nullable + forms AK → `0..1 : 1`
- FK nullable + no AK → `0..1 : many`
