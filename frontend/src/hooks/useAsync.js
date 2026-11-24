import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wrap a mutation (button click, form submit): tracks `pending` and `error`, and never sets
 * state after unmount.
 *
 *   const [save, { pending, error }] = useAsync(async (values) => api.save(values));
 *   await save(values)   // rejects with the original error, so callers can also try/catch
 */
export function useAsync(fn) {
  const [state, setState] = useState({ pending: false, error: null });
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = useCallback(async (...args) => {
    setState({ pending: true, error: null });
    try {
      const result = await fnRef.current(...args);
      if (mounted.current) setState({ pending: false, error: null });
      return result;
    } catch (error) {
      if (mounted.current) setState({ pending: false, error });
      throw error;
    }
  }, []);

  const reset = useCallback(() => setState({ pending: false, error: null }), []);
  return [run, { ...state, reset }];
}

export default useAsync;
