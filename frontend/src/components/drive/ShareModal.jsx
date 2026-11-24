import { useEffect, useState } from 'react';
import { Check, Copy, Globe, KeyRound, Link2, Trash2, UserPlus } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import Switch, { Checkbox } from '../ui/Switch.jsx';
import Badge from '../ui/Badge.jsx';
import Avatar from '../ui/Avatar.jsx';
import Tabs from '../ui/Tabs.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import ErrorState from '../common/ErrorState.jsx';
import * as sharesApi from '../../api/shares.js';
import * as usersApi from '../../api/users.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorMessage, getFieldErrors } from '../../utils/errors.js';
import { formatDateTime } from '../../utils/format.js';
import { segmentOf } from './driveUtils.js';

const LEVELS = [{ value: 'VIEWER', label: 'Viewer (can view)' }, { value: 'EDITOR', label: 'Editor (can edit)' }];
const linkUrl = (link) => link.url ?? `${window.location.origin}/s/${link.token}`;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function PeopleTab({ item, type, people, onChanged }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState('VIEWER');
  const [canDownload, setCanDownload] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const debounced = useDebounce(email.trim(), 250);

  useEffect(() => {
    if (debounced.length < 2 || debounced.includes(' ')) { setSuggestions([]); return undefined; }
    let cancelled = false;
    usersApi.lookup(debounced)
      .then((users) => { if (!cancelled) setSuggestions((users ?? []).filter((u) => u.email.toLowerCase() !== debounced.toLowerCase())); })
      .catch(() => { if (!cancelled) setSuggestions([]); });
    return () => { cancelled = true; };
  }, [debounced]);

  const add = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setError('Enter an email address'); return; }
    setPending(true);
    setError('');
    try {
      await sharesApi.add(type, item.id, { email: email.trim(), level, canDownload });
      toast.success(`Shared with ${email.trim()}`);
      setEmail('');
      setSuggestions([]);
      onChanged();
    } catch (err) {
      setError(getFieldErrors(err).email ?? getErrorMessage(err));
    } finally { setPending(false); }
  };

  const update = async (person, body) => {
    try { await sharesApi.update(type, item.id, person.user.id, body); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err)); }
  };
  const revoke = async (person) => {
    try { await sharesApi.revoke(type, item.id, person.user.id); toast.success(`Removed ${person.user.name}`); onChanged(); }
    catch (err) { toast.error(getErrorMessage(err)); }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="space-y-3" noValidate>
        <div className="relative">
          <Input label="Add people" type="email" autoComplete="off" placeholder="Name or email address" leftIcon={<UserPlus />}
            value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} error={error} data-autofocus />
          {suggestions.length > 0 && (
            <ul role="listbox" aria-label="Matching people" className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-pop">
              {suggestions.map((u) => (
                <li key={u.id}>
                  <button type="button" role="option" aria-selected="false" onClick={() => { setEmail(u.email); setSuggestions([]); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-sunken">
                    <Avatar user={u} size="sm" />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block truncate text-xs text-content-muted">{u.email}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[11rem] flex-1"><Select label="Permission" value={level} onChange={(e) => setLevel(e.target.value)} options={LEVELS} /></div>
          <Checkbox checked={canDownload} onChange={setCanDownload} label="Can download" className="pb-2.5" />
          <Button type="submit" loading={pending} leftIcon={<UserPlus />}>Share</Button>
        </div>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold">People with access</h3>
        {people.length === 0 ? <p className="rounded-xl bg-surface-muted p-4 text-sm text-content-muted">Only you can see this {item.kind} for now.</p> : (
          <ul className="space-y-2">
            {people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-2.5">
                <Avatar user={p.user ?? { name: '?' }} size="sm" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-semibold">{p.user?.name}</p>
                  <p className="truncate text-xs text-content-muted">{p.user?.email}</p>
                </div>
                <select aria-label={`Permission for ${p.user?.name}`} value={p.level} onChange={(e) => update(p, { level: e.target.value })}
                  className="h-9 rounded-lg border border-border bg-surface-sunken px-2 text-sm">
                  <option value="VIEWER">Viewer</option><option value="EDITOR">Editor</option>
                </select>
                <Checkbox checked={p.canDownload} onChange={(v) => update(p, { canDownload: v })} label="Download" />
                <Button icon variant="danger-ghost" size="sm" aria-label={`Remove ${p.user?.name}`} onClick={() => revoke(p)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LinkRow({ link, type, onChanged }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const url = linkUrl(link);

  const copy = async () => {
    if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } else toast.error('Could not copy. Select the link and copy it manually.');
  };
  const toggleDownload = async (value) => {
    try { await sharesApi.updateLink(link.id, { canDownload: value }); onChanged(); } catch (err) { toast.error(getErrorMessage(err)); }
  };
  const revoke = async () => {
    try { await sharesApi.revokeLink(link.id); toast.success('Link revoked'); onChanged(); } catch (err) { toast.error(getErrorMessage(err)); }
  };

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-sunken px-2.5 font-mono text-xs" />
        <Button size="sm" variant="secondary" onClick={copy} leftIcon={copied ? <Check /> : <Copy />}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button icon size="sm" variant="danger-ghost" aria-label="Revoke link" onClick={revoke}><Trash2 /></Button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {link.hasPassword && <Badge tone="info" icon={<KeyRound />}>Password</Badge>}
        {link.expired ? <Badge tone="danger">Expired</Badge>
          : link.expiresAt ? <Badge tone="warning">Expires {formatDateTime(link.expiresAt)}</Badge> : <Badge tone="neutral">No expiry</Badge>}
        <span className="text-xs text-content-muted">{link.accessCount} {link.accessCount === 1 ? 'view' : 'views'}</span>
        {type === 'files' || type === 'folders' ? <Checkbox checked={link.canDownload} onChange={toggleDownload} label="Allow download" className="ml-auto" /> : null}
      </div>
    </li>
  );
}

function LinksTab({ item, type, links, onChanged }) {
  const toast = useToast();
  const [expires, setExpires] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [canDownload, setCanDownload] = useState(true);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setErrors({});
    const body = { canDownload };
    if (expires) {
      const date = new Date(expires);
      if (Number.isNaN(date.getTime()) || date <= new Date()) { setErrors({ expiresAt: 'Choose a date in the future' }); return; }
      body.expiresAt = date.toISOString();
    }
    if (usePassword) {
      if (!password) { setErrors({ password: 'Enter a password for the link' }); return; }
      body.password = password;
    }
    setPending(true);
    try {
      const { link } = await sharesApi.createLink(type, item.id, body);
      if (link && await copyText(linkUrl(link))) toast.success('Link created and copied');
      else toast.success('Link created');
      setExpires(''); setPassword(''); setUsePassword(false);
      onChanged();
    } catch (err) {
      const fields = getFieldErrors(err);
      if (Object.keys(fields).length) setErrors(fields); else toast.error(getErrorMessage(err));
    } finally { setPending(false); }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={create} className="space-y-3 rounded-xl border border-border bg-surface-muted p-3.5" noValidate>
        <p className="flex items-center gap-2 text-sm font-semibold"><Globe className="h-4 w-4 text-brand" />Create a public link</p>
        <p className="text-xs text-content-muted">Anyone with the link can open this {item.kind}. No account needed.</p>
        <Input label="Expires" type="datetime-local" hint="Leave empty for a link that never expires" value={expires}
          onChange={(e) => setExpires(e.target.value)} error={errors.expiresAt} />
        <Switch checked={usePassword} onChange={setUsePassword} label="Protect with a password" />
        {usePassword && <Input label="Link password" type="password" revealable autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} error={errors.password} />}
        <Switch checked={canDownload} onChange={setCanDownload} label="Allow downloads" />
        <Button type="submit" loading={pending} leftIcon={<Link2 />}>Create link</Button>
      </form>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Active links</h3>
        {links.length === 0 ? <p className="rounded-xl bg-surface-muted p-4 text-sm text-content-muted">No public links yet.</p> : (
          <ul className="space-y-2">{links.map((l) => <LinkRow key={l.id} link={l} type={type} onChanged={onChanged} />)}</ul>
        )}
      </div>
    </div>
  );
}

/** <ShareModal item onClose onChanged() />  (open when `item` is set; works for files and folders). */
export default function ShareModal({ item, onClose, onChanged }) {
  const [tab, setTab] = useState('people');
  const type = item ? segmentOf(item) : null;
  const { data, loading, error, refetch } = useQuery(({ signal }) => sharesApi.details(type, item.id, { signal }), [item?.id, type], { enabled: Boolean(item), keepPrevious: false });

  useEffect(() => { if (item) setTab('people'); }, [item?.id]);

  const changed = () => { refetch({ silent: true }); onChanged?.(); };

  return (
    <Modal open={Boolean(item)} onClose={onClose} size="lg" title={item ? `Share "${item.name}"` : 'Share'}
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      {item && (
        <>
          <Tabs variant="pill" value={tab} onChange={setTab} className="mb-4"
            items={[{ id: 'people', label: 'People', count: data?.people?.length }, { id: 'links', label: 'Public links', count: data?.links?.length }]} />
          {loading && !data ? <SkeletonRows rows={3} /> : error && !data ? <ErrorState error={error} onRetry={refetch} title="Could not load sharing settings" /> : data && (
            tab === 'people'
              ? <PeopleTab item={item} type={type} people={data.people ?? []} onChanged={changed} />
              : <LinksTab item={item} type={type} links={data.links ?? []} onChanged={changed} />
          )}
        </>
      )}
    </Modal>
  );
}
