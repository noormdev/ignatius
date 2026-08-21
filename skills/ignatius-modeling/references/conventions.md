## Conventions reference

### Column types

`text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `binary`, `json`

`json` holds a structured document. Reach for it only when the shape is genuinely open-ended — a fixed set of known fields is columns, and a repeating group is a child entity. A `json` column that turns out to have a stable shape is a modeling miss, not a shortcut.

Write `json` example values as nested YAML. A quoted JSON string parses too, but nested YAML is what the rest of the file already reads like:

    examples:
      - account_id: 1
        settings:
          theme: dark
          digest: weekly
          muted_tags: [billing, marketing]

### Code in bodies

A tagged code fence in an entity or flow body is syntax-highlighted by the viewer. Bundled languages:

`json`, `sql`, `javascript`, `typescript`, `python`, `bash` — plus the aliases `js`, `ts`, `py`, `sh`, `shell`, `zsh`

Tag every fence you write; an untagged one, or one tagged with a language outside that set, renders as plain preformatted text. Prefer `sql` for the query snippets that most often earn a place in an entity body.

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
