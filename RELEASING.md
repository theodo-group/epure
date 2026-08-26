# Releasing Épure

Today's primary distribution is **install-from-GitHub** — it needs no npm
account and works the moment the repo is public:

```sh
npm i -g github:theodo-group/epure   # self-builds via the `prepare` script
```

## Publishing to npm

The package is named **`@theodo-group/epure`** (the bare `epure` name is held
by an unrelated abandoned package). Publishing is one step once you're logged in
to an account that belongs to the `theodo-group` npm org:

```sh
npm login           # interactive — browser + OTP
npm publish         # publishConfig already sets access: public
```

The bin name stays `epure`; users then run `npx @theodo-group/epure …` or
`npm i -g @theodo-group/epure`. `prepack` builds `dist/` + `dist-server/`
automatically and the `files` field ships only those plus `skills/`. Inspect the
tarball first with `npm pack --dry-run` (note: it's ~7 MB — the bundled icon
catalog dominates).

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
