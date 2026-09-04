# Releasing Épure

Épure is published to npm as **[`@theodo-group/epure`](https://www.npmjs.com/package/@theodo-group/epure)**,
which is how users should get it:

```sh
npx -y @theodo-group/epure <file>.epr.d2   # zero-install
npm i -g @theodo-group/epure               # then just `epure <file>.epr.d2`
```

The scope is not optional: the bare **`epure`** name on npm belongs to an
unrelated package abandoned in 2017, so `npx epure` does **not** run this tool.
(It may appear to work on a machine that already has the global install — npx
prefers a binary already on `PATH` before hitting the registry.) Docs, the skill
and the PNG metadata all spell out the scoped name for that reason.

Installing from GitHub still works and is the way to run an unreleased `main`:

```sh
npm i -g github:theodo-group/epure   # self-builds via the `prepare` script
```

## Publishing to npm

One step, once you're logged in to an account that belongs to the `theodo-group`
npm org:

```sh
npm login           # interactive — browser + OTP
npm publish         # publishConfig already sets access: public
```

The bin name stays `epure`. `prepack` builds `dist/` + `dist-server/` +
`dist-lib/` automatically and the `files` field ships only those plus `skills/`.
Inspect the tarball first with `npm pack --dry-run` (note: it's ~7 MB — the
bundled icon catalog dominates).

## Live editor demo

The static editor is deployed to GitHub Pages from the `gh-pages` branch:
<https://theodo-group.github.io/epure/>. To redeploy after SPA changes:

```sh
npx vite build --base=/epure/ && touch dist/.nojekyll
( cd dist && git init -q && git checkout -qb gh-pages && git add -A \
  && git commit -qm deploy && git push -qf <repo-url> gh-pages:gh-pages && rm -rf .git )
npm run build   # restore dist/ to the default base for the CLI
```

## Cutting a version

```sh
npm version patch   # or minor / major — updates package.json + tags
git push --follow-tags
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, the SPA + CLI
builds, and a CLI render smoke-test on every push and PR.
