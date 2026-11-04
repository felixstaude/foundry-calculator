/** Base URL of the foundry-recipe-data API (GitHub Pages); VITE_DATA_BASE_URL overrides it for local data. */
export const DATA_BASE_URL: string =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined) ?? 'https://felixstaude.github.io/foundry-recipe-data';

export const REPO_URL = 'https://github.com/felixstaude/foundry-calculator';
export const DATA_REPO_URL = 'https://github.com/felixstaude/foundry-recipe-data';

export const COMMIT = __COMMIT__;
