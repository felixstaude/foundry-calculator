/**
 * Self-test of the libraries the calculator depends on, run inside the production bundle (#selftest).
 * Guards the integration risks found while planning the rebuild: YALPS in the bundle, lz-string (CJS) round trip
 * through a URL hash, the ELK layout worker under the GitHub Pages base path.
 */
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { solve } from 'yalps';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

/** min 2a + 3b  s.t.  a + b >= 10, a <= 6  ->  a = 6, b = 4, cost 24. */
export function checkYalps(): CheckResult {
  const solution = solve({
    direction: 'minimize',
    objective: 'cost',
    constraints: { total: { min: 10 }, capA: { max: 6 } },
    variables: { a: { cost: 2, total: 1, capA: 1 }, b: { cost: 3, total: 1 } },
  });
  const values = Object.fromEntries(solution.variables);
  const ok = solution.status === 'optimal' && solution.result === 24 && values.a === 6 && values.b === 4;
  return { name: 'yalps', ok, detail: `${solution.status} ${solution.result} ${JSON.stringify(values)}` };
}

/** The share-link transport: compress, put into a URL hash, read it back, decompress. */
export function checkLzString(): CheckResult {
  const payload = JSON.stringify({ v: 1, t: [['_base_technum_rods', 2]], note: 'a+b/c=d' });
  const encoded = compressToEncodedURIComponent(payload);
  const hash = new URL(`#p=${encoded}`, 'https://example.test/foundry-calculator/').hash.slice('#p='.length);
  const ok = decompressFromEncodedURIComponent(hash) === payload;
  return { name: 'lz-string', ok, detail: `${encoded.length} chars` };
}

/**
 * ELK in a web worker. elk-api never rejects when the worker script fails to load, so the worker is created here
 * with an error listener and the layout races against it and a timeout.
 */
export async function checkElkWorker(timeoutMs = 10000): Promise<{ result: CheckResult; nodes: LayoutNode[] }> {
  const worker = new Worker(elkWorkerUrl);
  const failed = new Promise<never>((_, reject) => {
    worker.addEventListener('error', (e) => {
      reject(new Error(`ELK worker failed to load (${e.message || elkWorkerUrl})`));
    });
    setTimeout(() => {
      reject(new Error(`ELK layout timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const elk = new ELK({ workerFactory: () => worker });
  try {
    const graph = await Promise.race([
      elk.layout({
        id: 'root',
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
        children: ['a', 'b', 'c'].map((id) => ({ id, width: 120, height: 40 })),
        edges: [
          { id: 'ab', sources: ['a'], targets: ['b'] },
          { id: 'ac', sources: ['a'], targets: ['c'] },
        ],
      }),
      failed,
    ]);
    const nodes = (graph.children ?? []).map((n) => ({ id: n.id, x: n.x ?? Number.NaN, y: n.y ?? Number.NaN }));
    const ok = nodes.length === 3 && nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
    return { result: { name: 'elk-worker', ok, detail: JSON.stringify(nodes) }, nodes };
  } finally {
    elk.terminateWorker();
  }
}
