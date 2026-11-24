import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Wifi, WifiOff } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Button from '../../components/ui/Button.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Tooltip from '../../components/ui/Tooltip.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { getNotificationMeta, notificationLink } from '../../utils/notifications.jsx';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { getErrorMessage } from '../../utils/errors.js';
import * as notificationsApi from '../../api/notifications.js';

export default function Notifications() {
  const toast = useToast();
  const live = useNotifications();
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const unreadOnly = filter === 'unread';
  const { data, loading, error, refetch } = useQuery(({ signal }) => notificationsApi.list({ unread: unreadOnly || undefined, page, limit: 15 }, { signal }), [unreadOnly, page]);

  // A pushed notification (or any change made from the bell) shows up here without a reload.
  const latest = live.items[0]?.id;
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    refetch({ silent: true });
  }, [latest, live.unreadCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = data?.data ?? [];
  const meta = data?.meta;
  const unread = meta?.unreadCount ?? live.unreadCount;

  const act = async (fn) => {
    try { await fn(); await refetch({ silent: true }); } catch (e) { toast.error(getErrorMessage(e)); }
  };
  // If the last row of a later page disappears, step back one page.
  useEffect(() => { if (meta && page > 1 && page > meta.totalPages) setPage(meta.totalPages || 1); }, [meta, page]);

  return (
    <>
      <PageHeader title="Notifications" icon={<Bell />} description="Shares, uploads and account alerts."
        actions={(
          <>
            <Tooltip content={live.connected ? 'Live updates on' : 'Reconnecting…'}>
              <span className={cn('hidden items-center gap-1.5 text-xs sm:inline-flex', live.connected ? 'text-success' : 'text-content-faint')}>
                {live.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{live.connected ? 'Live' : 'Offline'}
              </span>
            </Tooltip>
            <Button variant="secondary" leftIcon={<CheckCheck />} disabled={!unread} onClick={() => act(() => live.markAllRead())}>Mark all read</Button>
          </>
        )} />
      <Tabs variant="pill" className="mb-5" value={filter} onChange={(v) => { setFilter(v); setPage(1); }}
        items={[{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread', count: unread || undefined }]} />

      {error && !data ? <ErrorState error={error} onRetry={refetch} /> : loading && !data ? <SkeletonRows rows={6} /> : !items.length ? (
        <EmptyState icon={<Bell />} title={unreadOnly ? 'You are all caught up' : 'No notifications yet'} description={unreadOnly ? 'No unread notifications.' : 'When someone shares a file with you or something needs your attention, it shows up here.'} />
      ) : (
        <div className={cn(loading && 'opacity-60 transition-opacity')}>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-card">
            {items.map((n) => {
              const { Icon, tone } = getNotificationMeta(n.type);
              const link = notificationLink(n);
              const content = (
                <>
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tone)}><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className={cn('truncate text-sm', n.readAt ? 'font-medium' : 'font-semibold')}>{n.title}</span>{!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}</span>
                    <span className="mt-0.5 block text-sm text-content-muted">{n.body}</span>
                    <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="mt-1 block text-xs text-content-faint">{formatRelative(n.createdAt)}</time>
                  </span>
                </>
              );
              return (
                <li key={n.id} className={cn('flex items-start gap-2 pr-3', !n.readAt && 'bg-brand-soft/40')}>
                  {link ? (
                    <Link to={link} onClick={() => !n.readAt && act(() => live.markRead(n.id))} className="flex min-w-0 flex-1 items-start gap-3 py-3.5 pl-4 focus-visible:outline-none focus-visible:shadow-ring">{content}</Link>
                  ) : <div className="flex min-w-0 flex-1 items-start gap-3 py-3.5 pl-4">{content}</div>}
                  <div className="flex shrink-0 gap-1 py-3">
                    {!n.readAt && <Button size="sm" variant="ghost" icon aria-label="Mark as read" onClick={() => act(() => live.markRead(n.id))}><CheckCheck /></Button>}
                    <Button size="sm" variant="danger-ghost" icon aria-label="Delete notification" onClick={() => act(() => live.remove(n.id))}><Trash2 /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-4"><Pagination meta={meta} onPageChange={setPage} /></div>
        </div>
      )}
    </>
  );
}
