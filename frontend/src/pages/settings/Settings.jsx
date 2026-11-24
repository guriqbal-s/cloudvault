import { useSearchParams } from 'react-router-dom';
import { HardDrive, Palette, ShieldCheck, User } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import ProfileTab from '../../components/settings/ProfileTab.jsx';
import PreferencesTab from '../../components/settings/PreferencesTab.jsx';
import SecurityTab from '../../components/settings/SecurityTab.jsx';
import StorageTab from '../../components/settings/StorageTab.jsx';

const TABS = [
  { id: 'profile', label: 'Profile', icon: <User />, Component: ProfileTab },
  { id: 'preferences', label: 'Preferences', icon: <Palette />, Component: PreferencesTab },
  { id: 'security', label: 'Security', icon: <ShieldCheck />, Component: SecurityTab },
  { id: 'storage', label: 'Storage', icon: <HardDrive />, Component: StorageTab },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const current = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0];
  const Active = current.Component;
  return (
    <>
      <PageHeader title="Settings" description="Manage your profile, appearance and security." />
      <Tabs items={TABS} value={current.id} onChange={(id) => setParams({ tab: id }, { replace: true })} className="mb-6" ariaLabel="Settings sections" />
      <Active />
    </>
  );
}
