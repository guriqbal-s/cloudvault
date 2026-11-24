import { Monitor, Moon, Sun, Check } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { updatePreferences } from '../../api/users.js';
import Menu, { MenuItem } from '../ui/Dropdown.jsx';
import Button from '../ui/Button.jsx';

const OPTIONS = [
  ['light', 'Light', Sun],
  ['dark', 'Dark', Moon],
  ['system', 'System', Monitor],
];

/** Theme picker. Applies instantly and, when signed in, saves to the account (best effort). */
export default function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const { isAuthenticated } = useAuth();
  const choose = (value) => {
    setPreference(value);
    if (isAuthenticated) updatePreferences({ theme: value }).catch(() => {});
  };
  const Icon = resolved === 'dark' ? Moon : Sun;
  return (
    <Menu align="end" trigger={<Button variant="ghost" icon aria-label="Change theme"><Icon className="h-[18px] w-[18px]" /></Button>}>
      {OPTIONS.map(([value, label, I]) => (
        <MenuItem key={value} icon={<I />} onClick={() => choose(value)} shortcut={preference === value ? <Check className="h-4 w-4 text-brand" /> : null}>{label}</MenuItem>
      ))}
    </Menu>
  );
}
