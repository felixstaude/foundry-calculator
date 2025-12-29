import itemsJson from '../../data/v0_6_0_23789/items.json';
import machinesJson from '../../data/v0_6_0_23789/machines.json';
import recipesJson from '../../data/v0_6_0_23789/recipes.json';
import versionJson from '../../data/v0_6_0_23789/version.json';

export type Item = {
  id: string;
  name: string;
};

export type Machine = {
  id: string;
  name: string;
};

export type RecipeIO = Record<string, number>;

export type Recipe = {
  id: string;
  wikiTitle: string;
  name: string;
  craftedIn?: string | null;
  baseTimeSec?: number | null;
  inputs?: RecipeIO;
  outputs?: RecipeIO;
};

export type VersionInfo = {
  version?: string;
  [key: string]: unknown;
};

export type DataBundle = {
  items: Record<string, Item>;
  machines: Record<string, Machine>;
  recipes: Record<string, Recipe>;
  version: VersionInfo;
};

export const dataBundle: DataBundle = {
  items: itemsJson as Record<string, Item>,
  machines: machinesJson as Record<string, Machine>,
  recipes: recipesJson as Record<string, Recipe>,
  version: versionJson as VersionInfo,
};

export type TierInfo = {
  baseName: string;
  tier?: number;
};

export function extractTierInfo(recipe: Recipe): TierInfo {
  const source = recipe.name || recipe.wikiTitle;
  const match = source.match(/\(\s*Tier[_\s]?([0-9]+)\s*\)/i);
  const tier = match ? Number.parseInt(match[1], 10) : undefined;
  const baseName = match ? source.replace(match[0], '').trim() : source;
  return { baseName, tier };
}

export function groupVariants(recipes: Record<string, Recipe>) {
  const groups: Record<string, Recipe[]> = {};
  Object.values(recipes).forEach((recipe) => {
    const info = extractTierInfo(recipe);
    if (info.tier !== undefined) {
      groups[info.baseName] ??= [];
      groups[info.baseName].push(recipe);
    }
  });
  Object.values(groups).forEach((list) => list.sort((a, b) => (extractTierInfo(a).tier ?? 0) - (extractTierInfo(b).tier ?? 0)));
  return groups;
}
