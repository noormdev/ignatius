## Model bootstrap flow (CP-2)

### Step M1 — Target directory

Ask: "Target directory for the new model? (default: `./models/<name>`)"

### Step M2 — Model name

Ask: "Model name (for `ignatius.yml` `name:` field and branding title)?"

### Step M2a — Model purpose

Ask: "In a sentence or two, what business or domain does this model cover, and who uses it?"

Write the answer into the `description:` field of `ignatius.yml` (uncomment it). This is the top-level business context for the whole model — the orienting paragraph a new developer reads first. Encourage a domain-level answer, not "a database for the app."

### Step M3 — Default key style (suggestion, not a mode)

A new model has no existing entities to derive a prevailing style from, so ask which key
style to *default* new entities toward — but frame it as a non-binding suggestion, not a mode:

> "Which key style should new entities default to — `key-inherited` (parent PK migrates into
> the child PK) or `orm-oriented` (surrogate `id`, FKs outside)? Individual entities may still
> differ; this only sets the default suggestion."

Record it as a comment in `ignatius.yml` for future entity invocations. It is a hint the
entity flow reads at E3, never a constraint it enforces.

### Step M4 — Theme (optional)

Ask: "Custom theme colors? (y/n, default n — uses parser defaults)"

If yes, collect dark + light palette values (defaults from `src/theme-defaults.ts`):

| Key | Dark default | Light default |
|-----|-------------|---------------|
| `background` | `#0e1116` | `#ffffff` |
| `surface` | `#161b22` | `#f6f8fa` |
| `border` | `#30363d` | `#d0d7de` |
| `text` | `#e6edf3` | `#1f2328` |
| `textMuted` | `#8b949e` | `#656d76` |
| `edgeIdentifying` | `#8b949e` | `#656d76` |
| `edgeReferential` | `#3d424a` | `#b0b8c1` |

Ask only for values the user wants to override; others inherit defaults — a user theme is deep-merged over the defaults.

Two more theme blocks exist; offer them only when the user's answers point at them:

- `theme.spacing` — layout spacing (`nodeSep`, default 60). Offer when the user mentions node density or layout tightness.
- `theme.flowKinds` — per-kind DFD store/external colors. Each kind (`db`, `cache`, `queue`, `file`, `doc`, `manual`, `other`, `external`) takes `dark`/`light` entries of `{ bg, fg, border }`, deep-merged so a partial override keeps the rest of the palette. Offer when the model has (or will have) flows and the user wants brand-matched diagrams. See `docs/guides/themes-and-branding.md` for the worked example.

### Step M5 — Branding (optional)

Ask: "Custom branding? (y/n, default n — uses built-in Noorm branding)"

If yes, collect:

- `title`, optional `subtitle` (max 50 characters each).
- `logo` — optional path to an SVG, resolved relative to the model root. A single path applies to both modes, or `{ dark, light }` for per-mode logos.
- `copyright.holder` (the name on the © line) and `copyright.year` (default current year).
- `poweredBy` flag (default true; `false` hides the footer attribution).

### Step M6 — Groups

Ask: "Define at least one group. For each: slug (snake_case suggested), label, color (hex)."

Collect groups until the user says done.

### Step M7 — Bootstrap entity (optional)

Ask: "Bootstrap a reference entity now? (y/n, default n)"

If yes, run the entity flow (E1–E10) within the new model context.

### Step M8 — Write skeleton files

Write:
1. `ignatius.yml` using the ignatius.yml template below
2. `groups/<slug>.md` for each group
3. `data/<slug>/` directory for each group (entities live under `data/`)
4. Entity file if requested in M7

Then run the verification loop in `references/verification.md`.

---

