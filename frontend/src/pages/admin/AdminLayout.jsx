import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, KeyRound, Activity, HardDrive } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';

const TABS = [
  { id: 'overview', to: '/admin', end: true, label: 'Overview', icon: <LayoutDashboard />, permission: 'admin:analytics' },
  { id: 'users', to: '/admin/users', label: 'Users', icon: <Users />, permission: 'user:read' },
  { id: 'roles', to: '/admin/roles', label: 'Roles', icon: <KeyRound />, permission: 'user:read' },
  { id: 'activity', to: '/admin/activity', label: 'Activity', icon: <Activity />, permission: 'activity:read-all' },
  { id: 'storage', to: '/admin/storage', label: 'Storage', icon: <HardDrive />, permission: 'admin:analytics' },
];

/** Admin area shell: tab bar (only the sections the role can use) + nested route outlet. Sub-pages render their own content only. */
export default function AdminLayout() {
  const { has } = usePermissions();
  const tabs = TABS.filter((t) => has(t.permission));
  return (
    <>
      <PageHeader title="Administration" description="Manage people, roles and storage." />
      <Tabs items={tabs} className="mb-6" ariaLabel="Admin sections" />
      <Suspense fallback={<div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>}><Outlet /></Suspense>
    </>
  );
}
