# Wiki-style entity links in entity bodies


## Goal


Let an entity body reference another entity by name and have that reference become a live link: `[[Customer]]` renders as a link that, in the graph viewer, opens the Customer modal, and in the data dictionary, jumps to the Customer section. The business narrative the modeling skill already encourages (`docs/design/markdown-driven-erd.md`) should be able to point at the entities it talks about, the same way the auto-memory `[[name]]` convention links related notes.


## Syntax


- `[[Customer]]` — link labelled "Customer", targeting the `Customer` entity.
- `[[Customer|the buyer]]` — link labelled "the buyer", targeting `Customer`.


The target is matched **exactly** against entity ids (PascalCase). A target that matches no entity is a *broken link*: it renders as muted, non-navigating text and is reported as a `body.unknown_link` finding.


## Why one anchor, two behaviours


The body markdown is rendered once, at parse time, into HTML that both surfaces inject verbatim. So a single anchor shape has to serve both:


```html
<a class="entity-link" data-entity="Customer" href="#entity-Customer">Customer</a>
```


- **Dict** rides the `href="#entity-Customer"` — the same native-anchor navigation its FK links already use. No new JavaScript.
- **Graph** reads `data-entity` from a delegated click handler and drives the existing modal navigation, calling `preventDefault()` so the dict-style hash never leaks into the graph's own `#entity=…&zoom=…` hash router.


Broken links render as `<span class="entity-link entity-link--missing">` — no `href`, no `data-entity` — so neither surface tries to navigate to a target that isn't there.


## Validation


`[[…]]` links can only be resolved once every entity id is known, but the body is rendered per file as the parser scans. The render is therefore deferred to a second pass: the parser collects raw bodies, builds the full id set, then renders each body with that set in the markdown-it `env`. The rule marks unknown targets missing at render time and records every referenced target on `ModelNode.bodyLinks`; `validateModel` cross-checks those against the model and emits one `body.unknown_link` warning per distinct unknown target. This keeps the feature consistent with the project's findings culture (`docs/design/schema-lint-and-error-ux.md`): a typo in a body link is surfaced, not silently dead.


## Rejected approaches


- **Resolve at render time only, no finding** — cheaper, but a mistyped `[[Custmer]]` would render as dead text with no signal. Rejected: the rest of the model surfaces every dangling reference; body links should not be the one exception.
- **Per-surface link syntax / separate render per surface** — rendering the body twice (once with dict hrefs, once with graph handlers) doubles parse work and risks the two drifting. Rejected in favour of one neutral anchor carrying both `href` and `data-entity`.
- **An existing wiki-links markdown-it plugin** — the community plugins emit href-only anchors and don't expose the `data-entity` + missing-span control this needs. A ~40-line inline rule is more direct and fully owned.


## Surfaces


| Surface | Behaviour |
|---------|-----------|
| Graph modal body | Valid link → click opens the target modal. Broken link → muted, non-clickable; the `body.unknown_link` finding shows in the modal Issues section + findings panel. |
| Dict entity body | Valid link → anchor jumps to `#entity-<id>`. Broken link → muted text; finding shows in the findings panel + the entity's ⚠ disclosure. |
| Group description body | Links render optimistically (group descriptions are parsed before the id set exists, so they are not validated). |
