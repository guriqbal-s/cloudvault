import { useState } from 'react';
import { Laptop, LogOut, ShieldCheck } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import Input from '../ui/Input.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import ErrorState from '../common/ErrorState.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useAsync } from '../../hooks/useAsync.js';
import { getErrorCode, getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { passwordProblem } from '../../utils/passwordPolicy.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import * as usersApi from '../../api/users.js';

function PasswordCard() {
  const toast = useToast();
  const empty = { currentPassword: '', newPassword: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const [save, { pending }] = useAsync(() => usersApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword }));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.currentPassword) next.currentPassword = 'Enter your current password';
    const problem = passwordProblem(form.newPassword);
    if (problem) next.newPassword = problem;
    if (form.confirm !== form.newPassword) next.confirm = 'Passwords do not match';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      await save();
      setForm(empty);
      toast.success('Password changed', { title: 'Your other devices were signed out.' });
    } catch (err) {
      if (getErrorCode(err) === 'INVALID_CURRENT_PASSWORD') return setErrors({ currentPassword: 'Your current password is incorrect' });
      const f = getFieldErrors(err);
      if (Object.keys(f).length) setErrors(f); else toast.error(getErrorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader title="Change password" description="You stay signed in here; every other device is signed out." />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Current password" type="password" revealable autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} error={errors.currentPassword} />
        <Input label="New password" type="password" revealable autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} error={errors.newPassword} hint="10+ characters with a letter and a number." />
        <Input label="Confirm new password" type="password" revealable autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        <Button type="submit" loading={pending} leftIcon={<ShieldCheck />}>Update password</Button>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const toast = useToast();
  const { data, loading, error, refetch } = useQuery(({ signal }) => usersApi.listSessions({ signal }), []);
  const [target, setTarget] = useState(null); // session | 'others'
  const sessions = data ?? [];
  const others = sessions.filter((s) => !s.current);

  const confirm = async () => {
    if (target === 'others') await usersApi.revokeOtherSessions(); else await usersApi.revokeSession(target.id);
    toast.success(target === 'others' ? 'Signed out of other devices' : 'Device signed out');
    await refetch({ silent: true });
  };

  return (
    <Card>
      <CardHeader title="Active sessions" description="Devices currently signed in to your account."
        action={others.length > 0 && <Button size="sm" variant="secondary" onClick={() => setTarget('others')}>Sign out all others</Button>} />
      {error && !data ? <ErrorState error={error} onRetry={refetch} /> : loading && !data ? <SkeletonRows rows={3} /> : (
        <ul className="divide-y divide-border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-content-muted"><Laptop className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{s.device || 'Unknown device'}</span>{s.current && <Badge tone="success" dot>This device</Badge>}</p>
                <p className="truncate text-xs text-content-muted" title={`Signed in ${formatDateTime(s.createdAt)}`}>{s.ip ? `${s.ip} · ` : ''}Active {formatRelative(s.lastActiveAt)}</p>
              </div>
              {!s.current && <Button size="sm" variant="danger-ghost" icon aria-label="Sign out this device" onClick={() => setTarget(s)}><LogOut /></Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(target)} onClose={() => setTarget(null)} tone="danger" confirmLabel="Sign out"
        title={target === 'others' ? 'Sign out of all other devices?' : 'Sign out this device?'}
        description="Anyone using it will need to sign in again." onConfirm={confirm} />
    </Card>
  );
}

export default function SecurityTab() {
  return <div className="grid items-start gap-6 lg:grid-cols-2"><PasswordCard /><SessionsCard /></div>;
}
