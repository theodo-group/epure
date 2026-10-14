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
Inspect the tarball first with `npm pack --dry-run` (note: it's ~8 MB — the
bundled icon catalog dominates).

## Live editor demo

The static editor is deployed to GitHub Pages from the `gh-pages` branch:
<https://theodo-group.github.io/epure/>. Host pages embed it (slides does), so
redeploy after every release that changes the SPA. Each deploy is a commit on
top of `gh-pages`, so the history says what is live and a bad deploy can be
reverted:

```sh
VERSION=$(node -p "require('./package.json').version")
pnpm exec vite build --base=/epure/ --outDir /tmp/epure-pages --emptyOutDir
touch /tmp/epure-pages/.nojekyll
git fetch origin gh-pages
git worktree add --detach /tmp/epure-gh-pages origin/gh-pages
rsync -a --delete --exclude .git /tmp/epure-pages/ /tmp/epure-gh-pages/
( cd /tmp/epure-gh-pages && git add -A \
  && git commit -m "Deploy: $VERSION" \
  && git push origin HEAD:gh-pages )
git worktree remove /tmp/epure-gh-pages
```

Building into `/tmp` leaves `dist/` (the CLI's copy, default base) untouched.
Pages publishes within a minute; check the live bundle name in the page source.

## Cutting a version

```sh
npm version patch   # or minor / major — updates package.json + tags
git push --follow-tags
```

There is no CI yet, so run the checks before tagging:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build:all
```

`pnpm lint` is Biome (`biome check`: lint + format check); `pnpm format`
applies its fixes and formatting.
