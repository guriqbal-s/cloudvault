import { Monitor, Moon, Sun } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import Switch from '../ui/Switch.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorMessage } from '../../utils/errors.js';
import { cn } from '../../utils/cn.js';
import * as usersApi from '../../api/users.js';

const THEMES = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'system', label: 'System', Icon: Monitor },
];
const PREFS = [
  { key: 'shared', label: 'Sharing', description: 'When someone shares with you, changes your access or removes it.' },
  { key: 'uploads', label: 'Uploads', description: 'When an upload finishes or fails.' },
  { key: 'quota', label: 'Storage warnings', description: 'When you are close to your storage limit.' },
];

export default function PreferencesTab() {
  const { user, updateUser } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const inApp = user.notificationPrefs?.inApp ?? {};

  const chooseTheme = async (theme) => {
    const before = preference;
    setPreference(theme);
    try { await usersApi.updatePreferences({ theme }); updateUser({ themePref: theme }); }
    catch (err) { setPreference(before); toast.error(getErrorMessage(err)); }
  };
  const toggle = async (key, value) => {
    const prev = user.notificationPrefs;
    updateUser({ notificationPrefs: { ...prev, inApp: { ...inApp, [key]: value } } });
    try { await usersApi.updatePreferences({ notificationPrefs: { inApp: { [key]: value } } }); }
    catch (err) { updateUser({ notificationPrefs: prev }); toast.error(getErrorMessage(err)); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Appearance" description="Choose how CloudVault looks on this and your other devices." />
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
          {THEMES.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={preference === id} onClick={() => chooseTheme(id)}
              className={cn('flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-ring',
                preference === id ? 'border-brand bg-brand-soft text-brand' : 'border-border text-content-muted hover:border-border-strong hover:text-content')}>
              <Icon className="h-5 w-5" />{label}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title="Notifications" description="Choose which in-app notifications you receive. Account and security alerts are always on." />
        <div className="space-y-5">
          {PREFS.map((p) => <Switch key={p.key} label={p.label} description={p.description} checked={inApp[p.key] !== false} onChange={(v) => toggle(p.key, v)} />)}
        </div>
      </Card>
    </div>
  );
}
