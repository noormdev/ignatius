# Themes and branding


Colors, spacing, and brand chrome come from optional `theme` and `branding` blocks in `ignatius.yml`. When a block is absent, ignatius uses its built-in defaults. All three subcommands read the same config, so the interactive view, the data dictionary, and the static graph match.


## Themes


A `theme` block defines separate `dark` and `light` palettes plus layout spacing. A user theme is deep-merged over the defaults, so you only set the values you want to change.

```yaml
name: My Schema
theme:
  dark:
    background: "#0e1116"
    surface: "#161b22"
    text: "#e6edf3"
  light:
    background: "#ffffff"
    surface: "#f6f8fa"
    text: "#1f2328"
  spacing:
    nodeSep: 60
```

The interactive viewer has a light/dark toggle that persists across reloads. The static `dict` and `graph` commands default to the dark palette; pass `--theme light` for the light one.


### DFD store and external colors


In a data flow diagram, each non-entity store is colored by its `kind:` (and an external may opt in with its own `kind:`). The default palette gives every kind a distinct, mode-appropriate color — `cache` amber, `queue` violet, `file` lime, `doc` sky, `manual` rose, `other` slate; `db` keeps the entity-store fill and `external` keeps the conventional green.


Override any kind under `theme.flowKinds`. Each kind takes `dark` and `light` entries of `{ bg, fg, border }`, deep-merged over the defaults — set only what you want to change and the rest of the palette is untouched.


```yaml
theme:
  flowKinds:
    cache:
      dark:
        bg: "#3a2a00"
      light:
        bg: "#fff3c4"
    file:
      dark:
        bg: "#16270a"
```


The store kinds are `db`, `cache`, `queue`, `file`, `doc`, `manual`, `other`, plus `external` for external entities. See the [glossary](../glossary.md) for what each term means.


### Mermaid diagrams


Mermaid diagrams in markdown bodies (see [Diagrams in the body](folder-format.md#diagrams-in-the-body)) take their colors from the active palette, so a model that recolors `theme.dark.surface` gets matching diagrams with no extra config. Every diagram renders with Mermaid's `base` theme, and ignatius fills its `themeVariables` from the palette for each mode.

To change a diagram color, set Mermaid variables under `theme.mermaid.dark` and `theme.mermaid.light`. The keys are Mermaid's own variable names, listed in Mermaid's [theming reference](https://mermaid.js.org/config/theming.html). Each value replaces the default for that key in that mode; keys you leave out keep their defaults.

```yaml
theme:
  mermaid:
    dark:
      primaryColor: "#2a1f4a"
      primaryBorderColor: "#8b6cf0"
      lineColor: "#8b6cf0"
    light:
      primaryColor: "#efe9ff"
      primaryBorderColor: "#6d4fd8"
      lineColor: "#6d4fd8"
```

The main variables and the palette value each one defaults to:

| Mermaid variable | Default |
|---|---|
| `fontFamily` | the viewer's body font stack |
| `fontSize` | `14px` |
| `background`, `clusterBkg` | `background` |
| `primaryColor`, `edgeLabelBackground` | `surface` |
| `primaryTextColor`, `textColor` | `text` |
| `primaryBorderColor`, `clusterBorder` | `border` blended 35% toward `textMuted` |
| `secondaryColor`, `tertiaryColor` | `surface` blended halfway to `background` |
| `lineColor` | `textMuted` |
| `noteBkgColor`, `noteTextColor` | the mode's Dependent badge background and text color |

Node fills, borders, and text derive from `primaryColor`, `primaryBorderColor`, and `primaryTextColor`, so override those three to restyle flowchart nodes. Decision and store shapes are the exception: they keep the Dependent and Independent badge colors whatever `theme.mermaid` sets. The defaults also cover sequence, state, class, ER, gantt, pie, quadrant, git, and XY charts. Their series colors cycle the five classification badge backgrounds of the mode plus its link color, and a label on a filled shape uses `text` or white, whichever contrasts more with the fill.

Values must be numbers, or strings made only of letters, digits, spaces, and `# % ( ) , . ; - "`. Mermaid writes these values into the diagram's stylesheet unescaped, so ignatius drops any other value, along with a `theme.mermaid`, `dark`, or `light` block that is not a mapping. Each dropped key is reported as the `config.mermaid_theme_invalid` warning (see [Validation and findings](validation.md#config-rules)), and diagrams use the default for it. A warning does not fail `ignatius validate`.


## Branding


A `branding` block sets the logo, title, subtitle, copyright line, and the "powered by" footer flag. Every field is optional and falls back to the default.

```yaml
name: My Schema
branding:
  logo:
    dark: ./assets/logo-dark.svg
    light: ./assets/logo-light.svg
  title: My Company Schema
  subtitle: Internal data model
  copyright:
    holder: My Company
    year: 2026
  poweredBy: false
```

| Field | Default | Notes |
|---|---|---|
| `logo` | embedded default logo | A single path applies to both modes, or use `{ dark, light }` for per-mode logos |
| `title` | built-in | Max 50 characters; shown on one line, cut with `…` past 200px (less on a phone) |
| `subtitle` | built-in | Max 50 characters; shown on one line, cut with `…` past 240px (less on a phone) |
| `copyright` | built-in holder + current year | `{ holder, year }` |
| `poweredBy` | `true` | Set `false` to hide the footer attribution |

Logo paths are resolved relative to the model root and inlined as data URIs in the static `dict` and `graph` output, so the generated HTML stays self-contained.
