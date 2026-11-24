import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { useOverlay } from '../../hooks/useOverlay.js';

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-xl', xl: 'max-w-3xl' };

/** Side panel. <Drawer open onClose title side="right|left" width="sm|md|lg|xl" footer bare>content</Drawer>  (`bare` = no header/padding, e.g. the mobile nav) */
export default function Drawer({ open, onClose, title, description, side = 'right', width = 'md', footer, children, className, bare = false }) {
  const ref = useRef(null);
  useOverlay(open, onClose, ref);
  if (!open) return null;
  const right = side === 'right';
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/50" onMouseDown={onClose} aria-hidden="true" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}
        className={cn('absolute inset-y-0 flex w-full flex-col bg-surface shadow-pop', WIDTHS[width],
          right ? 'right-0 animate-slide-in-right border-l border-border' : 'left-0 animate-slide-in-left border-r border-border', className)}>
        {!bare && <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="truncate font-display text-lg font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 rounded-lg p-2 text-content-muted hover:bg-surface-sunken hover:text-content">
            <X className="h-5 w-5" />
          </button>
        </div>}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', !bare && 'px-5 py-4')}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </aside>
    </div>,
    document.body
  );
}
