import { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import Badge from '../ui/Badge.jsx';
import { Checkbox } from '../ui/Switch.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { getErrorCode, getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { passwordProblem, EMAIL_RE } from '../../utils/passwordPolicy.js';
import { formatBytes } from '../../utils/format.js';
import * as adminApi from '../../api/admin.js';

const GB = 1024 ** 3;
export const bytesToGb = (b) => Math.round((Number(b) / GB) * 100) / 100;
export const gbToBytes = (gb) => Math.round(Number(gb) * GB);

export function StatusBadge({ status }) {
  const map = { ACTIVE: ['success', 'Active'], SUSPENDED: ['danger', 'Suspended'], PENDING_VERIFICATION: ['warning', 'Pending'] };
  const [tone, label] = map[status] ?? ['neutral', status];
  return <Badge tone={tone} dot>{label}</Badge>;
}

const quotaError = (v) => (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 10_000 ? 'Enter a size between 0 and 10,000 GB' : null);

export function CreateUserModal({ open, onClose, roles, onDone }) {
  const toast = useToast();
  const blank = { name: '', email: '', password: '', roleKey: '', quotaGb: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [create, { pending }] = useAsync((body) => adminApi.createUser(body));
  useEffect(() => { if (open) { setForm({ ...blank, roleKey: roles.find((r) => r.name === 'Standard User')?.key ?? '' }); setErrors({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = 'Enter a name';
    if (!EMAIL_RE.test(form.email.trim())) next.email = 'Enter a valid email address';
    const p = passwordProblem(form.password);
    if (p) next.password = p;
    if (form.quotaGb !== '' && quotaError(form.quotaGb)) next.quotaBytes = quotaError(form.quotaGb);
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const user = await create({ name: form.name.trim(), email: form.email.trim(), password: form.password, ...(form.roleKey ? { roleKey: form.roleKey } : {}), ...(form.quotaGb !== '' ? { quotaBytes: gbToBytes(form.quotaGb) } : {}) });
      toast.success(`${user?.name ?? 'User'} was created`);
      onDone?.(user);
      onClose();
    } catch (err) {
      if (getErrorCode(err) === 'EMAIL_TAKEN') return setErrors({ email: 'That email is already registered' });
      const f = getFieldErrors(err);
      if (Object.keys(f).length) setErrors(f); else toast.error(getErrorMessage(err));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a user" description="The account is created verified and active. Share the password securely." size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" form="create-user-form" loading={pending}>Create user</Button></>}>
      <form id="create-user-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Full name" value={form.name} onChange={set('name')} error={errors.name} data-autofocus required />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <Input label="Temporary password" type="password" revealable autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="10+ characters with a letter and a number." required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Role" value={form.roleKey} onChange={set('roleKey')} error={errors.roleKey} options={roles.map((r) => ({ value: r.key, label: r.name }))} placeholder="Default role" />
          <Input label="Storage quota (GB)" type="number" min="0" step="0.5" value={form.quotaGb} onChange={set('quotaGb')} error={errors.quotaBytes} hint="Leave empty for the default." />
        </div>
      </form>
    </Modal>
  );
}

/** Name/status/quota. Only fields the actor may change are enabled; the server re-checks everything. */
export function EditUserModal({ user, onClose, onDone, can }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', status: 'ACTIVE', quotaGb: '' });
  const [errors, setErrors] = useState({});
  const [save, { pending }] = useAsync((id, body) => adminApi.updateUser(id, body));
  useEffect(() => { if (user) { setForm({ name: user.name, status: user.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE', quotaGb: String(bytesToGb(user.storageQuotaBytes)) }); setErrors({}); } }, [user]);
  if (!user) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pendingVerification = user.status === 'PENDING_VERIFICATION';

  const submit = async (e) => {
    e.preventDefault();
    const body = {};
    if (can.manage && form.name.trim() && form.name.trim() !== user.name) body.name = form.name.trim();
    if (can.suspend && !pendingVerification && form.status !== user.status) body.status = form.status;
    if (can.quota && gbToBytes(form.quotaGb) !== Number(user.storageQuotaBytes)) {
      const q = quotaError(form.quotaGb);
      if (q) return setErrors({ quotaBytes: q });
      if (gbToBytes(form.quotaGb) < Number(user.storageUsedBytes)) { /* allowed: user simply cannot upload until under quota */ }
      body.quotaBytes = gbToBytes(form.quotaGb);
    }
    if (!Object.keys(body).length) return onClose();
    try {
      const updated = await save(user.id, body);
      toast.success('User updated');
      onDone?.(updated);
      onClose();
    } catch (err) {
      const f = getFieldErrors(err);
      if (Object.keys(f).length) setErrors(f); else toast.error(getErrorMessage(err));
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit user" description={user.email} size="md"
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" form="edit-user-form" loading={pending}>Save changes</Button></>}>
      <form id="edit-user-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Full name" value={form.name} onChange={set('name')} error={errors.name} disabled={!can.manage} />
        <Select label="Status" value={pendingVerification ? 'PENDING_VERIFICATION' : form.status} onChange={set('status')} disabled={!can.suspend || pendingVerification}
          hint={pendingVerification ? 'Waiting for the user to verify their email.' : form.status === 'SUSPENDED' ? 'Suspended users are signed out and cannot sign in.' : undefined}
          options={pendingVerification ? [{ value: 'PENDING_VERIFICATION', label: 'Pending verification' }] : [{ value: 'ACTIVE', label: 'Active' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
        <Input label="Storage quota (GB)" type="number" min="0" step="0.5" value={form.quotaGb} onChange={set('quotaGb')} error={errors.quotaBytes} disabled={!can.quota}
          hint={`Currently using ${formatBytes(user.storageUsedBytes)}.`} />
      </form>
    </Modal>
  );
}

export function RolesModal({ user, roles, onClose, onDone }) {
  const toast = useToast();
  const [selected, setSelected] = useState([]);
  const [save, { pending, error }] = useAsync((id, keys) => adminApi.setUserRoles(id, keys));
  useEffect(() => { if (user) setSelected(roles.filter((r) => user.roles.includes(r.name)).map((r) => r.key)); }, [user, roles]);
  if (!user) return null;
  const toggle = (key, on) => setSelected((s) => (on ? [...new Set([...s, key])] : s.filter((k) => k !== key)));

  const submit = async () => {
    try { const updated = await save(user.id, selected); toast.success('Roles updated'); onDone?.(updated); onClose(); } catch { /* shown inline */ }
  };
  return (
    <Modal open onClose={onClose} title="Roles" description={`Choose the roles for ${user.name}. You can only grant roles ranked below your own.`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button onClick={submit} loading={pending} disabled={!selected.length}>Save roles</Button></>}>
      <ul className="space-y-3">
        {roles.map((r) => (
          <li key={r.id}>
            <Checkbox className="items-start" checked={selected.includes(r.key)} onChange={(on) => toggle(r.key, on)}
              label={<span><span className="block font-semibold">{r.name}</span><span className="block text-xs text-content-muted">{r.description ?? `${r.permissions.length} permissions`}</span></span>} />
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{getErrorMessage(error)}</p>}
    </Modal>
  );
}

/** Deletes without purging first; if the user owns content the server answers 409 and we ask for explicit purge. */
export function DeleteUserDialog({ user, onClose, onDone }) {
  const toast = useToast();
  const [needsPurge, setNeedsPurge] = useState(false);
  const [run, { pending, error }] = useAsync((id, purge) => adminApi.deleteUser(id, { purge }));
  useEffect(() => { setNeedsPurge(false); }, [user]);
  if (!user) return null;

  const submit = async () => {
    try { await run(user.id, needsPurge); toast.success(`${user.name} was deleted`); onDone?.(); onClose(); }
    catch (err) { if (getErrorCode(err) === 'USER_HAS_CONTENT') setNeedsPurge(true); }
  };
  const showError = error && getErrorCode(error) !== 'USER_HAS_CONTENT';
  return (
    <Modal open onClose={() => !pending && onClose()} size="sm" title={needsPurge ? 'Delete user and all their files?' : `Delete ${user.name}?`}
      description={needsPurge ? `${user.name} owns files or folders (${formatBytes(user.storageUsedBytes)}). Deleting the account permanently removes all of it, including its shares. This cannot be undone.` : 'The account will be removed and the user signed out everywhere.'}
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button><Button variant="danger" onClick={submit} loading={pending} data-autofocus>{needsPurge ? 'Delete everything' : 'Delete user'}</Button></>}>
      {showError && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{getErrorMessage(error)}</p>}
    </Modal>
  );
}
