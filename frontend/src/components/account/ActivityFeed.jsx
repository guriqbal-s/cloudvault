import { Activity as ActivityIcon } from 'lucide-react';
import { getActivityMeta } from '../../utils/activityMeta.jsx';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';
import EmptyState from '../ui/EmptyState.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import Pagination from '../ui/Pagination.jsx';
import ErrorState from '../common/ErrorState.jsx';

/** Timeline list shared by /activity and /admin/activity. `showUser` adds the actor name. */
export default function ActivityFeed({ query, onPage, showUser = false, emptyHint }) {
  const { data, loading, error, refetch } = query;
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <SkeletonRows rows={8} />;
  const items = data?.data ?? [];
  if (!items.length) return <EmptyState icon={<ActivityIcon />} title="No activity found" description={emptyHint ?? 'Nothing matches these filters yet.'} />;
  return (
    <div className={cn('transition-opacity', loading && 'opacity-60')}>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-card">
        {items.map((a) => {
          const { Icon, tone, label } = getActivityMeta(a.action);
          return (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tone)}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.description || label}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
                  <span>{label}</span>
                  {showUser && a.user && <span>· {a.user.name}</span>}
                  {a.resourceName && <span className="max-w-[16rem] truncate">· {a.resourceName}</span>}
                  {a.ip && <span className="hidden font-mono sm:inline">· {a.ip}</span>}
                </p>
              </div>
              <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)} className="shrink-0 text-xs text-content-faint">{formatRelative(a.createdAt)}</time>
            </li>
          );
        })}
      </ul>
      <div className="mt-4"><Pagination meta={data.meta} onPageChange={onPage} /></div>
    </div>
  );
}
