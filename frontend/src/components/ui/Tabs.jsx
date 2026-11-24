import { NavLink } from 'react-router-dom';
import { cn } from '../../utils/cn.js';

/**
 * <Tabs value="a" onChange={setValue} items={[{ id:'a', label:'All', icon:<X/>, count: 3 }]} variant="underline|pill" />
 * Route tabs: give items a `to` (renders NavLink; `end` for exact match) and omit value/onChange.
 */
export default function Tabs({ items, value, onChange, variant = 'underline', className, ariaLabel }) {
  const underline = variant === 'underline';
  const base = 'inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors';
  const look = (active) => underline
    ? cn(base, 'border-b-2 px-1 pb-2.5 pt-1', active ? 'border-brand text-content' : 'border-transparent text-content-muted hover:text-content')
    : cn(base, 'rounded-lg px-3 py-1.5', active ? 'bg-surface text-content shadow-card' : 'text-content-muted hover:text-content');
  const content = (it) => (
    <>
      {it.icon && <span className="[&>svg]:h-4 [&>svg]:w-4">{it.icon}</span>}
      {it.label}
      {it.count != null && <span className="rounded-full bg-surface-sunken px-1.5 text-[11px] tabular text-content-muted">{it.count}</span>}
    </>
  );
  return (
    <div role={onChange ? 'tablist' : undefined} aria-label={ariaLabel}
      className={cn('flex max-w-full gap-5 overflow-x-auto', underline ? 'border-b border-border' : 'w-fit gap-1 rounded-xl bg-surface-sunken p-1', className)}>
      {items.map((it) => it.to ? (
        <NavLink key={it.id} to={it.to} end={it.end} className={({ isActive }) => look(isActive)}>{content(it)}</NavLink>
      ) : (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} onClick={() => onChange?.(it.id)} className={look(value === it.id)}>{content(it)}</button>
      ))}
    </div>
  );
}
