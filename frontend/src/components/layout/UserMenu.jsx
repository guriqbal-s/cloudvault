import { useNavigate } from 'react-router-dom';
import { LogOut, Monitor, Moon, Settings, ShieldCheck, Sun } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { updatePreferences } from '../../api/users.js';
import { cn } from '../../utils/cn.js';
import Avatar from '../ui/Avatar.jsx';
import Menu, { MenuItem, MenuSeparator } from '../ui/Dropdown.jsx';

const THEMES = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];

/** Segmented light/dark/system switch inside the account menu (the topbar theme button is hidden on phones). */
function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  const choose = (value) => {
    setPreference(value);
    updatePreferences({ theme: value }).catch(() => {});
  };
  return (
    <div className="px-2.5 py-1.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-faint">Theme</p>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunken p-1">
        {THEMES.map(([value, label, Icon]) => (
          <button key={value} type="button" role="radio" aria-checked={preference === value} onClick={() => choose(value)}
            className={cn('flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold transition-colors',
              preference === value ? 'bg-surface text-content shadow-card' : 'text-content-muted hover:text-content')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  return (
    <Menu align="end" className="w-64" trigger={
      <button type="button" aria-label="Account menu" className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-sunken">
        <Avatar user={user} size="sm" />
      </button>}>
      <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-1.5">
        <Avatar user={user} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.name}</p>
          <p className="truncate text-xs text-content-muted">{user?.email}</p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand">{user?.roles?.[0]}</p>
        </div>
      </div>
      <MenuSeparator />
      <ThemeSwitch />
      <MenuSeparator />
      <MenuItem icon={<Settings />} onClick={() => navigate('/settings')}>Settings</MenuItem>
      {isAdmin && <MenuItem icon={<ShieldCheck />} onClick={() => navigate('/admin')}>Admin panel</MenuItem>}
      <MenuSeparator />
      <MenuItem icon={<LogOut />} danger onClick={logout}>Sign out</MenuItem>
    </Menu>
  );
}
