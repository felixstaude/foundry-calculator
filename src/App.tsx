import { lazy, Suspense, useSyncExternalStore } from 'react';

import { COMMIT, DATA_REPO_URL, REPO_URL } from './config';

const SelfTest = lazy(() => import('./selftest/SelfTest'));

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

const getHash = () => window.location.hash;

export function App() {
  const hash = useSyncExternalStore(subscribeHash, getHash);

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-baseline justify-between border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Foundry Calculator</h1>
        <span className="text-xs text-slate-500">rebuild in progress</span>
      </header>
      <main className="flex-1">
        {hash === '#selftest' ? (
          <Suspense fallback={<p>Loading self-test…</p>}>
            <SelfTest />
          </Suspense>
        ) : (
          <p className="text-slate-300">
            A production calculator for Foundry is being rebuilt here. Game data comes from{' '}
            <a className="text-amber-400 underline" href={DATA_REPO_URL}>
              foundry-recipe-data
            </a>
            .
          </p>
        )}
      </main>
      <footer className="border-t border-slate-800 pt-4 text-xs text-slate-500">
        <a className="underline" href={REPO_URL}>
          Source
        </a>{' '}
        · build <span data-testid="commit">{COMMIT.slice(0, 7)}</span> · Not affiliated with Channel 3 Entertainment.
      </footer>
    </div>
  );
}
