import { cn } from '../../utils/cn.js';

/** <Switch checked onChange={(bool)=>...} label="Email me" description="..." disabled /> */
export default function Switch({ checked, onChange, label, description, disabled, id }) {
  return (
    <label className={cn('flex items-start justify-between gap-4', disabled && 'opacity-60')}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold">{label}</span>}
          {description && <span className="block text-xs text-content-muted">{description}</span>}
        </span>
      )}
      <button type="button" role="switch" id={id} aria-checked={!!checked} disabled={disabled} onClick={() => onChange?.(!checked)}
        className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-border-strong')}>
        <span className={cn('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </label>
  );
}

/** <Checkbox checked onChange={(bool)=>...} label /> */
export function Checkbox({ checked, onChange, label, disabled, indeterminate, className, ...rest }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input type="checkbox" checked={!!checked} disabled={disabled}
        ref={(el) => { if (el) el.indeterminate = !!indeterminate; }}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-4 w-4 cursor-pointer rounded border-border-strong accent-[rgb(var(--color-brand))]" {...rest} />
      {label}
    </label>
  );
}
