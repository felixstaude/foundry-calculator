import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  getBezierPath,
  Position,
  Handle,
  useStoreApi,
  useEdgesState,
  useNodesState,
  type EdgeProps,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
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
  return rounded.toString();
}

function formatEdgeRate(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded.toFixed(1)}`;
}

type Option = { value: string; label: string };

type GraphNode = {
  id: string;
  label: string;
  machine: string;
  machinesNeeded?: number;
  outputPerMin?: number;
  depth: number;
  stage: 'raw' | 'smelting' | 'assembly' | 'final';
  isTarget?: boolean;
};

type GraphEdge = {
  from: string;
  to: string;
  itemId: string;
  itemName: string;
  perMinute: number;
};

type FlowEdgeData = {
  label: string;
  color: string;
  width: number;
  hoverLabel: string;
  offset?: number;
  hovering?: boolean;
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

function classifyStage(current: RequirementNode, targetItemId: string): GraphNode['stage'] {
  if (!current.recipe || !current.craftedIn) return 'raw';
  if (current.itemId === targetItemId) return 'final';
  const machine = current.craftedIn.toLowerCase();
  if (machine.includes('smelt') || machine.includes('casting')) return 'smelting';
  return 'assembly';
}

function buildGraphData(
  node: RequirementNode,
  machineLabel: (id?: string | null) => string,
  targetItemId: string,
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columns: Record<number, GraphNode[]>;
  minDepth: number;
  maxDepth: number;
} {
  const nodes: GraphNode[] = [];
  const edgeList: GraphEdge[] = [];
  const seen = new Map<string, GraphNode>();
  let minDepth = 0;
  let maxDepth = 0;

  const walk = (current: RequirementNode, depth: number) => {
    const id = current.recipeId ?? `raw-${current.itemId}`;
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);

    if (!seen.has(id)) {
      const stage = classifyStage(current, targetItemId);
      const nodeEntry: GraphNode = {
        id,
        label: current.itemName,
        machine: current.recipe ? machineLabel(current.craftedIn) : 'Raw resource',
        machinesNeeded: current.machinesNeeded,
        outputPerMin: current.actualOutputPerMin ?? current.desiredPerMin,
        depth,
        stage,
        isTarget: current.itemId === targetItemId,
      };
      nodes.push(nodeEntry);
      seen.set(id, nodeEntry);
    }

    current.inputs.forEach((edge) => {
      if (edge.node) {
        const childId = edge.node.recipeId ?? `raw-${edge.node.itemId}`;
        edgeList.push({
          from: childId,
          to: id,
          itemId: edge.itemId,
          itemName: edge.itemName,
          perMinute: edge.perMinute,
        });
        walk(edge.node, depth - 1);
      }
    });
  };

  walk(node, 0);

  const columns: Record<number, GraphNode[]> = {};
  nodes.forEach((n) => {
    columns[n.depth] ??= [];
    columns[n.depth].push(n);
  });

  // heuristic: sort nodes within column to align with neighbors (average target depth)
  Object.entries(columns).forEach(([depthStr, list]) => {
    const depth = Number(depthStr);
    const incoming = edgeList.filter((e) => (columns[depth - 1] ?? []).some((n) => n.id === e.from));
    const scores = new Map<string, number>();
    list.forEach((n) => scores.set(n.id, 0));
    incoming.forEach((e) => {
      scores.set(e.to, (scores.get(e.to) ?? 0) + 1);
    });
    list.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.label.localeCompare(b.label));
  });

  // bundle edges per item between columns
  const bundled: GraphEdge[] = [];
  const bundleKey = (e: GraphEdge) => `${e.from}->${e.to}:${e.itemId}`;
  const temp = new Map<string, GraphEdge>();
  edgeList.forEach((e) => {
    const key = bundleKey(e);
    const existing = temp.get(key);
    if (existing) {
      existing.perMinute += e.perMinute;
    } else {
      temp.set(key, { ...e });
    }
  });
  temp.forEach((v) => bundled.push(v));

  return { nodes, edges: bundled, columns, minDepth, maxDepth };
}

const CARD_WIDTH = 240;
const CARD_HEIGHT = 130;

function hashColor(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 60%)`;
}

function CardNode({ data }: NodeProps<GraphNode>) {
  const borderColor = data.isTarget ? 'border-indigo-400 shadow-indigo-500/40' : data.stage === 'raw' ? 'border-slate-700' : 'border-slate-800';
  return (
    <div className={classNames('w-[240px] rounded-lg border bg-slate-900/90 p-3 shadow-lg shadow-slate-900/40', borderColor)}>
      <Handle type="target" position={Position.Left} id="in" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} id="out" style={{ visibility: 'hidden' }} />
      <p className="text-sm font-semibold text-slate-50">{data.label}</p>
      <hr className="my-2 border-slate-800" />
      <p className="text-xs text-slate-300">Machine: {data.machine}</p>
      <p className="text-xs text-slate-300">Machines: {formatDisplay(data.machinesNeeded)}</p>
      <p className="text-xs text-slate-300">Output: {formatDisplay(data.outputPerMin)} / min</p>
    </div>
  );
}

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd, sourcePosition, targetPosition }: EdgeProps<FlowEdgeData>) {
  const offset = (data as any)?.offset ?? 0;
  const sy = sourceY + offset;
  const ty = targetY + offset;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY: sy,
    targetX,
    targetY: ty,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });
  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={data?.color ?? '#818cf8'}
        strokeWidth={(data?.width ?? 2) + (data?.hovering ? 1.5 : 0)}
        markerEnd={markerEnd}
        style={{ opacity: data?.hovering ? 1 : 0.9 }}
        className="transition-all duration-150"
      />
      <text dy="-4" x={labelX} y={labelY} className="text-[10px] fill-indigo-100">
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          {data?.label}
        </textPath>
      </text>
      <title>{data?.hoverLabel}</title>
    </>
  );
}

function ProductionGraph({
  root,
  machineLabel,
}: {
  root: RequirementNode;
  machineLabel: (id?: string | null) => string;
}) {
  const { nodes: graphNodes, edges: graphEdges, minDepth, maxDepth } = useMemo(
    () => buildGraphData(root, machineLabel, root.itemId),
    [root, machineLabel],
  );

  const offsetDepth = -minDepth;
  const columns: Record<number, GraphNode[]> = {};
  graphNodes.forEach((n) => {
    const col = n.depth + offsetDepth;
    columns[col] ??= [];
    columns[col].push(n);
  });
  Object.values(columns).forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label)));

  const positions: Record<string, { x: number; y: number }> = {};
  Object.entries(columns).forEach(([colStr, list]) => {
    const col = Number(colStr);
    list.forEach((node, index) => {
      positions[node.id] = {
        x: col * (CARD_WIDTH + 120) + 40,
        y: index * (CARD_HEIGHT + 60) + 40,
      };
    });
  });

  const width = (maxDepth - minDepth + 1) * (CARD_WIDTH + 120) + 200;
  const height = Math.max(...Object.values(columns).map((g) => g.length * (CARD_HEIGHT + 60) + 80), 400);

  // bundle edges and add offsets for parallels
  const bundled: GraphEdge[] = [];
  const key = (e: GraphEdge) => `${e.from}->${e.to}:${e.itemId}`;
  const temp = new Map<string, GraphEdge>();
  graphEdges.forEach((e) => {
    const k = key(e);
    const existing = temp.get(k);
    if (existing) {
      existing.perMinute += e.perMinute;
    } else {
      temp.set(k, { ...e });
    }
  });
  temp.forEach((v) => bundled.push(v));

  const bySource: Record<string, GraphEdge[]> = {};
  bundled.forEach((e) => {
    bySource[e.from] ??= [];
    bySource[e.from].push(e);
  });
  Object.values(bySource).forEach((list) => list.sort((a, b) => a.itemName.localeCompare(b.itemName)));

  const maxRate = Math.max(...bundled.map((e) => e.perMinute), 1);
  const rfNodes = graphNodes.map((n) => ({
    id: n.id,
    position: positions[n.id],
    data: n,
    type: 'cardNode',
    draggable: false,
    selectable: false,
  }));

  const lanePalette = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#c084fc'];

  const rfEdges = bundled.map((e) => {
    const siblings = bySource[e.from] ?? [];
    const idx = siblings.findIndex((s) => s.to === e.to && s.itemId === e.itemId);
    const offset = (idx - (siblings.length - 1) / 2) * 8;
    const lane = positions[e.from]?.x ?? 0;
    const laneIndex = Math.abs(Math.floor(lane / (CARD_WIDTH + 120))) % lanePalette.length;
    const color = lanePalette[laneIndex] ?? '#818cf8';
    const widthScale = Math.max(2.5, Math.sqrt(e.perMinute / maxRate) * 10);
    return {
      id: `${e.from}-${e.to}-${e.itemId}`,
      source: e.from,
      target: e.to,
      type: 'flowEdge',
      data: {
        label: `${e.itemName} — ${formatEdgeRate(e.perMinute)} / min`,
        hoverLabel: `${e.itemName}: ${formatDisplay(e.perMinute)} / min`,
        color,
        width: widthScale,
        offset,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      style: {
        strokeWidth: widthScale,
        stroke: color,
      },
      sourceHandle: 'out',
      targetHandle: 'in',
    };
  });

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  const nodeTypes = useMemo(() => ({ cardNode: CardNode }), []);
  const edgeTypes = useMemo(() => ({ flowEdge: FlowEdge }), []);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-100">Production graph</h2>
          <p className="text-xs text-slate-400">Curved flows with throughput-based widths</p>
        </div>
      </div>
      <div className="mt-4 h-[640px] w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          zoomOnScroll
          zoomOnPinch
          panOnScroll
          panOnDrag
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          style={{ background: 'transparent' }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={{ hideAttribution: true }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={0.5}
          maxZoom={1.8}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
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
