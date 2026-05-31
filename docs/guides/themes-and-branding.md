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
    nodeSep: 30
```

The interactive viewer has a light/dark toggle that persists across reloads. The static `dict` and `graph` commands default to the dark palette; pass `--theme light` for the light one.


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
| `title` | built-in | Max 50 characters |
| `subtitle` | built-in | Max 50 characters |
| `copyright` | built-in holder + current year | `{ holder, year }` |
| `poweredBy` | `true` | Set `false` to hide the footer attribution |

Logo paths are resolved relative to the model root and inlined as data URIs in the static `dict` and `graph` output, so the generated HTML stays self-contained.
