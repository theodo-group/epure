# Épure

> Architecture diagrams that live in your repo and that **Claude Code edits live while you watch**.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
&nbsp;**[Try the editor online →](https://theodo-group.github.io/epure/)**

![An Épure diagram](./docs/hero.png)

A diagram is just **two small text files** that diff cleanly in a pull request — D2
for the topology, a JSON sidecar for the layout. No SaaS, no account, nothing
leaves your machine. Épure is built to be driven by Claude Code: it writes the
files, you watch them render live, and you steer it in the conversation.

## Use it with Claude Code

One-time setup (no install needed — `npx` runs it straight from GitHub):

```sh
npx github:theodo-group/epure skill install
```

Then, in any repo, just ask Claude Code:

> "Diagram this service's architecture with epure."

It creates the diagram, opens it live in your browser, and refines it as you talk:

- **Live** — every edit Claude makes appears instantly in the editor.
- **Yours to tweak** — drag nodes or restyle by hand; changes are written back to
  the files (and into your next `git diff`).
- **It can see the result** — Claude renders a PNG to check its own work and
  discuss the visuals with you.

## Use the editor on its own

[**Try it in your browser**](https://theodo-group.github.io/epure/) (nothing to
install — edits stay in localStorage), or run it locally against a file pair:

```sh
npx github:theodo-group/epure ./docs/diagrams/system.epr.d2
```

This prints a local URL and serves the editor against that pair, syncing your
edits both ways. (It creates a starter diagram if the file doesn't exist yet.)

## Commands

Every command is `npx github:theodo-group/epure <command>`:

| Command | What it does |
|---|---|
| `<file>` | Open the live editor for a diagram pair. |
| `new <file>` | Create a new pair (won't overwrite an existing one). |
| `export <file> -o out.png` | Render a PNG, fit to the diagram — no browser. |
| `validate <file>` | Check the pair for errors (non-zero exit on problems). |
| `fmt <file>` | Tidy the layout JSON so diffs stay small. |
| `skill install` | Install the Claude Code skill into `~/.claude/skills` (add `--local` to install into the current repo's `.claude/skills` so it's committed and shared with the team). |

> Typing that a lot? Install once — `npm i -g github:theodo-group/epure` — and use
> the shorter `epure <command>`.

## The files

A diagram is a pair sharing a basename, both committed to your repo:

- **`<name>.epr.d2`** — the topology: nodes, shapes, edges, labels, groups.
- **`<name>.epr.layout.json`** — the visuals: positions, sizes, colors, icons.

```d2
# system.epr.d2
api: API { shape: rectangle }
db: Postgres { shape: cylinder }
api -> db: "writes"
```

You rarely write these by hand — Claude Code does. See
[`fixtures/system.epr.*`](./fixtures) for a complete example, and pick from
thousands of cloud/infra/brand logos — plus a badge for every standard file
type (`.js`, `.py`, `.pdf`, `.docx`, `.zip`, …) — via the **Icon** control in
the editor.

Keeping diagrams in a repo? Add this to its `CLAUDE.md` so Claude Code uses them:

```md
## Architecture diagrams (Épure)
Diagrams live as `<name>.epr.d2` + `<name>.epr.layout.json` under `docs/diagrams/`.
Run `npx github:theodo-group/epure <file>.epr.d2 &` to open the live editor, edit
the pair, and `npx github:theodo-group/epure export <file>.epr.d2 -o /tmp/x.png`
to see the result.
```

## Contributing

```sh
pnpm install && pnpm dev      # the editor against a fixture
pnpm test                     # vitest
```

Requires Node 20+. See [RELEASING.md](./RELEASING.md) for publishing and the
Pages demo.

## License

MIT — see [LICENSE](./LICENSE).
