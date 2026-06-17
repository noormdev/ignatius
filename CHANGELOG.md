# Changelog

## [0.11.0](https://github.com/noormdev/ignatius/compare/v0.10.0...v0.11.0) (2026-06-17)


### Features

* **flows:** reveal full edge data on DFD hover ([0802736](https://github.com/noormdev/ignatius/commit/0802736386b799b14956aec6b3785792ca5bcd69)), closes [#14](https://github.com/noormdev/ignatius/issues/14)
* **model:** adopt data/ + flows/ folder model ([#16](https://github.com/noormdev/ignatius/issues/16)) ([8213a50](https://github.com/noormdev/ignatius/commit/8213a50baf21b9abdae62c3ce2779198f26686a3))
* **shortcuts:** keyboard navigation for views and modes ([#13](https://github.com/noormdev/ignatius/issues/13)) ([2f8ad98](https://github.com/noormdev/ignatius/commit/2f8ad98d27763664ad42ef9bedbec1d4b32f38c1))


### Bug Fixes

* **flows:** preserve full dotted-number depth in nested DFDs ([f7a09b4](https://github.com/noormdev/ignatius/commit/f7a09b46fe98a0946a352b4efded85dce0fe3a00)), closes [#15](https://github.com/noormdev/ignatius/issues/15)

## [0.10.0](https://github.com/noormdev/ignatius/compare/v0.9.0...v0.10.0) (2026-06-15)


### Features

* **flow:** background-colored edge casing for over/under crossings ([10110e8](https://github.com/noormdev/ignatius/commit/10110e8b160ae7d3129b4c8624f2366dedde5dff))
* **flow:** consume ELK orthogonal edge routing (CP-4b) ([b328c7a](https://github.com/noormdev/ignatius/commit/b328c7a4dcc56fa5df9576baf2b25e35ded37bad))
* **flow:** derive context + Level-1 overview leveling (CP4) ([d10cc83](https://github.com/noormdev/ignatius/commit/d10cc838513f5c84f29b19b8de13a6c52644d9cf))
* **flow:** edge data contracts on-demand, not always-on (CP2) ([ee8fe2a](https://github.com/noormdev/ignatius/commit/ee8fe2acc6dfc2d440c01bccaf3cda1944ac35fd))
* **flow:** ELK headless layout positions module (CP1) ([714a864](https://github.com/noormdev/ignatius/commit/714a8649108435a285a7e7bc3b1717869142a3d0))
* **flow:** render DFDs with ELK layout (CP3) ([88feb31](https://github.com/noormdev/ignatius/commit/88feb31d925230dd4eeca8f92b1b2ae5f37f672a))
* **flow:** role-split externals + length-gated labels (CP-4a) ([37592cf](https://github.com/noormdev/ignatius/commit/37592cf675a1003a3f7f1a14ba9a41227333410a))
* **graph:** edge casing for over/under crossings via line-outline ([9993151](https://github.com/noormdev/ignatius/commit/999315154f540e91ec4cbff83d9d005e33850534))
* **models:** add llm-memory-db-mssql example ([bcede4a](https://github.com/noormdev/ignatius/commit/bcede4a05d106bab92987f6a6effba3d061150a1))
* **theme:** light/dark variants for findings panel + warning status colors ([b09c4c7](https://github.com/noormdev/ignatius/commit/b09c4c7fcf25c758208222271f2ad6953dccb11b))


### Bug Fixes

* **app:** theme all anchor links via --color-link (no browser-default blue) ([8d52e7c](https://github.com/noormdev/ignatius/commit/8d52e7cdf6e934d58138e47fb62ab37c524b76ca))
* **dict:** unique row keys for parallel relationship edges ([b6d3a92](https://github.com/noormdev/ignatius/commit/b6d3a92db6dd2654b3309d419920365c81ad1b8e))
* **flow:** guard ELK terminateWorker so it runs in the browser (CP-4e) ([75b2c82](https://github.com/noormdev/ignatius/commit/75b2c8283986e915da0247ec9a89c1f499cfcbf2))
* **flow:** return ELK node centers to align routes with nodes (CP-4d) ([ef6cf92](https://github.com/noormdev/ignatius/commit/ef6cf92568476090c2d3658afb2414765ccca547))
* **flow:** single-row bands by dropping ELK label dummies (CP-4c) ([c9234f1](https://github.com/noormdev/ignatius/commit/c9234f1b176c2bed7fb10e456e6550b7e15a8078))
* **flow:** widen edge casing to 3px each side for clearer over/under ([090cb04](https://github.com/noormdev/ignatius/commit/090cb04ec7c15fa8f447e041d009c668fcb3ddcd))

## [0.9.0](https://github.com/noormdev/ignatius/compare/v0.8.1...v0.9.0) (2026-06-13)


### Features

* **dict:** browse-lens spotlight grid ([3fed68f](https://github.com/noormdev/ignatius/commit/3fed68fb54b6e497cbda23f3fcd804d464d26d6f))

## [0.8.1](https://github.com/noormdev/ignatius/compare/v0.8.0...v0.8.1) (2026-06-11)


### Bug Fixes

* **frontend:** show Data Flows menu item in static exports ([98844cd](https://github.com/noormdev/ignatius/commit/98844cd2f624d1b92f2beefe7935dbf428a92b6a))

## [0.8.0](https://github.com/noormdev/ignatius/compare/v0.7.0...v0.8.0) (2026-06-10)


### Features

* **skill:** adapt to the user's conventions instead of inventing defaults ([3afd0c4](https://github.com/noormdev/ignatius/commit/3afd0c40409f126747e3f2050f25824f0016caac))


### Bug Fixes

* **skill:** correct theme/branding teaching in model mode (M4/M5) ([1168bf4](https://github.com/noormdev/ignatius/commit/1168bf449084707be7d25f7a2be9e3e98fa14de5))
* **skill:** entity ids are free-form — PascalCase is a suggestion, not a rule ([641e676](https://github.com/noormdev/ignatius/commit/641e676ca1b196c0ab324269f4bf7a54abf2de78))
* **skill:** teach [[wiki-link]] body links by example, forbid markdown .md links ([bb5d4b8](https://github.com/noormdev/ignatius/commit/bb5d4b87d0fc21c5266b825d357c2a1c1680deb5))


### Performance Improvements

* **graph:** render large models at scale — ELK avoidance + O(1) indexes ([99efe8b](https://github.com/noormdev/ignatius/commit/99efe8b47790437a54e811cba7b2739317e68287))

## [0.7.0](https://github.com/noormdev/ignatius/compare/v0.6.0...v0.7.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* the dict, graph, and flow CLI subcommands are removed. Use `ignatius export -o model.html` for static output and `ignatius serve` for the live app.

### Features

* unified SPA, first-class process flows, and skill flow/discover modes ([83d95f6](https://github.com/noormdev/ignatius/commit/83d95f6ed12e76cbb6a79358ec32f5e604c04392))

## [0.6.0](https://github.com/noormdev/ignatius/compare/v0.5.0...v0.6.0) (2026-06-02)


### Features

* **graph:** organic default layout + minimap leak fix ([a4af63c](https://github.com/noormdev/ignatius/commit/a4af63c2e6ae6167c7deccf90a63c4522316e22e))
* **graph:** organic layout mode, downward hover ([5040b6c](https://github.com/noormdev/ignatius/commit/5040b6c3f9012c207d992b88958fee3fb24f04da))
* **validate:** flag unknown AK columns, show AK in dict ([6b89824](https://github.com/noormdev/ignatius/commit/6b898240814ce4b5d8396012dbb109eb2524d6c3))
* **validate:** suppress missing_pk for singleton entities ([bf6cbb1](https://github.com/noormdev/ignatius/commit/bf6cbb14005dab2d59873242f8b804abce8d4727))


### Bug Fixes

* **graph:** eliminate node overlap, reduce edge crossings ([543ba7f](https://github.com/noormdev/ignatius/commit/543ba7f701294a3eccba3c91b6f024561e8bf182))

## [0.5.0](https://github.com/noormdev/ignatius/compare/v0.4.0...v0.5.0) (2026-06-01)


### Features

* **graph:** persist node positions + reset layout ([457a47a](https://github.com/noormdev/ignatius/commit/457a47aaaa9761c1443123d09ba5d73e0b9db86c))


### Bug Fixes

* **ui:** contain wide tables within their own scroll area ([786cdfb](https://github.com/noormdev/ignatius/commit/786cdfbeab732962a9372080bcfa99d225b58866))

## [0.4.0](https://github.com/noormdev/ignatius/compare/v0.3.0...v0.4.0) (2026-06-01)


### Features

* install tooling, version/update, graph fixes ([ffaa252](https://github.com/noormdev/ignatius/commit/ffaa252f3858a0a794434afe14410aa6851bb778))

## [0.3.0](https://github.com/noormdev/ignatius/compare/v0.2.0...v0.3.0) (2026-06-01)


### Features

* **graph:** highlight key-inheritance lineage up to root on hover ([95a97fd](https://github.com/noormdev/ignatius/commit/95a97fdf892cdcc1a19490c67341121b003c01cd))

## [0.2.0](https://github.com/noormdev/ignatius/compare/v0.1.0...v0.2.0) (2026-05-31)


### Features

* **branding:** embedded Noorm SVG + inline-asset helper ([00c5cf1](https://github.com/noormdev/ignatius/commit/00c5cf18dae3d2258c14ca7815fe3c06393aae82))
* **branding:** interactive UI + theme-aware logo swap + /api/asset + footer ([af4879e](https://github.com/noormdev/ignatius/commit/af4879e3b76012e7b58013cf9e3bf06ab26eb1e4))
* **branding:** schema + parser + 50-char validation ([b79214c](https://github.com/noormdev/ignatius/commit/b79214cc8897d613ae51c340ce9783ea41578b92))
* **ci:** release pipeline + atomic-setup additions ([bb078a4](https://github.com/noormdev/ignatius/commit/bb078a4d81078adb5404313f7e4fdeeb66792aa3))
* **cli:** add derek CLI entry with serve subcommand ([a17698d](https://github.com/noormdev/ignatius/commit/a17698d25cb32f263175739eab36a3b2d65cd83c))
* **cli:** add validate subcommand ([a23f972](https://github.com/noormdev/ignatius/commit/a23f972dcab8a6e4edf4c54a9ff643cee10cf84b))
* **cli:** rebuild on citty + ignatius.yml model discovery ([e3bd601](https://github.com/noormdev/ignatius/commit/e3bd601ea22703b5e14666b10d2bac5443727637))
* **cli:** wire dict + graph subcommands; compile binary ([9ca278d](https://github.com/noormdev/ignatius/commit/9ca278db5ac3a094269d69d62bf3919faec2a9ae))
* **dict:** branding header + footer in generated HTML ([8d575c9](https://github.com/noormdev/ignatius/commit/8d575c913812f74ca74d109d40660027735082a6))
* **dict:** branding overlap fix + translucent blurred backdrop ([55005fc](https://github.com/noormdev/ignatius/commit/55005fc1c4dd177e2856bd0fb90ed76f6dc03538))
* **dict:** data dictionary HTML generator ([d45979f](https://github.com/noormdev/ignatius/commit/d45979f8b83064631b6e43aae655d727b4b5d45b))
* **dict:** group sort_key + entity hierarchy ordering ([0b9756c](https://github.com/noormdev/ignatius/commit/0b9756c2083465a174647c438c30a7ccd814d36b))
* **dict:** mobile-responsive layout under [@media](https://github.com/media) (max-width: 768px) ([fe99d2f](https://github.com/noormdev/ignatius/commit/fe99d2f9dd2e5f8adab20a0e9fc82a84971c9942))
* **dict:** print stylesheet ([a3eb7f9](https://github.com/noormdev/ignatius/commit/a3eb7f9b57f89afb77fb013565e9b34d64b3b5c5))
* **dict:** scrollspy highlights current entity in side nav ([8d9db0e](https://github.com/noormdev/ignatius/commit/8d9db0e404441567a1d98d722af4446a6cec5a93))
* **dict:** side nav panel with toggle, outside-click, Esc, localStorage ([5992fb8](https://github.com/noormdev/ignatius/commit/5992fb8898113beb818e9384344c0dc098c1f590))
* **dict:** surface basetype + subtype relationship in entity header ([249b863](https://github.com/noormdev/ignatius/commit/249b8634163154bffc3a763b3e32dbabc576df63))
* **discover:** pure model-root resolver ([40a5743](https://github.com/noormdev/ignatius/commit/40a5743bb55aa9f3c82e6602193f8a072dfbd8cb))
* good place ([70e4463](https://github.com/noormdev/ignatius/commit/70e4463e05f120df490c317d9c0953b7b77c683d))
* good place ([085fae9](https://github.com/noormdev/ignatius/commit/085fae9faae6d7f17771c6e2fc57bb36d357b205))
* good place ([a892a86](https://github.com/noormdev/ignatius/commit/a892a86535018eb8826ffa2c85c1504914f6c011))
* good place ([b2b50da](https://github.com/noormdev/ignatius/commit/b2b50da578c3978559a6080df779b070935b7f10))
* good place ([32665c7](https://github.com/noormdev/ignatius/commit/32665c7776718e54a3ca0bb64f285b3b5c019efb))
* good place ([2d3c692](https://github.com/noormdev/ignatius/commit/2d3c6920d152024a78b67e05cab8e134f7ccf88e))
* good place ([3af8dcc](https://github.com/noormdev/ignatius/commit/3af8dcc7a7ad9a1b1608130e095772a3e623cdba))
* good place ([8d94466](https://github.com/noormdev/ignatius/commit/8d9446642242039e5519e643a5af3d355af6e324))
* good place ([846b110](https://github.com/noormdev/ignatius/commit/846b110157558de32263acdbce874fbdaec05d7f))
* **graph:** branding inherits via embedded Model JSON ([e3c37fc](https://github.com/noormdev/ignatius/commit/e3c37fcc1ffb9349ca104d9e3038d6ec76609a61))
* **graph:** static graph HTML generator ([95177ba](https://github.com/noormdev/ignatius/commit/95177baac38a9f5b141f68f86c755566408675a5))
* IDEF1X-style example instance tables across model surfaces ([337c04e](https://github.com/noormdev/ignatius/commit/337c04e7ac64bd3d01705ac3e8a916ffce2f1334))
* init ([6ed6bf6](https://github.com/noormdev/ignatius/commit/6ed6bf6a2ff058e415178c2667e0c09ae03bca3e))
* **models:** enrich the three model variants ([06c61ef](https://github.com/noormdev/ignatius/commit/06c61efe77edf8777ffe7a165ec30fa5a0117061))
* **parse:** derive classification from keys ([50b6897](https://github.com/noormdev/ignatius/commit/50b6897065ec71af9273c5bda7ff8a892d0f6666))
* **parse:** load model config from ignatius.yml ([c9b19f1](https://github.com/noormdev/ignatius/commit/c9b19f19dea0cde89ce90e430aef4c2a7e7eb67b))
* **predicates:** bidirectional edge predicates with hover swap ([26a5c93](https://github.com/noormdev/ignatius/commit/26a5c93a5e6870dbb9fb07918270f535266439c9))
* **serve:** live reload via SSE on file changes ([2524115](https://github.com/noormdev/ignatius/commit/2524115ac700e19d9bc2eec8b571c29861e2c6c5))
* **skill:** add ignatius-modeling skill ([3b22569](https://github.com/noormdev/ignatius/commit/3b225692543cabc8f4ab776a5fcb74d9cfaa3b1b))
* **skill:** two-path convention authoring support ([85ecc00](https://github.com/noormdev/ignatius/commit/85ecc00dde4b401181c18ee296969676243bc71a))
* **theme:** light/dark mode toggle ([3b377bf](https://github.com/noormdev/ignatius/commit/3b377bf9652454fed512bf79ed900e8fa8082fb2))
* **theme:** user-configurable theme via _theme.yaml ([7a83fc9](https://github.com/noormdev/ignatius/commit/7a83fc9baa3338bd229d9a185171e5bc590809fd))
* **validate:** broken-demo model + rule polish ([bb552e4](https://github.com/noormdev/ignatius/commit/bb552e411c47c6b68ef8fc68efee699e2d6030ec))
* **validate:** schema lint + error UX across surfaces ([c7c2f21](https://github.com/noormdev/ignatius/commit/c7c2f215797fce7bb74eed37f5a8e1bc4462068a))
* **viewer:** /dict route, hash router, FAB menu, minimap ([33421fe](https://github.com/noormdev/ignatius/commit/33421fea56cda9d0913942a2886dc3047af9c36d))
* **viewer:** dict UX parity with graph + readability polish ([a26dd17](https://github.com/noormdev/ignatius/commit/a26dd17c052f4a4e020ad258d73ee24ba81e061c))
* **viewer:** hover dim + direction-aware predicate arrows ([1386eeb](https://github.com/noormdev/ignatius/commit/1386eeb4899b4ae266727c72043f361c4195ddc5))


### Bug Fixes

* **dict:** force light palette in print and keep FAB above sidebar ([ef095ba](https://github.com/noormdev/ignatius/commit/ef095babf8e2483b116cd9153592e83f64e08272))
* **dict:** force light theme in print mode ([5f0fa82](https://github.com/noormdev/ignatius/commit/5f0fa82b8e27c3d2b6552cd35cfa7e8f0c65d00c))
* **dict:** print badges as outlined chips, not dark backgrounds ([1e6afd7](https://github.com/noormdev/ignatius/commit/1e6afd7b9c901b80689645659a2827b77888b26e))
* **parse:** apply subtype cardinality for derived Subtype ([09ec8d6](https://github.com/noormdev/ignatius/commit/09ec8d61249103e34119124ab580a06e97d2ef86))
* **theme:** semanticColors are mode-aware ([8a851a2](https://github.com/noormdev/ignatius/commit/8a851a261732c9616e4acea269fdd9892325c27b))
* **viewer:** close StrictMode race in minimap teardown ([e29e559](https://github.com/noormdev/ignatius/commit/e29e559214ab875215e5aa9a5c8ef43ee8055ba6))

## Changelog

This file is maintained by [release-please](https://github.com/googleapis/release-please) from Conventional Commit messages.

Releases will be appended below as they're cut.
