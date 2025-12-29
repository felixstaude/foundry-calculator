import { DataBundle, Recipe } from '../data/data';
import { RecipeSelection, ProducerMap, chooseRecipeForItem } from './recipes';

export type RequirementNode = {
  itemId: string;
  itemName: string;
  desiredPerMin: number;
  recipe?: Recipe;
  recipeId?: string;
  craftedIn?: string | null;
  baseTimeSec?: number | null;
  craftsPerMinNeeded?: number;
  machinesNeeded?: number;
  actualOutputPerMin?: number;
  outputPerCraft?: number;
  inputs: RequirementEdge[];
  warnings: string[];
  cycle?: boolean;
  missingRecipe?: boolean;
};

export type RequirementEdge = {
  itemId: string;
  itemName: string;
  perMinute: number;
  node?: RequirementNode;
};

export type CalculationOptions = {
  roundUpMachines: boolean;
  selection: RecipeSelection;
};

export type CalculationResult = {
  root?: RequirementNode;
  totals: Record<string, number>;
};

function formatNumber(value: number) {
  return Number.parseFloat(value.toFixed(3));
}

export function buildCalculation(
  itemId: string,
  desiredPerMin: number,
  data: DataBundle,
  producers: ProducerMap,
  options: CalculationOptions,
): CalculationResult {
  const totals: Record<string, number> = {};
  const visited = new Set<string>();

  const traverse = (currentItemId: string, targetPerMin: number): RequirementNode => {
    const itemName = data.items[currentItemId]?.name ?? currentItemId;

    if (visited.has(currentItemId)) {
      return {
        itemId: currentItemId,
        itemName,
        desiredPerMin: targetPerMin,
        inputs: [],
        warnings: [`Cycle detected for ${itemName}; stopping expansion.`],
        cycle: true,
      };
    }

    visited.add(currentItemId);
    const recipe = chooseRecipeForItem(currentItemId, producers, options.selection);

    if (!recipe) {
      totals[currentItemId] = (totals[currentItemId] ?? 0) + targetPerMin;
      visited.delete(currentItemId);
      return {
        itemId: currentItemId,
        itemName,
        desiredPerMin: targetPerMin,
        inputs: [],
        warnings: ['No recipe found; treat as raw input.'],
        missingRecipe: true,
      };
    }

    const outputs = recipe.outputs ?? {};
    const outputAmount = outputs[currentItemId] ?? Object.values(outputs)[0];
    const warnings: string[] = [];

    if (outputAmount === undefined || outputAmount === 0) {
      warnings.push('Recipe output is missing or zero; cannot compute rates.');
      visited.delete(currentItemId);
      return {
        itemId: currentItemId,
        itemName,
        desiredPerMin: targetPerMin,
        recipe,
        recipeId: recipe.id,
        baseTimeSec: recipe.baseTimeSec ?? null,
        craftedIn: recipe.craftedIn ?? null,
        inputs: [],
        warnings,
      };
    }

    const craftsPerMinNeeded = targetPerMin / outputAmount;
    const inputs = recipe.inputs ?? {};
    const baseTime = recipe.baseTimeSec ?? undefined;
    const craftedIn = recipe.craftedIn ?? null;
    let machinesNeeded: number | undefined;
    let actualOutputPerMin: number | undefined;
    let craftsPerMinActual = craftsPerMinNeeded;

    if (baseTime !== undefined && baseTime !== null) {
      const craftsPerMinPerMachine = 60 / baseTime;
      machinesNeeded = craftsPerMinNeeded / craftsPerMinPerMachine;
      if (options.roundUpMachines) {
        machinesNeeded = Math.ceil(machinesNeeded * 1000) / 1000;
      }
      craftsPerMinActual = (machinesNeeded ?? 0) * craftsPerMinPerMachine;
      actualOutputPerMin = craftsPerMinActual * outputAmount;
    } else {
      warnings.push('baseTimeSec missing; machine count unavailable.');
    }

    if (!craftedIn) {
      warnings.push('craftedIn missing; machine family unknown.');
    }

    const edges: RequirementEdge[] = Object.entries(inputs).map(([inputId, amount]) => {
      const inputName = data.items[inputId]?.name ?? inputId;
      const perMinute = craftsPerMinActual * amount;
      totals[inputId] = (totals[inputId] ?? 0) + perMinute;
      return { itemId: inputId, itemName: inputName, perMinute };
    });

    const node: RequirementNode = {
      itemId: currentItemId,
      itemName,
      desiredPerMin: targetPerMin,
      recipe,
      recipeId: recipe.id,
      craftedIn,
      baseTimeSec: recipe.baseTimeSec ?? null,
      craftsPerMinNeeded: formatNumber(craftsPerMinNeeded),
      machinesNeeded: machinesNeeded !== undefined ? formatNumber(machinesNeeded) : undefined,
      outputPerCraft: outputAmount,
      actualOutputPerMin: actualOutputPerMin !== undefined ? formatNumber(actualOutputPerMin) : undefined,
      inputs: [],
      warnings,
    };

    edges.forEach((edge) => {
      const child = traverse(edge.itemId, edge.perMinute);
      edge.node = child;
      node.inputs.push(edge);
    });

    visited.delete(currentItemId);
    return node;
  };

  const root = traverse(itemId, desiredPerMin);
  return { root, totals };
}
