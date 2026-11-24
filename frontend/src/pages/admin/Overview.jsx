import { Activity, Files, HardDrive, Link2, Share2, UserCheck, UserX, Users } from 'lucide-react';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ProgressBar from '../../components/ui/ProgressBar.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import StatCard from '../../components/dashboard/StatCard.jsx';
import { CategoryDonut, DailyArea } from '../../components/dashboard/charts.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { formatBytes, formatPercent } from '../../utils/format.js';
import * as adminApi from '../../api/admin.js';

export default function Overview() {
  const { data, loading, error, refetch } = useQuery(({ signal }) => adminApi.stats({ signal }), []);
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  const ld = loading && !data;
  const signups = data?.signups ?? [];
  const newUsers = signups.reduce((n, d) => n + d.count, 0);

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard loading={ld} icon={<Users />} label="Users" value={data?.users.total ?? 0} hint={data && `${data.users.pending} pending`} to="/admin/users" />
        <StatCard loading={ld} icon={<UserCheck />} label="Active" value={data?.users.active ?? 0} tone="success" />
        <StatCard loading={ld} icon={<UserX />} label="Suspended" value={data?.users.suspended ?? 0} tone="danger" />
        <StatCard loading={ld} icon={<Activity />} label="Active sessions" value={data?.activeSessions ?? 0} tone="info" hint="Last 30 days" />
        <StatCard loading={ld} icon={<Files />} label="Files" value={data?.files ?? 0} tone="accent" hint={data && `${data.folders} folders`} />
        <StatCard loading={ld} icon={<HardDrive />} label="Storage used" value={data ? formatBytes(data.storage.used) : '–'} tone="warning" hint={data && `of ${formatBytes(data.storage.quota)} allocated`} />
        <StatCard loading={ld} icon={<Link2 />} label="Public links" value={data?.shares.links ?? 0} hint="Not expired or revoked" />
        <StatCard loading={ld} icon={<Share2 />} label="People shares" value={data?.shares.people ?? 0} tone="info" />
      </div>

      {data && (
        <Card className="mb-6">
          <div className="mb-2 flex items-baseline justify-between"><h2 className="text-sm font-semibold">Allocated storage</h2><span className="text-sm tabular text-content-muted">{formatPercent(data.storage.percent, 1)}</span></div>
          <ProgressBar value={data.storage.used} max={data.storage.quota} tone="auto" label="Allocated storage used" />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-5 [&>*]:min-w-0">
        <Card className="lg:col-span-3">
          <CardHeader title="New users, last 30 days" description={ld ? ' ' : `${newUsers} sign-ups`} />
          {ld ? <Skeleton className="h-[220px] w-full" /> : <DailyArea data={signups} metric="count" label="Sign-ups" color="rgb(var(--color-info))" />}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Storage by type" description="All users, current versions." />
          {ld ? <Skeleton className="h-44 w-full" /> : data.byCategory.length ? <CategoryDonut data={data.byCategory} />
            : <EmptyState compact icon={<HardDrive />} title="No files yet" />}
        </Card>
      </div>
    </>
  );
}
