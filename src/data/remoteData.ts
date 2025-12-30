import { z } from 'zod';
import type { DataBundle, Item, Machine, Recipe, VersionInfo } from './data';

const DEFAULT_BASE_URL = 'https://felixstaude.github.io/foundry-recipe-data';

const itemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

const machineSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

const recipeIoSchema = z.record(z.number());

const recipeSchema = z
  .object({
    id: z.string(),
    wikiTitle: z.string(),
    name: z.string(),
    craftedIn: z.string().nullable().optional(),
    baseTimeSec: z.number().nullable().optional(),
    inputs: recipeIoSchema.optional(),
    outputs: recipeIoSchema.optional(),
  })
  .passthrough();

const versionSchema = z
  .object({
    version: z.string().optional(),
  })
  .passthrough();

const versionEntrySchema = z.object({
  version: z.string(),
  title: z.string().optional(),
  updatedAt: z.string().optional(),
});

const versionListSchema = z.array(versionEntrySchema);

export type VersionEntry = z.infer<typeof versionEntrySchema>;

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

async function tryFetchVersionList(baseUrl: string): Promise<VersionEntry[] | undefined> {
  try {
    const { data } = await fetchJson(`${baseUrl}/versions.json`, versionListSchema);
    return data;
  } catch {
    return undefined;
  }
}

async function tryFetchLatest(baseUrl: string): Promise<VersionEntry | undefined> {
  try {
    const { data } = await fetchJson(`${baseUrl}/latest.json`, versionEntrySchema);
    return data;
  } catch {
    return undefined;
  }
}

export async function loadVersionIndex(baseUrl = DEFAULT_BASE_URL, fallback?: VersionEntry): Promise<VersionIndex> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const warnings: string[] = [];
  const [latest, list] = await Promise.all([tryFetchLatest(cleanBase), tryFetchVersionList(cleanBase)]);

  if (!latest && !list?.length) {
    if (fallback) {
      warnings.push('Remote version index unavailable; using bundled fallback version.');
      return { latest: fallback, versions: [fallback], warnings };
    }
    throw new Error('Unable to load version index from remote and no fallback provided.');
  }

  const resolvedLatest = latest ?? list?.[0];
  const versions = list ?? (resolvedLatest ? [resolvedLatest] : []);
  if (!latest) warnings.push('Latest version metadata unavailable; using first entry from versions list.');
  if (!list?.length) warnings.push('Versions list unavailable; only latest metadata is available.');

  return { latest: resolvedLatest!, versions, warnings };
}

function buildCandidatePaths(version: string) {
  const variants = new Set<string>();
  variants.add(version);
  variants.add(version.replace(/\./g, '_'));
  return Array.from(variants);
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
  const errors: string[] = [];
  for (const candidate of buildCandidatePaths(version)) {
    try {
      const [itemsRes, machinesRes, recipesRes, versionRes] = await Promise.all([
        fetchJson<Record<string, Item>>(`${cleanBase}/${candidate}/items.json`, z.record(itemSchema)),
        fetchJson<Record<string, Machine>>(`${cleanBase}/${candidate}/machines.json`, z.record(machineSchema)),
        fetchJson<Record<string, Recipe>>(`${cleanBase}/${candidate}/recipes.json`, z.record(recipeSchema)),
        fetchJson<VersionInfo>(`${cleanBase}/${candidate}/version.json`, versionSchema),
      ]);
      const etag = [itemsRes.etag, machinesRes.etag, recipesRes.etag, versionRes.etag].filter(Boolean).join('|') || undefined;
      const bundle: DataBundle = {
        items: itemsRes.data,
        machines: machinesRes.data,
        recipes: recipesRes.data,
        version: versionRes.data,
      };
      saveBundleToCache(version, bundle, etag);
      return { bundle, etag, source: 'network' };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(`Failed to load version "${version}": ${errors.join(' | ')}`);
}

export { DEFAULT_BASE_URL };
