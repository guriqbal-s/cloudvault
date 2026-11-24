import { Link, useLocation } from 'react-router-dom';
import { LogoMark } from '../common/Logo.jsx';
import { Menu as MenuIcon } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Breadcrumbs from '../common/Breadcrumbs.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import NotificationBell from './NotificationBell.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import UserMenu from './UserMenu.jsx';

const LABELS = {
  files: 'My Files', shared: 'Shared with me', starred: 'Starred', recent: 'Recent', trash: 'Trash', search: 'Search',
  activity: 'Activity', notifications: 'Notifications', settings: 'Settings', admin: 'Admin',
  users: 'Users', roles: 'Roles', storage: 'Storage',
};

/** Route-derived trail, e.g. /admin/users -> Home / Admin / Users. Folder paths render their own trail inside the Files page. */
function useCrumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return [{ label: 'Dashboard' }];
  const crumbs = [{ label: 'Home', to: '/' }];
  let path = '';
  parts.forEach((p, i) => {
    path += `/${p}`;
    if (parts[0] === 'files' && i > 0) return; // folder ids are not human readable
    crumbs.push({ label: LABELS[p] ?? p, to: i === parts.length - 1 ? undefined : path });
  });
  return crumbs;
}

export default function Topbar({ onMenuClick }) {
  const crumbs = useCrumbs();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6 lg:px-8">
      <Button variant="ghost" icon className="-ml-1 hidden shrink-0 sm:inline-flex lg:hidden" onClick={onMenuClick} aria-label="Open navigation"><MenuIcon className="h-5 w-5" /></Button>
      <Link to="/" aria-label="CloudVault home" className="shrink-0 rounded-lg sm:hidden"><LogoMark /></Link>
      <Breadcrumbs items={crumbs} className="hidden shrink-0 xl:block" />
      <div className="flex min-w-0 flex-1 justify-center lg:justify-start xl:justify-center"><GlobalSearch /></div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <div className="hidden sm:block"><ThemeToggle /></div>
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
