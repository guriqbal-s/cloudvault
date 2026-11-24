import { useEffect, useRef } from 'react';

/** Calls `handler` on a pointer press outside every given ref (while `active`). */
export function useClickOutside(refs, handler, active = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const list = Array.isArray(refs) ? refs : [refs];
    const onDown = (e) => {
      if (list.some((r) => r.current?.contains(e.target))) return;
      handlerRef.current(e);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
