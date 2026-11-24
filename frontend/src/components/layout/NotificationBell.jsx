import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { FloatingMenu } from '../ui/Dropdown.jsx';
import Button from '../ui/Button.jsx';
import { formatRelative } from '../../utils/format.js';
import { getNotificationMeta, notificationLink } from '../../utils/notifications.jsx';
import { cn } from '../../utils/cn.js';

export default function NotificationBell() {
  const { items, unreadCount, markRead, markAllRead, connected } = useNotifications();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const wrapper = useRef(null);

  const openItem = (n) => {
    setOpen(false);
    if (!n.readAt) markRead(n.id);
    navigate(notificationLink(n));
  };

  return (
    <div ref={wrapper}>
      <Button ref={setAnchor} variant="ghost" icon className="relative" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white tabular">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>
      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorEl={anchor} align="end" role="dialog" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-semibold">Notifications</h2>
            <span title={connected ? 'Live updates on' : 'Reconnecting…'} className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-content-faint')} />
          </div>
          {unreadCount > 0 && (
            <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </div>
        <ul className="max-h-[22rem] overflow-y-auto">
          {items.slice(0, 8).map((n) => {
            const { Icon, tone } = getNotificationMeta(n.type);
            return (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-muted', !n.readAt && 'bg-brand-soft/40')}>
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{n.title}</span>
                    <span className="line-clamp-2 text-[13px] text-content-muted">{n.body}</span>
                    <span className="mt-0.5 block text-[11px] text-content-faint">{formatRelative(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
          {!items.length && <li className="px-4 py-10 text-center text-sm text-content-muted">You are all caught up.</li>}
        </ul>
        <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-2.5 text-center text-sm font-semibold text-brand hover:bg-surface-muted">View all</Link>
      </FloatingMenu>
    </div>
  );
}
