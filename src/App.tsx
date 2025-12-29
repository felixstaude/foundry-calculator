import { useEffect, useMemo, useState } from 'react';
import { dataBundle, extractTierInfo } from './data/data';
import { buildProducerMap } from './logic/recipes';
import { buildCalculation, RequirementNode } from './logic/calculator';
import type { RecipeSelection } from './logic/recipes';

const producers = buildProducerMap(dataBundle.recipes);

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

type Option = { value: string; label: string };

function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="text-xs text-slate-400">{options.length} items</span>
      </div>
      <input
        className="input"
        placeholder={placeholder ?? 'Search items'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        type="search"
      />
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Select an item
        </option>
        {filtered.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SummaryCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-50">{value}</p>
      {sub ? <p className="text-sm text-slate-400">{sub}</p> : null}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-950/40 p-3 text-amber-100">
      <p className="text-sm font-semibold">Warnings</p>
      <ul className="list-disc pl-5 text-sm">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function TreeNodeView({ node, depth = 0 }: { node: RequirementNode; depth?: number }) {
  return (
    <div className={classNames('border-l border-slate-800 pl-4', depth === 0 && 'border-l-0 pl-0')}>
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-900/60 p-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">{node.itemName}</p>
          <p className="text-xs text-slate-400">Target: {node.desiredPerMin.toFixed(3)} / min</p>
        </div>
        {node.recipe ? (
          <div className="text-xs text-slate-300">
            <p>Recipe: {node.recipe.name}</p>
            {node.craftedIn ? <p>Crafted in: {node.craftedIn}</p> : null}
            {node.baseTimeSec ? <p>baseTimeSec: {node.baseTimeSec}s</p> : null}
            {node.machinesNeeded !== undefined ? <p>Machines needed: {node.machinesNeeded}</p> : null}
            {node.actualOutputPerMin !== undefined ? (
              <p>Output: {node.actualOutputPerMin} / min</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-slate-400">No recipe available.</p>
        )}
        {node.warnings.length > 0 ? (
          <div className="text-xs text-amber-300">{node.warnings.join(' ')} </div>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">
        {node.inputs.map((edge) => (
          <div key={edge.itemId}>
            <p className="text-xs text-indigo-200">
              Requires {edge.perMinute.toFixed(3)} / min of {edge.itemName}
            </p>
            {edge.node ? <TreeNodeView node={edge.node} depth={depth + 1} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function Overrides({
  selection,
  onOverride,
}: {
  selection: RecipeSelection;
  onOverride: (itemId: string, recipeId: string | undefined) => void;
}) {
  const multiRecipeItems = Object.entries(producers)
    .filter(([, recipes]) => recipes.length > 1)
    .map(([itemId, recipes]) => ({
      itemId,
      name: dataBundle.items[itemId]?.name ?? itemId,
      recipes,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <details className="card space-y-3 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced recipe overrides</summary>
      <p className="text-sm text-slate-300">
        Choose which recipe to use for a given item when multiple producers exist. Overrides are also saved in the
        shareable URL.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {multiRecipeItems.map((entry) => (
          <div key={entry.itemId} className="space-y-1 rounded-md border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-sm font-semibold text-slate-100">{entry.name}</p>
            <select
              className="input"
              value={selection.overrides[entry.itemId] ?? ''}
              onChange={(e) => onOverride(entry.itemId, e.target.value || undefined)}
            >
              <option value="">Default (tier preference)</option>
              {entry.recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </details>
  );
}

function App() {
  const itemOptions: Option[] = useMemo(
    () =>
      Object.values(dataBundle.items)
        .map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  const [selectedItemId, setSelectedItemId] = useState('');
  const [desiredRate, setDesiredRate] = useState(60);
  const [roundUpMachines, setRoundUpMachines] = useState(false);
  const [tierPreferences, setTierPreferences] = useState<Record<string, number>>({});
  const [recipeOverrides, setRecipeOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const item = params.get('item');
    const rateParam = params.get('rate');
    const roundParam = params.get('round');
    const tiersParam = params.get('tiers');
    const overridesParam = params.get('overrides');

    if (item) setSelectedItemId(item);
    if (rateParam) setDesiredRate(Number.parseFloat(rateParam));
    if (roundParam) setRoundUpMachines(roundParam === '1');

    if (tiersParam) {
      const parsed: Record<string, number> = {};
      tiersParam.split(';').forEach((entry) => {
        const [base, tierStr] = entry.split(':');
        if (base && tierStr) parsed[decodeURIComponent(base)] = Number.parseInt(tierStr, 10);
      });
      setTierPreferences(parsed);
    }

    if (overridesParam) {
      const parsed: Record<string, string> = {};
      overridesParam.split(';').forEach((entry) => {
        const [itemId, recipeId] = entry.split(':');
        if (itemId && recipeId) parsed[itemId] = recipeId;
      });
      setRecipeOverrides(parsed);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedItemId) params.set('item', selectedItemId);
    if (desiredRate) params.set('rate', desiredRate.toString());
    if (roundUpMachines) params.set('round', '1');

    const tierEntries = Object.entries(tierPreferences)
      .map(([base, tier]) => `${encodeURIComponent(base)}:${tier}`)
      .join(';');
    if (tierEntries) params.set('tiers', tierEntries);

    const overrideEntries = Object.entries(recipeOverrides)
      .map(([item, recipe]) => `${item}:${recipe}`)
      .join(';');
    if (overrideEntries) params.set('overrides', overrideEntries);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, [desiredRate, recipeOverrides, roundUpMachines, selectedItemId, tierPreferences]);

  const selection: RecipeSelection = useMemo(
    () => ({ overrides: recipeOverrides, tierPreferences }),
    [recipeOverrides, tierPreferences],
  );

  const activeVariants = useMemo(() => {
    if (!selectedItemId) return undefined;
    const producersForItem = producers[selectedItemId] ?? [];
    const tiered = producersForItem.filter((r) => extractTierInfo(r).tier !== undefined);
    if (tiered.length === 0) return undefined;
    const baseName = extractTierInfo(tiered[0]).baseName;
    return { baseName, recipes: tiered };
  }, [selectedItemId]);

  const calculation = useMemo(() => {
    if (!selectedItemId || Number.isNaN(desiredRate) || desiredRate <= 0) return { root: undefined, totals: {} };
    return buildCalculation(selectedItemId, desiredRate, dataBundle, producers, {
      roundUpMachines,
      selection,
    });
  }, [desiredRate, roundUpMachines, selectedItemId, selection]);

  const variantOptions: Option[] | undefined = useMemo(() => {
    if (!activeVariants) return undefined;
    return activeVariants.recipes
      .sort((a, b) => (extractTierInfo(a).tier ?? 0) - (extractTierInfo(b).tier ?? 0))
      .map((recipe) => ({
        value: recipe.id,
        label: recipe.name,
      }));
  }, [activeVariants]);

  const selectedTier = activeVariants ? tierPreferences[activeVariants.baseName] ?? 1 : undefined;

  const setVariantChoice = (recipeId: string) => {
    if (!activeVariants) return;
    const recipe = activeVariants.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;
    const info = extractTierInfo(recipe);
    setTierPreferences((prev) => ({ ...prev, [activeVariants.baseName]: info.tier ?? 1 }));
  };

  const totalsEntries = useMemo(
    () =>
      Object.entries(calculation.totals)
        .map(([itemId, perMin]) => ({
          itemId,
          perMin,
          perSec: perMin / 60,
          name: dataBundle.items[itemId]?.name ?? itemId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [calculation.totals],
  );

  const collectWarnings = (node?: RequirementNode): string[] => {
    if (!node) return [];
    const childWarnings = node.inputs.flatMap((edge) => collectWarnings(edge.node));
    return [...node.warnings, ...childWarnings];
  };

  const version = dataBundle.version.version ?? 'unknown';

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-50">Foundry Calculator</h1>
          <p className="text-slate-400">Data version {version} · React + Vite + Tailwind (static deploy ready)</p>
        </div>
        <a
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500"
          href="https://github.com/felixstaude/foundry-data"
          target="_blank"
          rel="noreferrer"
        >
          Source data
        </a>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-4">
          <SearchableSelect
            label="Target item"
            options={itemOptions}
            value={selectedItemId}
            onChange={setSelectedItemId}
            placeholder="Search by name or id"
          />
          <div className="space-y-2">
            <label className="label" htmlFor="desiredRate">
              Desired output rate (items/min)
            </label>
            <input
              id="desiredRate"
              className="input"
              type="number"
              min={0}
              step={0.1}
              value={desiredRate}
              onChange={(e) => setDesiredRate(Number.parseFloat(e.target.value))}
            />
          </div>
          {variantOptions && activeVariants ? (
            <div className="space-y-2">
              <label className="label">Variant / tier</label>
              <select
                className="input"
                value={
                  activeVariants.recipes.find((r) => extractTierInfo(r).tier === selectedTier)?.id ?? ''
                }
                onChange={(e) => setVariantChoice(e.target.value)}
              >
                {variantOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400">Defaulting to Tier 1 when available.</p>
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <input
              id="roundUp"
              type="checkbox"
              className="h-4 w-4 accent-indigo-500"
              checked={roundUpMachines}
              onChange={(e) => setRoundUpMachines(e.target.checked)}
            />
            <label className="label" htmlFor="roundUp">
              Round machines up
            </label>
          </div>
        </div>
        <Overrides
          selection={selection}
          onOverride={(itemId, recipeId) => {
            setRecipeOverrides((prev) => {
              const next = { ...prev };
              if (!recipeId) delete next[itemId];
              else next[itemId] = recipeId;
              return next;
            });
          }}
        />
      </div>

      {calculation.root ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard title="Target" value={`${desiredRate.toFixed(3)} / min`} sub={calculation.root.itemName} />
            <SummaryCard
              title="Machines needed"
              value={calculation.root.machinesNeeded !== undefined ? `${calculation.root.machinesNeeded}` : 'Unknown'}
              sub={calculation.root.craftedIn ?? 'N/A'}
            />
            <SummaryCard
              title="Base time"
              value={
                calculation.root.baseTimeSec !== null && calculation.root.baseTimeSec !== undefined
                  ? `${calculation.root.baseTimeSec}s`
                  : 'Unknown'
              }
              sub={calculation.root.recipe?.name ?? 'No recipe'}
            />
            <SummaryCard
              title="Actual output"
              value={
                calculation.root.actualOutputPerMin !== undefined
                  ? `${calculation.root.actualOutputPerMin} / min`
                  : `${desiredRate.toFixed(3)} / min`
              }
              sub={roundUpMachines ? 'Rounded machines may exceed target' : 'Exact machines'}
            />
          </div>

          <div className="card p-4">
            <h2 className="text-lg font-semibold text-slate-100">Inputs per minute (aggregated)</h2>
            {totalsEntries.length === 0 ? (
              <p className="text-sm text-slate-400">No inputs calculated yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead>
                    <tr className="text-left text-slate-300">
                      <th className="p-2">Item</th>
                      <th className="p-2">Per minute</th>
                      <th className="p-2">Per second</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totalsEntries.map((row) => (
                      <tr key={row.itemId} className="border-t border-slate-800">
                        <td className="p-2">{row.name}</td>
                        <td className="p-2">{row.perMin.toFixed(3)}</td>
                        <td className="p-2">{row.perSec.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-100">Crafting tree</h2>
              <p className="text-xs text-slate-400">Collapsible via nested cards</p>
            </div>
            <TreeNodeView node={calculation.root} />
          </div>

          <WarningList warnings={collectWarnings(calculation.root)} />
        </div>
      ) : (
        <div className="text-sm text-slate-300">Select an item and set a target rate to see calculations.</div>
      )}
    </div>
  );
}

export default App;
