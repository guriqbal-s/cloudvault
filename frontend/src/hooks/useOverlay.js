import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let lockCount = 0;

/**
 * Shared behaviour for Modal/Drawer: Esc closes, body scroll locks (ref-counted for stacked overlays),
 * focus moves inside and is restored on close, Tab is trapped within `ref`.
 */
export function useOverlay(open, onClose, ref, { closeOnEscape = true } = {}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    if (lockCount++ === 0) document.body.style.overflow = 'hidden';

    const node = ref.current;
    const first = node?.querySelector('[data-autofocus]') ?? node?.querySelector(FOCUSABLE);
    (first ?? node)?.focus?.({ preventScroll: true });

    const onKey = (e) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        closeRef.current?.();
      } else if (e.key === 'Tab' && node) {
        const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) { e.preventDefault(); return; }
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (--lockCount === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, ref, closeOnEscape]);
}
