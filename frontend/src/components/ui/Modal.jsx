import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { useOverlay } from '../../hooks/useOverlay.js';

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' };

/**
 * <Modal open onClose title description size="sm|md|lg|xl|full" footer={<>buttons</>} closeOnBackdrop>
 *   body
 * </Modal>
 * Esc / backdrop click close it. Mark the field to focus first with data-autofocus.
 */
export default function Modal({ open, onClose, title, description, size = 'md', footer, children, closeOnBackdrop = true, hideClose, className, bodyClassName }) {
  const ref = useRef(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onMouseDown={closeOnBackdrop ? onClose : undefined} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}
        className={cn('relative flex max-h-[92vh] max-h-[92dvh] w-full animate-pop-in flex-col rounded-t-2xl border border-border bg-surface shadow-pop sm:rounded-2xl', SIZES[size], className)}>
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5 sm:px-6">
            <div className="min-w-0">
              {title && <h2 className="truncate font-display text-lg font-semibold">{title}</h2>}
              {description && <p className="mt-1 text-sm text-content-muted">{description}</p>}
            </div>
            {!hideClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-lg p-2 text-content-muted hover:bg-surface-sunken hover:text-content">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-6', bodyClassName)}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
