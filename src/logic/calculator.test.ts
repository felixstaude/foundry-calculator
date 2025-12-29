import { describe, expect, it } from 'vitest';
import { dataBundle } from '../data/data';
import { buildProducerMap } from './recipes';
import { buildCalculation } from './calculator';

const producers = buildProducerMap(dataBundle.recipes);

describe('buildCalculation', () => {
  it('computes machines and inputs for Xenoferrite Plates Tier 1', () => {
    const result = buildCalculation('xenoferrite_plates', 20, dataBundle, producers, {
      roundUpMachines: false,
      selection: { overrides: {}, tierPreferences: { 'Xenoferrite Plates': 1 } },
    });

    expect(result.root?.recipe?.id).toBe('recipe_xenoferrite_plates_tier_1');
    expect(result.root?.machinesNeeded).toBeCloseTo(1);
    expect(result.totals['xenoferrite_ore_rubble']).toBeCloseTo(20);
  });

  it('rounds machines up when requested', () => {
    const result = buildCalculation('xenoferrite_plates', 25, dataBundle, producers, {
      roundUpMachines: true,
      selection: { overrides: {}, tierPreferences: { 'Xenoferrite Plates': 1 } },
    });

    expect(result.root?.machinesNeeded).toBe(2);
    expect(result.totals['xenoferrite_ore_rubble']).toBeCloseTo(40);
  });

  it('handles missing baseTimeSec by skipping machine math but still propagating inputs', () => {
    const result = buildCalculation('xenoferrite_plates', 10, dataBundle, producers, {
      roundUpMachines: false,
      selection: { overrides: { xenoferrite_plates: 'recipe_xenoferrite_plates' }, tierPreferences: {} },
    });

    expect(result.root?.machinesNeeded).toBeUndefined();
    expect(result.root?.warnings.some((w) => w.includes('baseTimeSec missing'))).toBe(true);
    expect(result.totals['xenoferrite_ore_rubble']).toBeCloseTo(20);
  });
});
