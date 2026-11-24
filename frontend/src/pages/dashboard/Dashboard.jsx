import { Link } from 'react-router-dom';
import { Files as FilesIcon, FolderOpen, Share2, Star, Trash2, Upload, HardDrive } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import Card, { CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ProgressBar from '../../components/ui/ProgressBar.jsx';
import Skeleton, { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import StatCard from '../../components/dashboard/StatCard.jsx';
import { CategoryDonut, DailyArea } from '../../components/dashboard/charts.jsx';
import { FileIcon } from '../../utils/fileIcons.jsx';
import { getActivityMeta } from '../../utils/activityMeta.jsx';
import { formatBytes, formatPercent, formatRelative } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useAuth } from '../../context/AuthContext.jsx';
import * as dashboardApi from '../../api/dashboard.js';

export default function Dashboard() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useQuery(({ signal }) => dashboardApi.get({ signal }), []);
  const first = user?.name?.split(' ')[0];

  const header = (
    <PageHeader title={first ? `Welcome back, ${first}` : 'Dashboard'} description="Your storage, activity and recent files at a glance."
      actions={<Button as={Link} to="/files" leftIcon={<Upload />}>Upload files</Button>} />
  );
  if (error && !data) return <>{header}<ErrorState error={error} onRetry={refetch} /></>;

  const ld = loading && !data;
  const s = data?.storage;
  const c = data?.counts;
  const uploads = data?.uploadsOverTime ?? [];
  const uploaded30 = uploads.reduce((n, d) => n + d.count, 0);
  const uploadedBytes30 = uploads.reduce((n, d) => n + d.bytes, 0);

  return (
    <>
      {header}

      <Card className="mb-6">
        {ld ? <Skeleton className="h-16 w-full" /> : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold">Storage</h2>
                <span className="text-sm text-content-muted tabular"><span className="font-semibold text-content">{formatBytes(s.used)}</span> of {formatBytes(s.quota)} used</span>
              </div>
              <ProgressBar value={s.used} max={s.quota} tone="auto" label="Storage used" />
            </div>
            <p className={cn('shrink-0 font-display text-3xl font-semibold tabular', s.percent >= 95 ? 'text-danger' : s.percent >= 80 ? 'text-warning' : 'text-brand')}>{formatPercent(s.percent)}</p>
          </div>
        )}
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard loading={ld} to="/files" icon={<FilesIcon />} label="Files" value={c?.files ?? 0} />
        <StatCard loading={ld} to="/files" icon={<FolderOpen />} label="Folders" value={c?.folders ?? 0} tone="info" />
        <StatCard loading={ld} to="/shared" icon={<Share2 />} label="Shared" value={c?.shared ?? 0} tone="accent" />
        <StatCard loading={ld} to="/starred" icon={<Star />} label="Starred" value={c?.starred ?? 0} tone="warning" />
        <StatCard loading={ld} to="/trash" icon={<Trash2 />} label="In trash" value={c?.trash ?? 0} tone="danger" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-5 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader title="Storage by type" description="Current versions of your files." />
          {ld ? <Skeleton className="h-44 w-full" /> : data.byCategory.length ? <CategoryDonut data={data.byCategory} />
            : <EmptyState compact icon={<HardDrive />} title="Nothing stored yet" description="Upload a file to see how your space is used." />}
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Uploads, last 30 days" description={ld ? ' ' : `${uploaded30} uploads · ${formatBytes(uploadedBytes30)}`} />
          {ld ? <Skeleton className="h-[220px] w-full" /> : uploaded30 === 0
            ? <EmptyState compact icon={<Upload />} title="No uploads in the last 30 days" />
            : <DailyArea data={uploads} metric="count" label="Uploads" />}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card padding="none">
          <div className="p-5 pb-2"><CardHeader title="Recent files" action={<Button as={Link} to="/recent" variant="ghost" size="sm">View all</Button>} /></div>
          {ld ? <div className="p-5 pt-0"><SkeletonRows rows={5} /></div> : data.recentFiles.length ? (
            <ul className="divide-y divide-border">
              {data.recentFiles.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <Link to={f.folderId ? `/files/${f.folderId}` : '/files'} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-ring">
                    <FileIcon item={f} size="sm" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{f.name}</span><span className="text-xs text-content-muted">{formatBytes(f.size)}</span></span>
                    <span className="shrink-0 text-xs text-content-faint">{formatRelative(f.lastAccessedAt ?? f.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="p-5 pt-0"><EmptyState compact icon={<FilesIcon />} title="No files yet" description="Files you upload or open will show up here." action={<Button as={Link} to="/files" size="sm">Go to My files</Button>} /></div>}
        </Card>

        <Card padding="none">
          <div className="p-5 pb-2"><CardHeader title="Recent activity" action={<Button as={Link} to="/activity" variant="ghost" size="sm">View all</Button>} /></div>
          {ld ? <div className="p-5 pt-0"><SkeletonRows rows={5} /></div> : data.recentActivity.length ? (
            <ul className="divide-y divide-border">
              {data.recentActivity.slice(0, 6).map((a) => {
                const { Icon, tone, label } = getActivityMeta(a.action);
                return (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{a.description || label}</span></span>
                    <span className="shrink-0 text-xs text-content-faint">{formatRelative(a.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          ) : <div className="p-5 pt-0"><EmptyState compact title="No activity yet" /></div>}
        </Card>
      </div>
    </>
  );
}
