import { NavLink } from 'react-router-dom';
import { FolderOpen, LayoutDashboard, Menu as MenuIcon, Star, Users } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext.jsx';
import { cn } from '../../utils/cn.js';

const TABS = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/shared', label: 'Shared', icon: Users },
  { to: '/starred', label: 'Starred', icon: Star },
];

const tab = 'relative flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] font-semibold transition-colors';

/** Bottom tab bar for phones and small tablets (hidden at lg, where the sidebar is visible). "More" opens the full nav drawer. */
export default function MobileNav({ onMore }) {
  const { unreadCount } = useNotifications();
  return (
    <nav aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-lg">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cn(tab, isActive ? 'text-brand' : 'text-content-muted active:text-content')}>
            {({ isActive }) => (
              <>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', isActive && 'bg-brand-soft')}>
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.9} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className={cn(tab, 'text-content-muted active:text-content')} aria-label="More navigation">
          <span className="relative flex h-7 w-12 items-center justify-center rounded-full">
            <MenuIcon className="h-5 w-5" strokeWidth={1.9} />
            {unreadCount > 0 && <span className="absolute right-2.5 top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />}
          </span>
          More
        </button>
      </div>
    </nav>
  );
}
