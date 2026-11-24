import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn.js';
import { formatNumber } from '../../utils/format.js';
import Skeleton from '../ui/Skeleton.jsx';

export default function StatCard({ icon, label, value, hint, to, tone = 'brand', loading }) {
  const tones = { brand: 'bg-brand-soft text-brand', info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger' };
  const body = (
    <div className={cn('flex items-center gap-3.5 rounded-2xl border border-border bg-surface p-4 shadow-card', to && 'transition-colors hover:border-border-strong')}>
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5', tones[tone])}>{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-content-muted">{label}</p>
        {loading ? <Skeleton className="mt-1.5 h-6 w-16" /> : <p className="font-display text-2xl font-semibold tabular">{typeof value === 'number' ? formatNumber(value) : value}</p>}
        {hint && !loading && <p className="truncate text-xs text-content-faint">{hint}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-2xl focus-visible:shadow-ring focus-visible:outline-none">{body}</Link> : body;
}
