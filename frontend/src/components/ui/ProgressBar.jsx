import { cn } from '../../utils/cn.js';

/**
 * <ProgressBar value={used} max={quota} tone="auto|brand|success|danger" label="Storage" size="sm|md" />
 * tone "auto" turns amber above 80% and red above 95%.
 */
export default function ProgressBar({ value = 0, max = 100, tone = 'brand', size = 'md', label, className }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (Number(value) / Number(max)) * 100)) : 0;
  const resolved = tone === 'auto' ? (pct >= 95 ? 'danger' : pct >= 80 ? 'warning' : 'brand') : tone;
  const color = { brand: 'bg-brand', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[resolved];
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      className={cn('w-full overflow-hidden rounded-full bg-surface-sunken', size === 'sm' ? 'h-1.5' : 'h-2.5', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
