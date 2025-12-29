import { Recipe, extractTierInfo } from '../data/data';

export type RecipeSelection = {
  overrides: Record<string, string>;
  tierPreferences: Record<string, number>;
};

export type ProducerMap = Record<string, Recipe[]>;

export function buildProducerMap(recipes: Record<string, Recipe>): ProducerMap {
  const map: ProducerMap = {};
  Object.values(recipes).forEach((recipe) => {
    Object.keys(recipe.outputs ?? {}).forEach((outputId) => {
      map[outputId] ??= [];
      map[outputId].push(recipe);
    });
  });
  Object.values(map).forEach((list) => list.sort((a, b) => a.id.localeCompare(b.id)));
  return map;
}

function pickByTier(recipes: Recipe[], baseName: string, tierPreference?: number) {
  const withTier = recipes.filter((r) => extractTierInfo(r).tier !== undefined);
  if (withTier.length === 0) {
    return undefined;
  }
  const desiredTier = tierPreference ?? 1;
  const exact = withTier.find((r) => extractTierInfo(r).tier === desiredTier);
  if (exact) return exact;
  const sorted = [...withTier].sort((a, b) => (extractTierInfo(a).tier ?? 0) - (extractTierInfo(b).tier ?? 0));
  return sorted[0];
}

export function chooseRecipeForItem(
  itemId: string,
  producers: ProducerMap,
  selection: RecipeSelection,
): Recipe | undefined {
  const candidates = producers[itemId];
  if (!candidates || candidates.length === 0) return undefined;

  const overrideId = selection.overrides[itemId];
  if (overrideId) {
    const match = candidates.find((r) => r.id === overrideId);
    if (match) return match;
  }

  const tiered = candidates.filter((r) => extractTierInfo(r).tier !== undefined);
  if (tiered.length > 0) {
    const baseName = extractTierInfo(tiered[0]).baseName;
    const tierPreference = selection.tierPreferences[baseName];
    const picked = pickByTier(tiered, baseName, tierPreference);
    if (picked) return picked;
  }

  return [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0];
}

export function listRecipeOptions(itemId: string, producers: ProducerMap): { id: string; label: string }[] {
  return (producers[itemId] ?? []).map((r) => ({ id: r.id, label: r.name })).sort((a, b) => a.label.localeCompare(b.label));
}
