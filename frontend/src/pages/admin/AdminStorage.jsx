import { Link } from 'react-router-dom';
import { HardDrive } from 'lucide-react';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ProgressBar from '../../components/ui/ProgressBar.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { formatBytes, formatPercent } from '../../utils/format.js';
import * as adminApi from '../../api/admin.js';

export default function AdminStorage() {
  const { data, loading, error, refetch } = useQuery(({ signal }) => adminApi.storageOverview({ signal }), []);
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <SkeletonRows rows={8} />;
  const { totals, users } = data;
  const pct = totals.quota > 0 ? (totals.used / totals.quota) * 100 : 0;
  const max = Math.max(1, ...users.map((u) => u.used));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-3">
      <Card>
        <CardHeader title="Platform total" description="Across all users' allocated quotas." />
        <p className="font-display text-3xl font-semibold tabular">{formatBytes(totals.used)}</p>
        <p className="text-sm text-content-muted">of {formatBytes(totals.quota)} allocated · {formatPercent(pct, 1)}</p>
        <ProgressBar className="mt-3" value={totals.used} max={totals.quota} tone="brand" label="Allocated storage used" />
      </Card>
      <Card className="lg:col-span-2" padding="none">
        <div className="p-5 pb-2"><CardHeader title="Top users by storage" description="Bar length is relative to the largest user; the percentage is of their own quota." /></div>
        {!users.length ? <div className="p-5"><EmptyState compact icon={<HardDrive />} title="No storage used yet" /></div> : (
          <ol className="divide-y divide-border">
            {users.map((u, i) => (
              <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-5 text-xs tabular text-content-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link to="/admin/users" className="truncate text-sm font-semibold hover:underline">{u.name}</Link>
                    <span className="shrink-0 text-xs tabular text-content-muted">{formatBytes(u.used)} · {formatPercent(u.percent)} of {formatBytes(u.quota)}</span>
                  </div>
                  <ProgressBar className="mt-1.5" size="sm" value={u.used} max={max} tone={u.percent >= 95 ? 'danger' : 'brand'} label={`${u.name} storage`} />
                  <p className="sr-only">{u.email}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
