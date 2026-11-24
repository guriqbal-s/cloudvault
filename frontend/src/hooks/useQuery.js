import { useCallback, useEffect, useRef, useState } from 'react';
import { isCanceled } from '../utils/errors.js';

/**
 * Run an async loader and track { data, error, loading }.
 *
 *   const { data, loading, error, refetch, setData } = useQuery(
 *     ({ signal }) => filesApi.get(id, { signal }), [id], { enabled: Boolean(id) });
 *
 * - Re-runs when `deps` change; the previous request is aborted (via `signal`) and its result ignored.
 * - `keepPrevious` keeps the old data visible while the next request loads (good for pagination).
 * - `refetch({ silent: true })` reloads without flipping `loading` (no skeleton flash).
 */
export function useQuery(loader, deps = [], { enabled = true, initialData = null, keepPrevious = true } = {}) {
  const [state, setState] = useState({ data: initialData, error: null, loading: enabled });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);
  const controller = useRef(null);

  const run = useCallback(async ({ silent = false } = {}) => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    const id = ++seq.current;
    if (!silent) setState((s) => ({ data: keepPrevious ? s.data : initialData, error: null, loading: true }));
    try {
      const data = await loaderRef.current({ signal: ctl.signal });
      if (id === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (isCanceled(error) || id !== seq.current) return undefined;
      setState((s) => ({ ...s, error, loading: false }));
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    run();
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);

  return { data: state.data, error: state.error, loading: state.loading, refetch: run, setData };
}

export default useQuery;
