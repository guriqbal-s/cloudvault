import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import Card, { CardHeader } from '../ui/Card.jsx';
import Avatar, { invalidateAvatar } from '../ui/Avatar.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Badge from '../ui/Badge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { formatDate } from '../../utils/format.js';
import * as usersApi from '../../api/users.js';

const MAX = 2 * 1024 * 1024;

export default function ProfileTab() {
  const { user, updateUser, reloadUser } = useAuth();
  const toast = useToast();
  const fileRef = useRef(null);
  const [name, setName] = useState(user.name);
  const [version, setVersion] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});

  const [saveName, { pending: saving }] = useAsync(async () => {
    const updated = await usersApi.updateProfile({ name: name.trim() });
    updateUser({ name: updated?.name ?? name.trim() });
  });
  const [upload, { pending: uploading }] = useAsync(async (file) => {
    const updated = await usersApi.uploadAvatar(file);
    invalidateAvatar(user.id);
    updateUser({ hasAvatar: updated?.hasAvatar ?? true });
    setVersion((v) => v + 1);
    reloadUser();
  });
  const [removeAvatar, { pending: removing }] = useAsync(async () => {
    await usersApi.deleteAvatar();
    invalidateAvatar(user.id);
    updateUser({ hasAvatar: false });
    setVersion((v) => v + 1);
  });

  const onSubmit = async (e) => {
    e.preventDefault();
    setFieldErrors({});
    try { await saveName(); toast.success('Profile updated'); }
    catch (err) { const f = getFieldErrors(err); setFieldErrors(f); if (!Object.keys(f).length) toast.error(getErrorMessage(err)); }
  };
  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif)$/.test(file.type)) return toast.error('Choose a PNG, JPEG or GIF image.');
    if (file.size > MAX) return toast.error('Profile pictures can be at most 2 MB.');
    try { await upload(file); toast.success('Profile picture updated'); } catch (err) { toast.error(getErrorMessage(err)); }
  };
  const onRemove = async () => { try { await removeAvatar(); toast.success('Profile picture removed'); } catch (err) { toast.error(getErrorMessage(err)); } };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile picture" description="PNG, JPEG or GIF, up to 2 MB." />
        <div className="flex items-center gap-5">
          <Avatar user={user} size="xl" version={version} />
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif" className="sr-only" onChange={onPick} aria-label="Choose profile picture" />
            <Button variant="secondary" leftIcon={<Camera />} loading={uploading} onClick={() => fileRef.current?.click()}>{user.hasAvatar ? 'Change' : 'Upload'}</Button>
            {user.hasAvatar && <Button variant="danger-ghost" leftIcon={<Trash2 />} loading={removing} onClick={onRemove}>Remove</Button>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Personal details" />
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name} maxLength={80} required />
          <Input label="Email" value={user.email} readOnly disabled hint="Your email is your sign-in and cannot be changed here." />
          <div className="flex flex-wrap items-center gap-2 text-sm text-content-muted">
            {(user.roles ?? []).map((r) => <Badge key={r} tone="brand">{r}</Badge>)}
            {user.createdAt && <span>Member since {formatDate(user.createdAt)}</span>}
          </div>
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === user.name}>Save changes</Button>
        </form>
      </Card>
    </div>
  );
}
