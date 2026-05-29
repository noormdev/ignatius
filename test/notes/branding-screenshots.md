# Branding screenshot catalog

8 screenshots covering all 3 surfaces × 2 themes, with default (Noorm) and custom (Acme) branding states.

## Interactive viewer (CP-3)

| File | Theme | Branding | What to look for |
|------|-------|----------|-----------------|
| `screenshot-branding-dark-default.png` | dark | default (Noorm Ignatius) | Top-left: Noorm logo + "Noorm Ignatius" title; footer: "© {year} Noorm Ignatius" + powered-by link |
| `screenshot-branding-dark-custom.png` | dark | custom (Acme Corp) | Top-left: custom logo + "Acme Schema" title, "Your data mapped" subtitle; footer: "© Acme Corp" — NO powered-by link |
| `screenshot-branding-light-default.png` | light | default (Noorm Ignatius) | Same as dark-default but light background; logo variant switches to light SVG |
| `screenshot-branding-light-custom.png` | light | custom (Acme Corp) | Same as dark-custom but light background |

## Dict HTML (CP-4)

| File | Theme | Branding | What to look for |
|------|-------|----------|-----------------|
| `screenshot-dict-branding-dark.png` | dark | default (Noorm Ignatius) | Fixed header: Noorm logo + title; fixed footer bottom-center with copyright + powered-by link |
| `screenshot-dict-branding-light.png` | light | default (Noorm Ignatius) | Same layout, light background; confirms CSS vars applied in light mode |

## Graph HTML (CP-5)

| File | Theme | Branding | What to look for |
|------|-------|----------|-----------------|
| `screenshot-graph-branding-dark.png` | dark | default (Noorm Ignatius) | Fixed overlay top-left over canvas; Noorm logo visible; footer bottom-center |
| `screenshot-graph-branding-light.png` | light | custom (Acme Schema) | "Acme Schema" title visible top-left; NO powered-by link in footer |

## Notes

- All logo `src` attributes are `data:image/svg+xml;base64,...` — no runtime network requests.
- `poweredBy: false` removes the "powered by Noorm" anchor entirely (visible in custom screenshots).
- Fixed positioning is unaffected by graph pan/zoom and dict scroll — check overlapping elements at extremes of the scroll range.
- **Dict vs graph asymmetry:** dict screenshots use default (Noorm) branding for both themes — this deliberately shows the Noorm fallback path (no `_branding.yaml`). Graph screenshots use default-dark and custom-light — this demonstrates both the embedded asset path (dark default) and that user overrides propagate through the React runtime (light custom). The two surfaces are not inconsistent; they cover different scenarios by design.
