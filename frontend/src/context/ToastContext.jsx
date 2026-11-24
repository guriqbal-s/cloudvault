import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../utils/cn.js';

const ToastContext = createContext(null);
const ICONS = {
  success: [CheckCircle2, 'text-success'],
  error: [AlertCircle, 'text-danger'],
  warning: [TriangleAlert, 'text-warning'],
  info: [Info, 'text-info'],
};
let uid = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, opts = {}) => {
    const id = ++uid;
    const toast = { id, type, message, title: opts.title, action: opts.action };
    setToasts((list) => [...list.slice(-3), toast]);
    const duration = opts.duration ?? (type === 'error' ? 7000 : 4000);
    if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
    return id;
  }, [dismiss]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const api = useMemo(() => ({
    show: push,
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    warning: (m, o) => push('warning', m, o),
    info: (m, o) => push('info', m, o),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((t) => {
            const [Icon, tone] = ICONS[t.type] ?? ICONS.info;
            return (
              <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-pop">
                <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', tone)} />
                <div className="min-w-0 flex-1 text-sm">
                  {t.title && <p className="font-semibold">{t.title}</p>}
                  <p className={cn('break-words', t.title && 'text-content-muted')}>{t.message}</p>
                  {t.action && (
                    <button type="button" onClick={() => { t.action.onClick?.(); dismiss(t.id); }} className="mt-1 font-semibold text-brand hover:underline">
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded-md p-0.5 text-content-faint hover:text-content">
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

/** toast.success('Saved'), toast.error(msg, { title, action: { label, onClick }, duration }) */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
