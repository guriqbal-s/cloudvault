import { cn } from '../../utils/cn.js';

const TONES = {
  neutral: 'bg-surface-sunken text-content-muted',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
};

/** <Badge tone="neutral|brand|success|warning|danger|info|accent" dot icon={<X/>}>Text</Badge> */
export default function Badge({ tone = 'neutral', dot, icon, className, children }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {icon && <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span>}
      {children}
    </span>
  );
}
