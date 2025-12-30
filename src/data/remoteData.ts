import { z } from 'zod';
import type { DataBundle, Item, Machine, Recipe, VersionInfo } from './data';

const DEFAULT_BASE_URL = 'https://felixstaude.github.io/foundry-recipe-data';

const manifestSchema = z.object({
  version: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  publishedAt: z.string().optional(),
  files: z.array(z.string()),
});

const indexSchema = z.object({
  latest: z.string(),
  versions: z.array(
    z.object({
      version: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      publishedAt: z.string().optional(),
    }),
  ),
});

const machineEntrySchema = z.object({
  name: z.string(),
  craftingTags: z.array(z.string()).optional(),
  craftingSpeedMultiplier: z.number().optional(),
});

const machinesSchema = z.object({
  machines: z.record(machineEntrySchema),
});

const recipeIoSchema = z.object({
  identifier: z.string(),
  amount: z.number(),
});

const recipeSchema = z.object({
  identifier: z.string(),
  name: z.string().optional(),
  timeMs: z.number().optional(),
  inputs: z.array(recipeIoSchema).optional(),
  outputs: z.array(recipeIoSchema).optional(),
  tags: z.array(z.string()).optional(),
});

const recipesSchema = z.object({
  count: z.number().optional(),
  recipes: z.array(recipeSchema),
});

export type VersionEntry = z.infer<typeof indexSchema>['versions'][number];

export type VersionIndex = {
  latest: VersionEntry;
  versions: VersionEntry[];
  warnings: string[];
};

type FetchResult<T> = {
  data: T;
  etag?: string;
};

type CachePayload = {
  bundle: DataBundle;
  etag?: string;
};

const CACHE_PREFIX = 'foundry-data:';
const CACHE_META_PREFIX = 'foundry-data-meta:';

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

function cacheMetaKey(version: string) {
  return `${CACHE_META_PREFIX}${version}`;
}

function cacheEntryPrefix(version: string) {
  return `${CACHE_PREFIX}${version}:`;
}

function readBundleFromCache(version: string): CachePayload | undefined {
  const storage = safeStorage();
  if (!storage) return undefined;
  const metaRaw = storage.getItem(cacheMetaKey(version));
  if (!metaRaw) return undefined;
  try {
    const meta = JSON.parse(metaRaw) as { key: string };
    const cachedRaw = storage.getItem(meta.key);
    if (!cachedRaw) return undefined;
    return JSON.parse(cachedRaw) as CachePayload;
  } catch {
    return undefined;
  }
}

function saveBundleToCache(version: string, bundle: DataBundle, etag?: string) {
  const storage = safeStorage();
  if (!storage) return;
  const keySuffix = etag ?? 'no-tag';
  const entryKey = `${cacheEntryPrefix(version)}${keySuffix}`;
  try {
    // Clean old entries for this version to avoid clutter.
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const k = storage.key(i);
      if (k && k.startsWith(cacheEntryPrefix(version))) {
        storage.removeItem(k);
      }
    }
    const payload: CachePayload = { bundle, etag };
    storage.setItem(entryKey, JSON.stringify(payload));
    storage.setItem(cacheMetaKey(version), JSON.stringify({ key: entryKey, etag }));
  } catch {
    // Ignore storage errors (quota, unavailable, etc.)
  }
}

async function fetchJson<T>(url: string, schema: z.ZodSchema<T>): Promise<FetchResult<T>> {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status} ${response.statusText})`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(`Invalid JSON from ${url}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Schema validation failed for ${url}: ${parsed.error.message}`);
  }
  return { data: parsed.data, etag: response.headers.get('etag') ?? undefined };
}

export async function loadVersionIndex(baseUrl = DEFAULT_BASE_URL, fallback?: VersionEntry): Promise<VersionIndex> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const warnings: string[] = [];
  try {
    const { data } = await fetchJson(`${cleanBase}/index.json`, indexSchema);
    const latestEntry = data.versions.find((v) => v.version === data.latest) ?? data.versions[0];
    return { latest: latestEntry, versions: data.versions, warnings };
  } catch (err) {
    if (!fallback) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    warnings.push('Remote version index unavailable; using bundled fallback version.');
    return { latest: fallback, versions: [fallback], warnings };
  }
}

function normalizeRecipe(raw: z.infer<typeof recipeSchema>, tagToMachine: Record<string, string>): Recipe {
  const inputs: Record<string, number> = {};
  const outputs: Record<string, number> = {};
  raw.inputs?.forEach((entry) => {
    inputs[entry.identifier] = entry.amount;
  });
  raw.outputs?.forEach((entry) => {
    outputs[entry.identifier] = entry.amount;
  });

  const tagId = raw.tags?.[0];
  return {
    id: raw.identifier,
    wikiTitle: raw.name ?? raw.identifier,
    name: raw.name ?? raw.identifier,
    craftedIn: tagId ? tagToMachine[tagId] ?? tagId : undefined,
    baseTimeSec: raw.timeMs !== undefined ? raw.timeMs / 1000 : undefined,
    inputs,
    outputs,
  };
}

function deriveItems(recipes: Recipe[]): Record<string, Item> {
  const map: Record<string, Item> = {};
  recipes.forEach((recipe) => {
    Object.keys(recipe.inputs ?? {}).forEach((id) => {
      map[id] ??= { id, name: id };
    });
    Object.keys(recipe.outputs ?? {}).forEach((id) => {
      map[id] ??= { id, name: id };
    });
  });
  return map;
}

function normalizeMachines(raw: z.infer<typeof machinesSchema>): {
  machines: Record<string, Machine>;
  tagToMachine: Record<string, string>;
} {
  const machines: Record<string, Machine> = {};
  const tagToMachine: Record<string, string> = {};
  Object.entries(raw.machines).forEach(([key, value]) => {
    machines[key] = { id: key, name: value.name };
    value.craftingTags?.forEach((tag) => {
      tagToMachine[tag] ??= key;
    });
  });
  return { machines, tagToMachine };
}

type BundleSource = 'network' | 'cache';

export type LoadBundleResult = {
  bundle: DataBundle;
  etag?: string;
  source: BundleSource;
};

export async function loadDataBundle(version: string, baseUrl = DEFAULT_BASE_URL): Promise<LoadBundleResult> {
  const cached = readBundleFromCache(version);
  if (cached) {
    return { bundle: cached.bundle, etag: cached.etag, source: 'cache' };
  }

  const cleanBase = baseUrl.replace(/\/$/, '');
  const manifestUrl = `${cleanBase}/${version}/manifest.json`;
  const manifestRes = await fetchJson(manifestUrl, manifestSchema);
  const manifest = manifestRes.data;

  if (!manifest.files.includes('recipes_clean.json') || !manifest.files.includes('machines.json')) {
    throw new Error(`Manifest for ${version} is missing required files.`);
  }

  const [recipesRes, machinesRes] = await Promise.all([
    fetchJson(`${cleanBase}/${version}/recipes_clean.json`, recipesSchema),
    fetchJson(`${cleanBase}/${version}/machines.json`, machinesSchema),
  ]);

  const { machines, tagToMachine } = normalizeMachines(machinesRes.data);
  const normalizedRecipes = recipesRes.data.recipes.map((r) => normalizeRecipe(r, tagToMachine));
  const items = deriveItems(normalizedRecipes);

  const bundle: DataBundle = {
    items,
    machines,
    recipes: normalizedRecipes.reduce<Record<string, Recipe>>((acc, r) => {
      acc[r.id] = r;
      return acc;
    }, {}),
    version: {
      version: manifest.version,
      title: manifest.title,
      description: manifest.description,
      publishedAt: manifest.publishedAt,
    } as VersionInfo,
  };

  const etag = [manifestRes.etag, recipesRes.etag, machinesRes.etag].filter(Boolean).join('|') || undefined;
  saveBundleToCache(version, bundle, etag);
  return { bundle, etag, source: 'network' };
}

export { DEFAULT_BASE_URL };
