import { cloneElement, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn.js';
import { useClickOutside } from '../../hooks/useClickOutside.js';

/**
 * Low-level floating panel. Anchor it to an element (`anchorEl`) or a screen point (`point` {x,y}, for context menus).
 * Flips to stay inside the viewport. Closes on outside press, Esc, scroll and resize.
 */
export function FloatingMenu({ open, onClose, anchorEl, point, align = 'start', className, children, role = 'menu' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useClickOutside([ref, { current: anchorEl ?? null }], () => onClose?.(), open);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const menu = ref.current.getBoundingClientRect();
    const margin = 8;
    let top; let left;
    if (point) { top = point.y; left = point.x; }
    else if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      top = r.bottom + 6;
      left = align === 'end' ? r.right - menu.width : r.left;
      if (top + menu.height > window.innerHeight - margin) top = Math.max(margin, r.top - menu.height - 6);
    } else return;
    left = Math.min(Math.max(margin, left), window.innerWidth - menu.width - margin);
    if (top + menu.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - menu.height - margin);
    setPos({ top, left });
  }, [open, anchorEl, point, align, children]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => onClose?.();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} role={role} style={{ position: 'fixed', top: pos.top, left: pos.left }}
      className={cn('z-[60] min-w-[11rem] animate-pop-in rounded-xl border border-border bg-surface p-1.5 shadow-pop', className)}>
      {children}
    </div>,
    document.body
  );
}

/**
 * <Menu trigger={<Button>Actions</Button>} align="end">
 *   <MenuItem icon={<Pencil/>} onClick={...}>Rename</MenuItem>
 *   <MenuSeparator/>
 *   <MenuItem danger icon={<Trash/>} onClick={...}>Delete</MenuItem>
 * </Menu>
 * The trigger must accept onClick/ref (Button, a <button>, ...). Items close the menu on click.
 */
export default function Menu({ trigger, children, align = 'end', className }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {cloneElement(trigger, {
        ref: setAnchor,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: (e) => { trigger.props.onClick?.(e); e.stopPropagation(); setOpen((o) => !o); },
      })}
      <FloatingMenu open={open} onClose={close} anchorEl={anchor} align={align} className={className}>
        <MenuContext.Provider value={close}>{children}</MenuContext.Provider>
      </FloatingMenu>
    </>
  );
}

export const MenuContext = createContext(() => {});

/** Item inside <Menu>/<FloatingMenu>. Inside <Menu> it closes the menu automatically; for FloatingMenu wrap items in <MenuContext.Provider value={onClose}>. */
export function MenuItem({ icon, children, onClick, danger, disabled, shortcut, as: As = 'button', ...rest }) {
  const close = useContext(MenuContext);
  return (
    <As type={As === 'button' ? 'button' : undefined} role="menuitem" disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (disabled) return; close(); onClick?.(e); }}
      className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger-soft' : 'text-content hover:bg-surface-sunken')} {...rest}>
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <kbd className="text-[11px] text-content-faint">{shortcut}</kbd>}
    </As>
  );
}

export const MenuSeparator = () => <div role="separator" className="-mx-1.5 my-1.5 h-px bg-border" />;
export const MenuLabel = ({ children }) => <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-faint">{children}</div>;
