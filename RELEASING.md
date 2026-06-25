# Releasing Épure

Today's primary distribution is **install-from-GitHub** — it needs no npm
account and works the moment the repo is public:

```sh
npm i -g github:theodo-group/epure   # self-builds via the `prepare` script
```

## Publishing to npm (optional, for a shorter `npx epure`)

The bare name `epure` on npm is taken by an unrelated abandoned package, so a
plain `npm publish` will fail. Pick one:

1. **Scoped name** (recommended): set `"name": "@theodo/epure"` (or your org
   scope) in `package.json`, then:
   ```sh
   npm login
   npm publish --access public
   ```
   Users then run `npx @theodo/epure …` (the `epure` *binary* name is unchanged).

2. **Claim/dispute `epure`** via npm support, then publish unscoped.

`prepack` builds `dist/` + `dist-server/` automatically, and the `files` field
ships only those plus `skills/`. Verify the tarball before publishing:

```sh
npm pack --dry-run
```

## Cutting a version

```sh
npm version patch   # or minor / major — updates package.json + tags
git push --follow-tags
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, tests, the SPA + CLI
builds, and a CLI render smoke-test on every push and PR.
