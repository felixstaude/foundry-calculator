import { useEffect, useMemo, useState } from 'react';
import { dataBundle, extractTierInfo } from './data/data';
import { buildProducerMap } from './logic/recipes';
import { buildCalculation, RequirementNode } from './logic/calculator';
import type { RecipeSelection } from './logic/recipes';

const producers = buildProducerMap(dataBundle.recipes);

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatDisplay(value?: number) {
  if (value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value);
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type Option = { value: string; label: string };

type GraphNode = {
  id: string;
  label: string;
  machine: string;
  machinesNeeded?: number;
  outputPerMin?: number;
  depth: number;
};

type GraphEdge = {
  from: string;
  to: string;
  label: string;
};

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

function MachineSelector({
  machineChoices,
  onChange,
}: {
  machineChoices: Record<string, string>;
  onChange: (familyId: string, machineId?: string) => void;
}) {
  const families = useMemo(() => {
    const craftedFamilies = new Set<string>();
    Object.values(dataBundle.recipes).forEach((recipe) => {
      if (recipe.craftedIn) craftedFamilies.add(recipe.craftedIn);
    });
    return Array.from(craftedFamilies)
      .map((id) => ({ id, label: dataBundle.machines[id]?.name ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const options = Object.values(dataBundle.machines).sort((a, b) => a.name.localeCompare(b.name));

  if (families.length === 0) return null;

  return (
    <details className="card space-y-3 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Machine tier preferences</summary>
      <p className="text-sm text-slate-300">
        Choose which machine tier/type to display for each crafting family (e.g., assembler, smelter). This does not
        change speed in the current data set but helps plan which tier you want to build.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {families.map((family) => (
          <div key={family.id} className="space-y-1 rounded-md border border-slate-800 bg-slate-900/50 p-3">
            <p className="text-sm font-semibold text-slate-100">{family.label}</p>
            <select
              className="input"
              value={machineChoices[family.id] ?? ''}
              onChange={(e) => onChange(family.id, e.target.value || undefined)}
            >
              <option value="">Default ({family.label})</option>
              {options.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </details>
  );
}

function buildGraphData(
  node: RequirementNode,
  machineLabel: (id?: string | null) => string,
): { nodes: GraphNode[]; edges: GraphEdge[]; minDepth: number; maxDepth: number } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  let minDepth = 0;
  let maxDepth = 0;

  const walk = (current: RequirementNode, depth: number) => {
    const id = current.recipeId ?? `raw-${current.itemId}`;
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);

    if (!seen.has(id)) {
      nodes.push({
        id,
        label: current.recipe?.name ?? `${current.itemName} (raw)`,
        machine: current.recipe ? machineLabel(current.craftedIn) : 'Raw resource',
        machinesNeeded: current.machinesNeeded,
        outputPerMin: current.actualOutputPerMin ?? current.desiredPerMin,
        depth,
      });
      seen.add(id);
    }

    current.inputs.forEach((edge) => {
      if (edge.node) {
        const childId = edge.node.recipeId ?? `raw-${edge.node.itemId}`;
        edges.push({
          from: childId,
          to: id,
          label: `${edge.itemName}: ${formatDisplay(edge.perMinute)} / min`,
        });
        walk(edge.node, depth - 1);
      }
    });
  };

  walk(node, 0);
  return { nodes, edges, minDepth, maxDepth };
}

const CARD_WIDTH = 220;
const CARD_HEIGHT = 120;

function ProductionGraph({
  root,
  machineLabel,
}: {
  root: RequirementNode;
  machineLabel: (id?: string | null) => string;
}) {
  const { nodes, edges, minDepth, maxDepth } = useMemo(() => buildGraphData(root, machineLabel), [root, machineLabel]);

  const depthGroups = useMemo(() => {
    const groups: Record<number, GraphNode[]> = {};
    nodes.forEach((n) => {
      const col = n.depth;
      groups[col] ??= [];
      groups[col].push(n);
    });
    Object.values(groups).forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label)));
    return groups;
  }, [nodes]);

  const normalizedGroups = useMemo(() => {
    const offset = -minDepth;
    const normalized: Record<number, GraphNode[]> = {};
    Object.entries(depthGroups).forEach(([depthStr, list]) => {
      const depth = Number(depthStr);
      normalized[depth + offset] = list;
    });
    return normalized;
  }, [depthGroups, minDepth]);

  const columnCount = maxDepth - minDepth + 1;
  const maxRows = Math.max(...Object.values(normalizedGroups).map((g) => g.length));
  const svgWidth = columnCount * (CARD_WIDTH + 80);
  const svgHeight = (maxRows + 1) * (CARD_HEIGHT + 40);

  const positions: Record<string, { x: number; y: number }> = {};
  Object.entries(normalizedGroups).forEach(([colStr, list]) => {
    const col = Number(colStr);
    list.forEach((node, index) => {
      positions[node.id] = {
        x: col * (CARD_WIDTH + 80) + 20,
        y: index * (CARD_HEIGHT + 40) + 20,
      };
    });
  });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Production graph</h2>
        <p className="text-xs text-slate-400">Flows left → right (raw to final)</p>
      </div>
      <div className="relative mt-4 overflow-auto" style={{ height: Math.min(svgHeight + 40, 640) }}>
        <svg width={svgWidth} height={svgHeight} className="absolute left-0 top-0">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L10,5 L0,10 z" fill="#818cf8" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;
            const startX = from.x + CARD_WIDTH;
            const startY = from.y + CARD_HEIGHT / 2;
            const endX = to.x;
            const endY = to.y + CARD_HEIGHT / 2;
            const midX = (startX + endX) / 2;
            return (
              <g key={`${edge.from}-${edge.to}-${edge.label}`}>
                <path
                  d={`M ${startX} ${startY} C ${midX} ${startY} ${midX} ${endY} ${endX} ${endY}`}
                  fill="none"
                  stroke="#818cf8"
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                />
                <text x={midX} y={(startY + endY) / 2 - 6} className="text-xs fill-indigo-200" textAnchor="middle">
                  {edge.label}
                </text>
              </g>
            );
          })}
        </svg>
        {nodes.map((node) => {
          const pos = positions[node.id];
          return (
            <div
              key={node.id}
              className="absolute w-[220px] rounded-lg border border-slate-800 bg-slate-900/80 p-3 shadow-lg shadow-slate-900/40"
              style={{ left: pos.x, top: pos.y }}
            >
              <p className="text-sm font-semibold text-slate-50">{node.label}</p>
              <p className="text-xs text-slate-400">{node.machine}</p>
              <p className="text-xs text-slate-300 mt-1">Machines: {formatDisplay(node.machinesNeeded)}</p>
              <p className="text-xs text-slate-300">Output: {formatDisplay(node.outputPerMin)} / min</p>
            </div>
          );
        })}
      </div>
    </div>
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
  const [machineChoices, setMachineChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const item = params.get('item');
    const rateParam = params.get('rate');
    const roundParam = params.get('round');
    const tiersParam = params.get('tiers');
    const overridesParam = params.get('overrides');
    const machinesParam = params.get('machines');

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

    if (machinesParam) {
      const parsed: Record<string, string> = {};
      machinesParam.split(';').forEach((entry) => {
        const [family, machineId] = entry.split(':');
        if (family && machineId) parsed[family] = machineId;
      });
      setMachineChoices(parsed);
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

    const machineEntries = Object.entries(machineChoices)
      .map(([family, machine]) => `${family}:${machine}`)
      .join(';');
    if (machineEntries) params.set('machines', machineEntries);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, [desiredRate, machineChoices, recipeOverrides, roundUpMachines, selectedItemId, tierPreferences]);

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

  const machineLabel = (craftedIn?: string | null) => {
    if (!craftedIn) return 'Unknown machine';
    const chosen = machineChoices[craftedIn] ?? craftedIn;
    return dataBundle.machines[chosen]?.name ?? chosen;
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
              step={1}
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
        <div className="space-y-3">
          <MachineSelector
            machineChoices={machineChoices}
            onChange={(familyId, machineId) =>
              setMachineChoices((prev) => {
                const next = { ...prev };
                if (!machineId) delete next[familyId];
                else next[familyId] = machineId;
                return next;
              })
            }
          />
          <details className="card space-y-3 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced recipe overrides</summary>
            <p className="text-sm text-slate-300">
              Choose which recipe to use for a given item when multiple producers exist. Overrides are saved in the
              shareable URL.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(producers)
                .filter(([, recipes]) => recipes.length > 1)
                .map(([itemId, recipes]) => ({
                  itemId,
                  name: dataBundle.items[itemId]?.name ?? itemId,
                  recipes,
                }))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((entry) => (
                  <div key={entry.itemId} className="space-y-1 rounded-md border border-slate-800 bg-slate-900/50 p-3">
                    <p className="text-sm font-semibold text-slate-100">{entry.name}</p>
                    <select
                      className="input"
                      value={selection.overrides[entry.itemId] ?? ''}
                      onChange={(e) =>
                        setRecipeOverrides((prev) => {
                          const next = { ...prev };
                          const value = e.target.value;
                          if (!value) delete next[entry.itemId];
                          else next[entry.itemId] = value;
                          return next;
                        })
                      }
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
        </div>
      </div>

      {calculation.root ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard title="Target" value={`${formatDisplay(desiredRate)} / min`} sub={calculation.root.itemName} />
            <SummaryCard
              title="Machines needed"
              value={formatDisplay(calculation.root.machinesNeeded)}
              sub={machineLabel(calculation.root.craftedIn)}
            />
            <SummaryCard
              title="Base time"
              value={
                calculation.root.baseTimeSec !== null && calculation.root.baseTimeSec !== undefined
                  ? `${formatDisplay(calculation.root.baseTimeSec)}s`
                  : 'Unknown'
              }
              sub={calculation.root.recipe?.name ?? 'No recipe'}
            />
            <SummaryCard
              title="Actual output"
              value={
                calculation.root.actualOutputPerMin !== undefined
                  ? `${formatDisplay(calculation.root.actualOutputPerMin)} / min`
                  : `${formatDisplay(desiredRate)} / min`
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
                        <td className="p-2">{formatDisplay(row.perMin)}</td>
                        <td className="p-2">{formatDisplay(row.perSec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <ProductionGraph root={calculation.root} machineLabel={machineLabel} />

          <WarningList warnings={collectWarnings(calculation.root)} />
        </div>
      ) : (
        <div className="text-sm text-slate-300">Select an item and set a target rate to see calculations.</div>
      )}
    </div>
  );
}

export default App;
