import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  getBezierPath,
  Position,
  Handle,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type EdgeProps,
  type NodeProps,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import { dataBundle as localDataBundle, extractTierInfo, type DataBundle } from './data/data';
import { DEFAULT_BASE_URL, loadDataBundle, loadVersionIndex, type VersionEntry } from './data/remoteData';
import { buildProducerMap, type ProducerMap } from './logic/recipes';
import { buildCalculation, RequirementNode } from './logic/calculator';
import type { RecipeSelection } from './logic/recipes';

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

type MachineOption = { id: string; label: string; speedMultiplier?: number };

const customMachineOptions: Record<string, MachineOption[]> = {
  assembler: [
    { id: 'assembler_t1', label: 'Assembler I (1.0x)', speedMultiplier: 1 },
    { id: 'assembler_t2', label: 'Assembler II (1.5x)', speedMultiplier: 1.5 },
    { id: 'assembler_t3', label: 'Assembler III (2.0x)', speedMultiplier: 2 },
  ],
};

const findCustomMachineOption = (familyId: string, optionId?: string) =>
  customMachineOptions[familyId]?.find((opt) => opt.id === optionId);

const VERSION_STORAGE_KEY = 'foundry:selectedVersion';

function readStoredVersion() {
  try {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(VERSION_STORAGE_KEY) ?? '';
  } catch (err) {
    return '';
  }
}

function persistStoredVersion(version: string) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VERSION_STORAGE_KEY, version);
  } catch (err) {
    // ignore storage errors
  }
}

const LOCAL_VERSION_FALLBACK = localDataBundle.version.version ?? 'local';

type GraphNode = {
  id: string;
  label: string;
  machine: string;
  machinesNeeded?: number;
  outputPerMin?: number;
  depth: number;
  stage: 'raw' | 'smelting' | 'assembly' | 'final';
  isTarget?: boolean;
  color?: string;
  hasUserMoved?: boolean;
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
  throughput?: number;
  light?: boolean;
};

function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
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
        disabled={disabled}
      />
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
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
  customOptions,
  data,
  disabled = false,
}: {
  machineChoices: Record<string, string>;
  onChange: (familyId: string, machineId?: string) => void;
  customOptions: Record<string, MachineOption[]>;
  data: DataBundle;
  disabled?: boolean;
}) {
  const families = useMemo(() => {
    const craftedFamilies = new Set<string>();
    Object.values(data.recipes).forEach((recipe) => {
      if (recipe.craftedIn) craftedFamilies.add(recipe.craftedIn);
    });
    return Array.from(craftedFamilies)
      .map((id) => ({ id, label: data.machines[id]?.name ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const baseOptions: MachineOption[] = useMemo(
    () => Object.values(data.machines).map((m) => ({ id: m.id, label: m.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [data],
  );

  if (families.length === 0) return null;

  return (
    <details className="card space-y-3 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Machine tier preferences</summary>
      <p className="text-sm text-slate-300">
        Choose which machine tier/type to display for each crafting family (e.g., assembler, smelter). Assembler tiers
        include speed multipliers (1.0x, 1.5x, 2.0x).
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {families.map((family) => {
          const combinedOptions = [...(customOptions[family.id] ?? []), ...baseOptions];
          return (
            <div key={family.id} className="space-y-1 rounded-md border border-slate-800 bg-slate-900/50 p-3">
              <p className="text-sm font-semibold text-slate-100">{family.label}</p>
              <select
                className="input"
                value={machineChoices[family.id] ?? ''}
                onChange={(e) => onChange(family.id, e.target.value || undefined)}
                disabled={disabled}
              >
                <option value="">Default ({family.label})</option>
                {combinedOptions.map((machine) => (
                  <option key={`${family.id}-${machine.id}`} value={machine.id}>
                    {machine.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
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
  return `hsl(${hue}, 78%, 60%)`;
}

function widthFromThroughput(value: number) {
  const w = 2 + Math.sqrt(Math.max(0, value)) * 0.6;
  return Math.min(10, Math.max(2, w));
}

function CardNode({ data }: NodeProps<GraphNode>) {
  const borderClass = data.isTarget ? 'shadow-indigo-500/40' : data.stage === 'raw' ? 'border-slate-700' : 'border-slate-800';
  const style: React.CSSProperties = data.color
    ? { borderColor: data.color, boxShadow: `0 0 12px ${data.color}`, borderLeft: `4px solid ${data.color}`, willChange: 'transform' }
    : { willChange: 'transform' };
  return (
    <div className={classNames('w-[240px] rounded-lg border bg-slate-900/90 p-3 shadow-lg shadow-slate-900/40', borderClass)} style={style}>
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

const MemoCardNode = React.memo(CardNode);

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
        strokeWidth={(data?.width ?? 2) * (data?.light ? 0.8 : 1) + (data?.hovering ? 1.5 : 0)}
        markerEnd={markerEnd}
        style={{ opacity: data?.hovering ? 1 : 0.9 }}
        className="transition-all duration-150"
      />
      <foreignObject x={labelX - 50} y={labelY - 12} width={100} height={24} pointerEvents="none">
        <div className="flex w-full items-center justify-center">
          <span className="rounded-full bg-slate-900/85 px-2 py-0.5 text-[10px] font-semibold text-slate-100 shadow-sm shadow-black/30">
            {data?.throughput ? `${formatDisplay(data.throughput)} / min` : ''}
          </span>
        </div>
      </foreignObject>
      <title>{data?.hoverLabel}</title>
    </>
  );
}

const MemoFlowEdge = React.memo(FlowEdge);

function ProductionGraph({
  root,
  machineLabel,
}: {
  root: RequirementNode;
  machineLabel: (id?: string | null) => string;
}) {
  const reactFlowInstance = useReactFlow();
  const flowWrapperRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rafRef = useRef<number>();
  const movedRef = useRef<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);
  const { nodes: graphNodes, edges: graphEdges, minDepth, maxDepth } = useMemo(
    () => buildGraphData(root, machineLabel, root.itemId),
    [root, machineLabel],
  );

  const lanePalette = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#38bdf8', '#c084fc'];

  const runLayout = useCallback(
    async (respectMoved: boolean) => {
      const offsetDepth = -minDepth;
      const columns: Record<number, GraphNode[]> = {};
      graphNodes.forEach((n) => {
        const col = n.depth + offsetDepth;
        columns[col] ??= [];
        columns[col].push(n);
      });
      Object.values(columns).forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label)));
      const posMap: Record<string, { x: number; y: number; lane: number }> = {};
      Object.entries(columns).forEach(([colStr, list]) => {
        const col = Number(colStr);
        list.forEach((node, index) => {
          posMap[node.id] = {
            x: col * (CARD_WIDTH + 120),
            y: index * (CARD_HEIGHT + 80),
            lane: col,
          };
        });
      });

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
        position: posMap[n.id] ?? { x: 0, y: 0 },
        data: { ...n, color: hashColor(n.id) },
        type: 'cardNode',
        draggable: true,
        selectable: false,
        style: { willChange: 'transform' },
      }));

      const rfEdges = bundled.map((e) => {
        const siblings = bySource[e.from] ?? [];
        const idx = siblings.findIndex((s) => s.to === e.to && s.itemId === e.itemId);
        const offset = (idx - (siblings.length - 1) / 2) * 8;
        const color = hashColor(e.from);
        const widthScale = widthFromThroughput(e.perMinute);
        return {
          id: `${e.from}-${e.to}-${e.itemId}`,
          source: e.from,
          target: e.to,
          type: 'flowEdge',
          data: {
            hoverLabel: `${e.itemName}: ${formatDisplay(e.perMinute)} / min`,
            color,
            width: widthScale,
            offset,
            throughput: e.perMinute,
            light: false,
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

      setNodes(rfNodes);
      setEdges(rfEdges);
    },
    [graphNodes, graphEdges, minDepth],
  );

  const [nodes, setNodes] = useState<Node<GraphNode>[]>([]);
  const [edges, setEdges] = useState<Edge<FlowEdgeData>[]>([]);

  useEffect(() => {
    runLayout(false);
  }, [runLayout]);

  const onNodesChange = useCallback(
    (changes) => {
      setNodes((nds) =>
        applyNodeChanges(
          changes.map((c) => {
            if (c.type === 'position' && snapEnabled && c.position) {
              const grid = 20;
              c.position = {
                x: Math.round(c.position.x / grid) * grid,
                y: Math.round(c.position.y / grid) * grid,
              };
            }
            return c;
          }),
          nds,
        ),
      );
    },
    [snapEnabled],
  );

  const onEdgesChange = useCallback((changes) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const handleDragStart = useCallback(() => setIsDragging(true), []);
  const handleDragStop = useCallback((_e, node) => {
    movedRef.current[node.id] = true;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocusId(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const doExport = useCallback(
    async (mode: 'copy' | 'download') => {
      if (!flowWrapperRef.current) return;
      const rf = reactFlowInstance;
      const nodesToExport = rf.getNodes();
      if (!nodesToExport || nodesToExport.length === 0) return;

      const padding = 100;
      const left = Math.min(...nodesToExport.map((n) => n.positionAbsolute?.x ?? n.position.x));
      const top = Math.min(...nodesToExport.map((n) => n.positionAbsolute?.y ?? n.position.y));
      const right = Math.max(
        ...nodesToExport.map((n) => (n.positionAbsolute?.x ?? n.position.x) + (n.width ?? CARD_WIDTH)),
      );
      const bottom = Math.max(
        ...nodesToExport.map((n) => (n.positionAbsolute?.y ?? n.position.y) + (n.height ?? CARD_HEIGHT)),
      );
      const exportWidth = right - left + padding * 2;
      const exportHeight = bottom - top + padding * 2;

      const prevViewport = rf.getViewport ? rf.getViewport() : { x: 0, y: 0, zoom: 1 };
      rf.setViewport({ x: -left + padding, y: -top + padding, zoom: 1 }, { duration: 0 });
      setExporting(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));

      try {
        const scale = 3;
        const dataUrl = await toPng(flowWrapperRef.current, {
          pixelRatio: scale,
          canvasWidth: exportWidth * scale,
          canvasHeight: exportHeight * scale,
          style: {
            width: `${exportWidth}px`,
            height: `${exportHeight}px`,
          },
        });

        if (mode === 'copy' && 'ClipboardItem' in window) {
          const blob = await (await fetch(dataUrl)).blob();
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          } catch (err) {
            const link = document.createElement('a');
            link.download = 'foundry-graph.png';
            link.href = dataUrl;
            link.click();
          }
        } else {
          const link = document.createElement('a');
          link.download = 'foundry-graph.png';
          link.href = dataUrl;
          link.click();
        }
      } finally {
        rf.setViewport(prevViewport, { duration: 0 });
        setExporting(false);
      }
    },
    [reactFlowInstance],
  );

  const adjacency = useMemo(() => {
    const inMap: Record<string, string[]> = {};
    const outMap: Record<string, string[]> = {};
    edges.forEach((e) => {
      outMap[e.source] ??= [];
      outMap[e.source].push(e.target);
      inMap[e.target] ??= [];
      inMap[e.target].push(e.source);
    });
    return { inMap, outMap };
  }, [edges]);

  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const seen = new Set<string>();
    const queue = [focusId];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      (adjacency.inMap[current] ?? []).forEach((p) => queue.push(p));
    }
    return seen;
  }, [adjacency, focusId]);

  const displayNodes = useMemo(() => {
    if (!focusSet) return nodes;
    return nodes.map((n) => ({
      ...n,
      style: {
        ...(n.style ?? {}),
        opacity: focusSet.has(n.id) ? 1 : 0.2,
      },
      data: { ...(n.data as GraphNode), dimmed: focusSet.has(n.id) ? false : true },
    }));
  }, [focusSet, nodes]);

  const displayEdges = useMemo(() => {
    if (!focusSet) {
      return edges.map((e) => ({
        ...e,
        data: { ...e.data, light: isDragging },
        style: { ...(e.style ?? {}), opacity: isDragging ? 0.6 : 1 },
      }));
    }
    return edges.map((e) => {
      const active = focusSet.has(e.target) && focusSet.has(e.source);
      return {
        ...e,
        data: { ...e.data, light: isDragging, width: (e.data?.width ?? 2) + (active ? 1 : 0) },
        style: { ...(e.style ?? {}), opacity: active ? 1 : 0.2 },
      };
    });
  }, [edges, focusSet, isDragging]);

  const nodeTypes = useMemo(() => ({ cardNode: MemoCardNode }), []);
  const edgeTypes = useMemo(() => ({ flowEdge: MemoFlowEdge }), []);

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-100">Production graph</h2>
          <p className="text-xs text-slate-400">Curved flows with throughput-based widths</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-md bg-slate-800 px-3 py-1 font-semibold text-slate-100 hover:bg-slate-700"
            onClick={() => {
              runLayout(true);
            }}
          >
            Auto layout
          </button>
          <button
            type="button"
            className={classNames(
              'rounded-md px-3 py-1 font-semibold text-xs',
              snapEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100 hover:bg-slate-700',
            )}
            onClick={() => setSnapEnabled((v) => !v)}
          >
            Snap to grid: {snapEnabled ? 'On' : 'Off'}
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-800 px-3 py-1 font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
            disabled={exporting}
            onClick={() => doExport('copy')}
          >
            Copy Image
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-800 px-3 py-1 font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
            disabled={exporting}
            onClick={() => doExport('download')}
          >
            Download PNG
          </button>
        </div>
      </div>
      <div className="mt-4 h-[640px] w-full" ref={flowWrapperRef}>
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable={false}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={{ hideAttribution: true }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={0.5}
          maxZoom={1.8}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={handleDragStart}
          onNodeDragStop={handleDragStop}
          onNodeDoubleClick={(_, node) => setFocusId(node.id)}
          onPaneClick={() => setFocusId(null)}
          zoomOnScroll
          zoomOnPinch
          panOnScroll
          panOnDrag
          style={{ background: 'transparent' }}
        >
          <Background color={snapEnabled ? '#a5b4fc' : '#475569'} gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function App() {
  const [selectedVersion, setSelectedVersion] = useState<string>(() => {
    if (typeof window === 'undefined') return LOCAL_VERSION_FALLBACK;
    const params = new URLSearchParams(window.location.search);
    return params.get('version') ?? params.get('ver') ?? readStoredVersion() ?? LOCAL_VERSION_FALLBACK;
  });
  const [availableVersions, setAvailableVersions] = useState<VersionEntry[]>([]);
  const [versionWarnings, setVersionWarnings] = useState<string[]>([]);
  const [bundleState, setBundleState] = useState<{
    bundle: DataBundle;
    version: string;
    source: 'network' | 'cache' | 'fallback';
  } | null>(null);
  const [producers, setProducers] = useState<ProducerMap>({});
  const [selectedItemId, setSelectedItemId] = useState('');
  const [desiredRate, setDesiredRate] = useState(60);
  const [roundUpMachines, setRoundUpMachines] = useState(false);
  const [tierPreferences, setTierPreferences] = useState<Record<string, number>>({});
  const [recipeOverrides, setRecipeOverrides] = useState<Record<string, string>>({});
  const [machineChoices, setMachineChoices] = useState<Record<string, string>>({});
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [dataWarnings, setDataWarnings] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [fallbackAcknowledged, setFallbackAcknowledged] = useState(false);

  const bundle = bundleState?.bundle;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const item = params.get('item');
    const rateParam = params.get('rate');
    const roundParam = params.get('round');
    const tiersParam = params.get('tiers');
    const overridesParam = params.get('overrides');
    const machinesParam = params.get('machines');
    const versionParam = params.get('version') ?? params.get('ver');

    if (versionParam) setSelectedVersion(versionParam);
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

  const localVersionEntry = useMemo(
    () => ({
      version: LOCAL_VERSION_FALLBACK,
      title: 'Bundled data',
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const fetchIndex = async () => {
      setLoadingIndex(true);
      try {
        const { latest, versions, warnings } = await loadVersionIndex(DEFAULT_BASE_URL, localVersionEntry);
        if (cancelled) return;
        setAvailableVersions(versions);
        setVersionWarnings(warnings);
        setSelectedVersion((prev) => {
          if (!prev || prev === 'latest') return latest.version;
          return prev;
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setAvailableVersions([localVersionEntry]);
        setVersionWarnings([`Failed to load remote version index: ${message}. Using bundled version metadata.`]);
        setSelectedVersion((prev) => prev || localVersionEntry.version);
      } finally {
        if (!cancelled) setLoadingIndex(false);
      }
    };

    fetchIndex();
    return () => {
      cancelled = true;
    };
  }, [localVersionEntry]);

  useEffect(() => {
    if (!selectedVersion) return;
    let cancelled = false;
    setLoadingBundle(true);
    setDataWarnings([]);
    setLoadError(null);
    setFallbackAcknowledged(false);
    const fetchData = async () => {
      try {
        const result = await loadDataBundle(selectedVersion, DEFAULT_BASE_URL);
        if (cancelled) return;
        setBundleState({ bundle: result.bundle, version: selectedVersion, source: result.source });
        setProducers(buildProducerMap(result.bundle.recipes));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setBundleState({ bundle: localDataBundle, version: localVersionEntry.version, source: 'fallback' });
        setProducers(buildProducerMap(localDataBundle.recipes));
        setLoadError(message);
        setDataWarnings([`Using bundled data because version "${selectedVersion}" failed to load (${message}).`]);
      } finally {
        if (!cancelled) setLoadingBundle(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [localVersionEntry.version, reloadToken, selectedVersion]);

  useEffect(() => {
    if (!bundle) return;
    if (selectedItemId && !bundle.items[selectedItemId]) {
      setSelectedItemId('');
    }
  }, [bundle, selectedItemId]);

  const versionOptionsForSelect = useMemo(() => {
    const map = new Map<string, VersionEntry>();
    availableVersions.forEach((entry) => map.set(entry.version, entry));
    if (selectedVersion && !map.has(selectedVersion)) {
      map.set(selectedVersion, { version: selectedVersion, title: 'Custom selection' });
    }
    return Array.from(map.values());
  }, [availableVersions, selectedVersion]);

  const itemOptions: Option[] = useMemo(() => {
    if (!bundle) return [];
    return Object.values(bundle.items)
      .map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [bundle]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedVersion) params.set('version', selectedVersion);
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

    persistStoredVersion(selectedVersion);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, [desiredRate, machineChoices, recipeOverrides, roundUpMachines, selectedItemId, selectedVersion, tierPreferences]);

  const selection: RecipeSelection = useMemo(
    () => ({ overrides: recipeOverrides, tierPreferences }),
    [recipeOverrides, tierPreferences],
  );

  const machineSpeedMultipliers = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(machineChoices).forEach(([familyId, optionId]) => {
      const custom = findCustomMachineOption(familyId, optionId);
      if (custom?.speedMultiplier !== undefined) {
        map[familyId] = custom.speedMultiplier;
      }
    });
    return map;
  }, [machineChoices]);

  const activeVariants = useMemo(() => {
    if (!selectedItemId) return undefined;
    const producersForItem = producers[selectedItemId] ?? [];
    const tiered = producersForItem.filter((r) => extractTierInfo(r).tier !== undefined);
    if (tiered.length === 0) return undefined;
    const baseName = extractTierInfo(tiered[0]).baseName;
    return { baseName, recipes: tiered };
  }, [producers, selectedItemId]);

  const calculation = useMemo(() => {
    if (!bundle || !selectedItemId || Number.isNaN(desiredRate) || desiredRate <= 0) return { root: undefined, totals: {} };
    return buildCalculation(selectedItemId, desiredRate, bundle, producers, {
      roundUpMachines,
      selection,
      machineSpeedMultipliers,
    });
  }, [bundle, desiredRate, machineSpeedMultipliers, producers, roundUpMachines, selectedItemId, selection]);

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
          name: bundle?.items[itemId]?.name ?? itemId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [bundle, calculation.totals],
  );

  const collectWarnings = (node?: RequirementNode): string[] => {
    if (!node) return [];
    const childWarnings = node.inputs.flatMap((edge) => collectWarnings(edge.node));
    return [...node.warnings, ...childWarnings];
  };

  const machineLabel = (craftedIn?: string | null) => {
    if (!craftedIn) return 'Unknown machine';
    if (!bundle) return 'Unknown machine';
    const choiceId = machineChoices[craftedIn];
    const custom = findCustomMachineOption(craftedIn, choiceId);
    if (custom) return custom.label;
    if (choiceId) return bundle.machines[choiceId]?.name ?? choiceId;
    return bundle.machines[craftedIn]?.name ?? craftedIn;
  };

  const version = bundle?.version.version ?? 'unknown';
  const uiBlocked = loadingBundle || !bundle;
  const dataSourceLabel =
    bundleState?.source === 'cache'
      ? 'Cached dataset'
      : bundleState?.source === 'network'
        ? 'Remote dataset'
        : bundleState?.source === 'fallback'
          ? 'Bundled fallback'
          : 'Not loaded';

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" aria-busy={uiBlocked}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-50">Foundry Calculator</h1>
          <p className="text-slate-400">
            Data version {version} · {dataSourceLabel} · React + Vite + Tailwind (static deploy ready)
          </p>
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

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
            <label className="label" htmlFor="versionSelect">
              Data version
            </label>
            <select
              id="versionSelect"
              className="input"
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              disabled={loadingIndex || loadingBundle}
            >
              {versionOptionsForSelect.map((entry) => (
                <option key={entry.version} value={entry.version}>
                  {entry.title ? `${entry.version} – ${entry.title}` : entry.version}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <button
              type="button"
              className="rounded-md bg-slate-800 px-3 py-1 font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
              onClick={() => setReloadToken((v) => v + 1)}
              disabled={loadingBundle}
            >
              Retry load
            </button>
            {loadingBundle ? <span className="text-amber-200">Loading dataset…</span> : null}
          </div>
        </div>
        {versionWarnings.length ? <WarningList warnings={versionWarnings} /> : null}
        {(dataWarnings.length > 0 || loadError) && !fallbackAcknowledged ? (
          <div className="rounded-md border border-amber-500/60 bg-amber-950/50 p-3 text-amber-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Fallback to bundled data</p>
                <p className="text-xs">{dataWarnings[0] ?? loadError ?? 'Remote load failed; using bundled data.'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60"
                  onClick={() => setReloadToken((v) => v + 1)}
                  disabled={loadingBundle}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="rounded-md bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-600"
                  onClick={() => setFallbackAcknowledged(true)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative">
        {uiBlocked ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-950/70 backdrop-blur">
            <div className="space-y-1 text-center">
              <p className="text-sm font-semibold text-slate-100">Loading data…</p>
              <p className="text-xs text-slate-300">Fetching {selectedVersion || 'latest'} dataset</p>
            </div>
          </div>
        ) : null}
        <div className={classNames('space-y-6', uiBlocked ? 'pointer-events-none opacity-60' : '')}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card space-y-3 p-4">
              <SearchableSelect
                label="Target item"
                options={itemOptions}
                value={selectedItemId}
                onChange={setSelectedItemId}
                placeholder="Search by name or id"
                disabled={uiBlocked || !bundle}
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
                  disabled={uiBlocked}
                />
              </div>
              {variantOptions && activeVariants ? (
                <div className="space-y-2">
                  <label className="label">Variant / tier</label>
                  <select
                    className="input"
                    value={activeVariants.recipes.find((r) => extractTierInfo(r).tier === selectedTier)?.id ?? ''}
                    onChange={(e) => setVariantChoice(e.target.value)}
                    disabled={uiBlocked}
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
                  disabled={uiBlocked}
                />
                <label className="label" htmlFor="roundUp">
                  Round machines up
                </label>
              </div>
            </div>
            <div className="space-y-3">
              {bundle ? (
                <MachineSelector
                  machineChoices={machineChoices}
                  customOptions={customMachineOptions}
                  onChange={(familyId, machineId) =>
                    setMachineChoices((prev) => {
                      const next = { ...prev };
                      if (!machineId) delete next[familyId];
                      else next[familyId] = machineId;
                      return next;
                    })
                  }
                  data={bundle}
                  disabled={uiBlocked}
                />
              ) : (
                <div className="card p-4 text-sm text-slate-300">Data must load before machine preferences are available.</div>
              )}
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
                      name: bundle?.items[itemId]?.name ?? itemId,
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
                          disabled={uiBlocked}
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

              <ReactFlowProvider>
                <ProductionGraph root={calculation.root} machineLabel={machineLabel} />
              </ReactFlowProvider>

              <WarningList warnings={collectWarnings(calculation.root)} />
            </div>
          ) : (
            <div className="text-sm text-slate-300">Select an item and set a target rate to see calculations.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
