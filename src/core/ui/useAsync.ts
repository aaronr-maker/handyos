import { useEffect, useState, type DependencyList } from 'react';

/** Loads data when a screen opens (and again when `deps` change or `reload()` is called). */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, loading: false }),
      (err) => live && setState({ error: err instanceof Error ? err.message : 'Something went wrong', loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is intentionally keyed by `deps`
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}
