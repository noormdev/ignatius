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


Mermaid diagrams in markdown bodies (see [Diagrams in the body](folder-format.md#diagrams-in-the-body)) render in a bold style by default: nodes filled with the entity colors at full strength, 3px black outlines, 8px corners, soft drop shadows, and bold labels. Each diagram sits on a dotted panel in the page background color. Node fills are the same in both modes. Connectors follow the mode: `text` in light mode, `textMuted` in dark mode. Edge labels use `text` in light mode and a mix of `textMuted` and `text` in dark mode.

Four keys under `theme.mermaid` change the node style in both modes. Node outlines are always black, and node colors come only from `node_fills`. Quote each color: YAML reads an unquoted `#58a6ff` as a comment.

| Key | Type | Default | Effect |
|---|---|---|---|
| `node_fills` | list of `#rrggbb`, 1 to 12 | `#58a6ff`, `#d29922`, `#3fb950`, `#f0883e`, `#c4b5fd` | Node fills, cycled node by node. Stores (cylinders) take the first fill and decisions (diamonds) the second. Each label is black or white, whichever reads better on its fill. |
| `stroke_width` | number, 0 to 8 | `3` | Node outline width in px. Connectors are drawn at 85% of it, at least 1px. |
| `radius` | number, 0 to 32 | `8` | Corner radius of node boxes in px. |
| `shadow` | boolean | `true` | `false` removes the node drop shadows. |

For anything else, set Mermaid variables under `theme.mermaid.dark` and `theme.mermaid.light`. The keys are Mermaid's own variable names, listed in Mermaid's [theming reference](https://mermaid.js.org/config/theming.html). Each value replaces the default for that key in that mode; keys you leave out keep their defaults. `primaryColor`, `primaryBorderColor`, and `primaryTextColor` do not reach flowchart, state, class, or ER nodes; use `node_fills` for those. `lineColor` recolors every connector.

```yaml
theme:
  mermaid:
    node_fills: ["#58a6ff", "#d29922", "#3fb950"]
    stroke_width: 2
    radius: 6
    shadow: false
    dark:
      lineColor: "#8b6cf0"
    light:
      lineColor: "#6d4fd8"
```

The main variables and the value each one defaults to:

| Mermaid variable | Default |
|---|---|
| `fontFamily` | the viewer's body font stack |
| `fontSize` | `14px` |
| `background`, `clusterBkg`, `edgeLabelBackground` | `background` |
| `primaryColor`, `secondaryColor`, `tertiaryColor` | the first, second, and third node fill |
| `primaryTextColor` | black or white, whichever reads better on the first fill |
| `primaryBorderColor`, `clusterBorder` | `#000000` |
| `textColor` | `text` |
| `lineColor` | `text` in light mode, `textMuted` in dark mode |
| `noteBkgColor` | the third node fill |

The defaults also cover sequence, state, class, ER, gantt, pie, quadrant, git, and XY charts. Their series colors cycle the node fills. A label on a filled shape is black or white, whichever contrasts more with the fill; where Mermaid has one label color for every fill (gantt bars, pie slices), it is the one that reads on all of them. Composite-state titles use `text`, and ER attribute rows stay white with black labels in both modes.

Mermaid writes theme values into the diagram's stylesheet unescaped, so ignatius checks every value that reaches it:

- Values in the `dark` and `light` blocks must be numbers, or strings made only of letters, digits, spaces, and `# % ( ) , . ; - "`.
- The palette's `background`, `surface`, `text`, and `textMuted` colors must use the same characters. The rest of the viewer keeps an unsafe one; only diagrams replace it.
- The four style keys must be within their type and range, and `theme.mermaid`, `dark`, and `light` must be mappings. Any other key under `theme.mermaid` is unknown.

Anything that fails is dropped and reported as the `config.mermaid_theme_invalid` warning (see [Validation and findings](validation.md#config-rules)), and diagrams use the default for it. A warning does not fail `ignatius validate`.


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
