# Getting started


Install ignatius, then point it at a folder of entity files and open the graph it serves.


## Install


### Download a release (recommended)


Pick the binary for your platform from the [latest GitHub release](https://github.com/noormdev/ignatius/releases/latest) and put it on your `$PATH`:

```bash
# macOS arm64
curl -L -o ignatius https://github.com/noormdev/ignatius/releases/latest/download/ignatius-darwin-arm64
chmod +x ignatius
sudo mv ignatius /usr/local/bin/

# Linux x64
curl -L -o ignatius https://github.com/noormdev/ignatius/releases/latest/download/ignatius-linux-x64
chmod +x ignatius
sudo mv ignatius /usr/local/bin/
```

Verify with `ignatius --help`. The binary is self-contained: it has no runtime dependency and works on machines without Bun installed.

Releases include `checksums.txt` if you want to verify the download with `shasum -a 256 -c`.


### From source


ignatius is built with [Bun](https://bun.com). Install Bun first, then:

```bash
bun install
bun run build:cli
```

That produces `./dist/ignatius`. See [Building from source](building-from-source.md) for what each build stage does.


## Quick start


Point the dev CLI at the bundled reference schema and open the page it serves:

```bash
bun run dev:cli
```

That serves the `models/` reference schema (three variants of the same data model: `key-inherited`, `orm-hybrid`, `orm-pure`) at `http://localhost:3000`. Edit any file under `models/` and the graph reloads in the browser without a refresh.

To run against your own folder, call the CLI directly with the `serve` subcommand:

```bash
ignatius serve path/to/your/models --port 3000
```

If the path contains multiple model folders, ignatius lists them and prompts you to pick one. Pass `--model <key>` to skip the prompt. See [Commands](commands.md) for the full discovery rules.


## Next steps


- [The folder format](folder-format.md) — how to structure entity files, groups, and `ignatius.yml`.
- [What gets derived](derivation.md) — cardinality, classification, and subtype clusters come from the structure, not from labels you set.
- [Commands](commands.md) — `serve`, `dict`, and `graph` in full.
- [Authoring with the modeling skill](modeling-skill.md) — let `/ignatius-modeling` write entity files for you.
