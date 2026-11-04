import '@xyflow/react/dist/style.css';

import { ReactFlow, type Node } from '@xyflow/react';
import { useEffect, useState } from 'react';

import { checkElkWorker, checkLzString, checkYalps, type CheckResult, type LayoutNode } from './checks';

interface State {
  results: CheckResult[];
  nodes: LayoutNode[];
  done: boolean;
}

async function runAll(): Promise<State> {
  const results = [checkYalps(), checkLzString()];
  let nodes: LayoutNode[] = [];
  try {
    const elk = await checkElkWorker();
    results.push(elk.result);
    nodes = elk.nodes;
  } catch (error) {
    results.push({ name: 'elk-worker', ok: false, detail: String(error) });
  }
  return { results, nodes, done: true };
}

/** #selftest: runs the library checks in the production bundle and shows the ELK layout in React Flow. */
export default function SelfTest() {
  const [state, setState] = useState<State>({ results: [], nodes: [], done: false });

  useEffect(() => {
    let active = true;
    void runAll().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const flowNodes: Node[] = state.nodes.map((n) => ({ id: n.id, position: { x: n.x, y: n.y }, data: { label: n.id } }));
  const ok = state.done && state.results.every((r) => r.ok);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">
        Self-test:{' '}
        <span data-testid="selftest-status" className={ok ? 'text-emerald-400' : 'text-rose-400'}>
          {state.done ? (ok ? 'ok' : 'failed') : 'running'}
        </span>
      </h2>
      <pre data-testid="selftest-result" className="overflow-x-auto rounded bg-slate-900 p-3 text-xs">
        {JSON.stringify(state.results, null, 2)}
      </pre>
      <div className="h-64 rounded border border-slate-800 bg-slate-900" data-testid="selftest-flow">
        <ReactFlow nodes={flowNodes} edges={[]} fitView colorMode="dark" />
      </div>
    </section>
  );
}
