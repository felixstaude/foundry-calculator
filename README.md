# Foundry Calculator

A production calculator for the factory game [Foundry](https://store.steampowered.com/app/983870/FOUNDRY/). Choose target
items and rates, and it works out the machines (with tiers), raw resources, byproducts and a production graph.

> **Status: rebuild in progress.** The previous version was replaced. The new calculator is built in milestones
> (M0 toolchain → M7 release); see the pull requests.

- **App:** https://felixstaude.github.io/foundry-calculator/ (self-test of the bundled libraries:
  [`#selftest`](https://felixstaude.github.io/foundry-calculator/#selftest))
- **Game data:** loaded at runtime from [foundry-recipe-data](https://github.com/felixstaude/foundry-recipe-data)
  (GitHub Pages, `foundry-data v1` under `/v1/`). Nothing about the game is hard-coded in this repository.

## Development

Requires Node.js 24 (`.nvmrc`).

```sh
npm ci
npm run dev          # http://localhost:5173/foundry-calculator/
npm run verify       # typecheck + lint + format check + unit tests + build (same as CI)
npm run test:e2e     # build, then Playwright against `vite preview` (first run: npx playwright install chromium)
```

`VITE_DATA_BASE_URL` points the app at another copy of the data API (e.g. a local server).

### Project rules

- One pull request at a time. Every PR must pass the CI checks `check` (typecheck, lint, format, unit tests, build) and
  `e2e` (Playwright on the built app under `/foundry-calculator/`) and be up to date with `main`. Merges are squash merges.
- `main` deploys to GitHub Pages through `.github/workflows/ci.yml` (build once, test that artifact, deploy it, then wait
  for the CDN and run the `@live` tests against the site).
- Domain, data, solver and plan code is plain TypeScript without React. The UI never computes rates itself.

## License

Third-party licenses: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Not affiliated with Channel 3 Entertainment.
