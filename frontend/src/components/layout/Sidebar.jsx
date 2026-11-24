import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FolderOpen, Users, Star, Clock, Trash2, Activity, Bell, Settings, ShieldCheck } from 'lucide-react';
import Logo from '../common/Logo.jsx';
import ProgressBar from '../ui/ProgressBar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { formatBytes, formatPercent } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/files', label: 'My Files', icon: FolderOpen },
  { to: '/shared', label: 'Shared with me', icon: Users },
  { to: '/starred', label: 'Starred', icon: Star },
  { to: '/recent', label: 'Recent', icon: Clock },
  { to: '/trash', label: 'Trash', icon: Trash2 },
];
const MORE = [
  { to: '/activity', label: 'Activity', icon: Activity, permission: 'activity:read-own' },
  { to: '/notifications', label: 'Notifications', icon: Bell, badge: true },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, permission: 'admin:access' },
];

function Item({ item, onNavigate, unread }) {
  const { to, label, icon: Icon, end, badge } = item;
  return (
    <NavLink to={to} end={end} onClick={onNavigate}
      className={({ isActive }) => cn('group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
        isActive ? 'bg-brand-soft text-brand' : 'text-content-muted hover:bg-surface-sunken hover:text-content')}>
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
      <span className="flex-1 truncate">{label}</span>
      {badge && unread > 0 && <span className="rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-contrast tabular">{unread > 99 ? '99+' : unread}</span>}
    </NavLink>
  );
}

/** Navigation + storage meter. `onNavigate` closes the mobile drawer. */
export default function Sidebar({ onNavigate }) {
  const { user } = useAuth();
  const { has } = usePermissions();
  const { unreadCount } = useNotifications();
  const used = Number(user?.storageUsedBytes ?? 0);
  const quota = Number(user?.storageQuotaBytes ?? 0);
  const pct = quota > 0 ? (used / quota) * 100 : 0;
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5"><Logo /></div>
      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">{NAV.filter((i) => !i.permission || has(i.permission)).map((i) => <Item key={i.to} item={i} onNavigate={onNavigate} />)}</div>
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-content-faint">Account</p>
          {MORE.filter((i) => !i.permission || has(i.permission)).map((i) => <Item key={i.to} item={i} onNavigate={onNavigate} unread={unreadCount} />)}
        </div>
      </nav>
      <div className="m-3 rounded-2xl border border-border bg-surface-muted p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">Storage</span>
          <span className="tabular text-xs text-content-muted">{quota > 0 ? formatPercent(pct) : ''}</span>
        </div>
        <ProgressBar value={used} max={quota} tone="auto" size="sm" label="Storage used" className="mt-2.5" />
        <p className="mt-2 text-xs text-content-muted tabular">{formatBytes(used)} of {quota > 0 ? formatBytes(quota) : '—'} used</p>
        {pct >= 80 && <p className="mt-1 text-xs font-semibold text-warning">{pct >= 100 ? 'Storage is full.' : 'Running low on space.'}</p>}
      </div>
    </div>
  );
}
