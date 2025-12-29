# Foundry Calculator

A static, production-ready calculator for Foundry that computes machine counts, per-minute inputs, and a full crafting dependency tree using the JSON data from `data/v0_6_0_23789/`.

## Why Vite + React + TypeScript + Tailwind?

- **Static-friendly:** Builds a plain static bundle ideal for GitHub Pages or Vercel static deployments.
- **Fast DX:** Vite is quick to dev/build, and React + TS keeps the UI strongly typed.
- **Styling:** Tailwind keeps the UI lean without extra design dependencies.

## Getting started

```bash
npm install
npm run dev # open http://localhost:5173
```

## Tests

```bash
npm test
```

## Production build

```bash
npm run build
npm run preview # optional local preview
```

## Data

- Current data lives in `data/v0_6_0_23789/` (items, recipes, machines, version, scrape issues).
- To update to a new game version, add a new folder under `data/` (e.g., `data/v0_6_0_24000/`) with the same JSON filenames, then update the imports in `src/data/data.ts` to point at the latest version.

## Architecture

- **Data layer:** `src/data/data.ts` loads JSON and exposes helper utilities (tier parsing, variant grouping).
- **Recipe selection:** `src/logic/recipes.ts` builds producer maps, applies overrides, and respects tier preferences (defaults to Tier 1 when present).
- **Calculation engine:** `src/logic/calculator.ts` walks recipes recursively, detects cycles, sums per-minute inputs, and skips machine math when `baseTimeSec` is missing while still propagating input needs.
- **UI:** `src/App.tsx` provides a searchable item picker, variant/tier chooser, machine rounding toggle, advanced recipe overrides, input aggregation table, and a collapsible crafting tree. State is persisted in the URL for shareable links.

## Handling edge cases

- Missing `baseTimeSec` or `craftedIn`: shown as warnings; machine counts are omitted but input flow still propagates.
- Invalid/missing recipes: treated as raw inputs with warnings.
- Cycles: detected and labeled to avoid infinite recursion.
- Multiple producers: tier preference (Tier 1 by default) first, otherwise deterministic by recipe id; users can override per-item recipes in the advanced panel.

## Deploying

Any static host works. Example with Vercel:

```bash
npm run build
# Deploy `dist/` as a static site
```

For GitHub Pages, you can serve `dist/` via Actions or any static file host.
