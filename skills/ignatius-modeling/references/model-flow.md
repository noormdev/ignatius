## Model bootstrap flow (CP-2)

### Step M1 — Target directory

Ask: "Target directory for the new model? (default: `./models/<name>`)"

### Step M2 — Model name

Ask: "Model name (for `ignatius.yml` `name:` field and branding title)?"

### Step M3 — Default convention

Ask: "Default authoring convention — `key-inherited` or `orm-oriented`?
(This is recorded as a comment in `ignatius.yml` for future entity invocations.)"

### Step M4 — Theme (optional)

Ask: "Custom theme colors? (y/n, default n — uses parser defaults)"

If yes, collect dark + light palette values:

| Key | Dark default | Light default |
|-----|-------------|---------------|
| `background` | `#16171b` | `#f7f7f8` |
| `surface` | `#1f2127` | `#eceef0` |
| `border` | `#363941` | `#d6dade` |
| `text` | `#e8e9ec` | `#23262b` |
| `textMuted` | `#9aa0a9` | `#646b73` |
| `edgeIdentifying` | `#9aa0a9` | `#646b73` |
| `edgeReferential` | `#454852` | `#c2c8ce` |

Ask only for values the user wants to override; others inherit defaults.

### Step M5 — Branding (optional)

Ask: "Custom branding? (y/n, default n — uses built-in Noorm branding)"

If yes, collect: `title`, optional `subtitle`, `copyright.text`, `copyright.year` (default current year), `poweredBy` flag (default true).

### Step M6 — Groups

Ask: "Define at least one group. For each: slug (snake_case), label, color (hex)."

Collect groups until the user says done.

### Step M7 — Bootstrap entity (optional)

Ask: "Bootstrap a reference entity now? (y/n, default n)"

If yes, run the entity flow (E1–E10) within the new model context.

### Step M8 — Write skeleton files

Write:
1. `ignatius.yml` using the ignatius.yml template below
2. `_groups/<slug>.md` for each group
3. `<slug>/` directory for each group
4. Entity file if requested in M7

Then run the verification loop in `references/verification.md`.

---

