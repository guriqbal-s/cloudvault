import { useState } from 'react';
import { MoreHorizontal, Pencil, Search, ShieldCheck, Trash2, UserPlus, Users as UsersIcon, LogOut } from 'lucide-react';
import Avatar from '../../components/ui/Avatar.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Input from '../../components/ui/Input.jsx';
import Menu, { MenuItem, MenuSeparator } from '../../components/ui/Dropdown.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import ProgressBar from '../../components/ui/ProgressBar.jsx';
import Select from '../../components/ui/Select.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { CreateUserModal, DeleteUserDialog, EditUserModal, RolesModal, StatusBadge } from '../../components/admin/UserModals.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useQuery } from '../../hooks/useQuery.js';
import { formatBytes, formatDate, formatRelative } from '../../utils/format.js';
import { cn } from '../../utils/cn.js';
import * as adminApi from '../../api/admin.js';

const STATUS = [{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'PENDING_VERIFICATION', label: 'Pending' }];

export default function Users() {
  const { user: me } = useAuth();
  const { has } = usePermissions();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // { type: 'create'|'edit'|'roles'|'delete'|'sessions', user? }
  const dq = useDebounce(q.trim(), 300);

  const can = { manage: has('user:manage'), suspend: has('user:suspend'), quota: has('user:quota'), assign: has('user:assign-role') };
  const roles = useQuery(({ signal }) => adminApi.listRoles({ signal }), []);
  const { data, loading, error, refetch } = useQuery(({ signal }) => adminApi.listUsers({ q: dq || undefined, status: status || undefined, role: role || undefined, page, limit: 20 }, { signal }), [dq, status, role, page]);
  const reload = () => refetch({ silent: true });
  const roleList = roles.data ?? [];
  const users = data?.data ?? [];
  const close = () => setModal(null);
  const filtered = Boolean(dq || status || role);
  const actions = (u) => (
    <Menu align="end" trigger={<Button variant="ghost" size="sm" icon aria-label={`Actions for ${u.name}`}><MoreHorizontal className="h-4 w-4" /></Button>}>
      {(can.manage || can.suspend || can.quota) && <MenuItem icon={<Pencil />} onClick={() => setModal({ type: 'edit', user: u })}>Edit</MenuItem>}
      {can.assign && <MenuItem icon={<ShieldCheck />} onClick={() => setModal({ type: 'roles', user: u })}>Change roles</MenuItem>}
      {can.manage && <MenuItem icon={<LogOut />} onClick={() => setModal({ type: 'sessions', user: u })}>Sign out everywhere</MenuItem>}
      {can.manage && <MenuSeparator />}
      {can.manage && <MenuItem icon={<Trash2 />} danger onClick={() => setModal({ type: 'delete', user: u })}>Delete</MenuItem>}
    </Menu>
  );

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:flex lg:items-end">
        <div className="col-span-2 lg:flex-1"><Input label="Search" leftIcon={<Search />} placeholder="Name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={STATUS} />
        <Select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} placeholder="All roles" options={roleList.map((r) => ({ value: r.key, label: r.name }))} />
        {can.manage && <Button className="col-span-2" leftIcon={<UserPlus />} onClick={() => setModal({ type: 'create' })}>Add user</Button>}
      </div>

      {error && !data ? <ErrorState error={error} onRetry={refetch} /> : loading && !data ? <SkeletonRows rows={8} /> : !users.length ? (
        <EmptyState icon={<UsersIcon />} title={filtered ? 'No users match' : 'No users yet'} description={filtered ? 'Try a different search or filter.' : undefined} />
      ) : (
        <div className={cn('transition-opacity', loading && 'opacity-60')}>
          <ul className="space-y-3 md:hidden">
            {users.map((u) => {
              const self = u.id === me?.id;
              return (
                <li key={u.id} className="rounded-2xl border border-border bg-surface p-4 shadow-card">
                  <div className="flex items-start gap-3">
                    <Avatar user={u} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{u.name}{self && <span className="ml-1.5 text-xs font-normal text-content-faint">(you)</span>}</p>
                      <p className="truncate text-xs text-content-muted">{u.email}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5"><StatusBadge status={u.status} />{u.roles.map((r) => <Badge key={r} tone="brand">{r}</Badge>)}</div>
                    </div>
                    {!self && <div className="-mr-1 -mt-1">{actions(u)}</div>}
                  </div>
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-1.5 flex justify-between text-xs text-content-muted tabular">
                      <span>{formatBytes(u.storageUsedBytes)} of {formatBytes(u.storageQuotaBytes)}</span>
                      <span>{u.lastLoginAt ? `Active ${formatRelative(u.lastLoginAt)}` : 'Never signed in'}</span>
                    </div>
                    <ProgressBar size="sm" value={u.storageUsedBytes} max={u.storageQuotaBytes} tone="auto" label={`${u.name} storage`} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface shadow-card md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="hidden px-4 py-3 font-semibold md:table-cell">Storage</th>
                  <th className="hidden px-4 py-3 font-semibold lg:table-cell">Last active</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className="hover:bg-surface-sunken/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar user={u} size="sm" />
                          <div className="min-w-0"><p className="truncate font-semibold">{u.name}{self && <span className="ml-1.5 text-xs font-normal text-content-faint">(you)</span>}</p><p className="truncate text-xs text-content-muted">{u.email}</p></div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="brand">{r}</Badge>)}</div></td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <p className="text-xs tabular text-content-muted">{formatBytes(u.storageUsedBytes)} / {formatBytes(u.storageQuotaBytes)}</p>
                        <ProgressBar className="mt-1 w-28" size="sm" value={u.storageUsedBytes} max={u.storageQuotaBytes} tone="auto" label={`${u.name} storage`} />
                      </td>
                      <td className="hidden px-4 py-3 text-content-muted lg:table-cell" title={u.createdAt && `Joined ${formatDate(u.createdAt)}`}>{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</td>
                      <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                      <td className="px-2 py-3">
                        {!self && actions(u)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4"><Pagination meta={data.meta} onPageChange={setPage} /></div>
        </div>
      )}

      <CreateUserModal open={modal?.type === 'create'} onClose={close} roles={roleList} onDone={reload} />
      <EditUserModal user={modal?.type === 'edit' ? modal.user : null} onClose={close} onDone={reload} can={can} />
      <RolesModal user={modal?.type === 'roles' ? modal.user : null} roles={roleList} onClose={close} onDone={reload} />
      <DeleteUserDialog user={modal?.type === 'delete' ? modal.user : null} onClose={close} onDone={reload} />
      <ConfirmDialog open={modal?.type === 'sessions'} onClose={close} tone="danger" confirmLabel="Sign out"
        title={`Sign ${modal?.user?.name ?? 'this user'} out everywhere?`} description="All of their devices will need to sign in again."
        onConfirm={async () => { await adminApi.revokeUserSessions(modal.user.id); toast.success('Sessions revoked'); }} />
    </>
  );
}
