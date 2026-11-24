import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Eye, FileQuestion, Folder, Home, KeyRound, Link2Off, Lock, ChevronRight } from 'lucide-react';
import Logo from '../../components/common/Logo.jsx';
import ThemeToggle from '../../components/layout/ThemeToggle.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { FileIcon } from '../../utils/fileIcons.jsx';
import * as publicApi from '../../api/publicLinks.js';
import { formatBytes, formatDate, formatRelative } from '../../utils/format.js';
import { getErrorCode, getErrorMessage, getStatus } from '../../utils/errors.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';

function Shell({ children }) {
  return (
    <div className="auth-backdrop min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5"><Logo /><ThemeToggle /></header>
      <main className="mx-auto max-w-3xl px-5 pb-16">{children}</main>
      <p className="pb-8 text-center text-xs text-content-faint">Shared securely with CloudVault</p>
    </div>
  );
}

function UnlockForm({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!password) { setError('Enter the password'); return; }
    setPending(true);
    setError('');
    try { await onUnlock(password); } catch (err) {
      setError(getErrorCode(err) === 'INVALID_LINK_PASSWORD' ? 'That password is not correct' : getErrorMessage(err));
    } finally { setPending(false); }
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-card" noValidate>
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Lock className="h-6 w-6" /></span>
      <h1 className="text-center font-display text-xl font-semibold">This link is protected</h1>
      <p className="mb-5 mt-1 text-center text-sm text-content-muted">Enter the password you were given to continue.</p>
      <Input label="Password" type="password" revealable autoComplete="off" leftIcon={<KeyRound />} value={password}
        onChange={(e) => { setPassword(e.target.value); setError(''); }} error={error} data-autofocus />
      <Button type="submit" className="mt-4 w-full" loading={pending}>Unlock</Button>
    </form>
  );
}

function Unavailable({ status }) {
  const gone = status === 410;
  return (
    <EmptyState icon={gone ? <Link2Off /> : <FileQuestion />} title={gone ? 'This link is no longer available' : 'Link not found'}
      description={gone ? 'It has expired or the owner turned it off. Ask them to send you a new one.' : 'Check that the address is complete and try again.'} />
  );
}

/** Inline preview used for single-file links and files inside a shared folder. */
function PreviewModal({ target, onClose }) {
  const [text, setText] = useState({ loading: false, value: null, error: '' });
  const kind = target?.previewKind;
  useEffect(() => {
    if (!target || kind !== 'text') return undefined;
    let cancelled = false;
    setText({ loading: true, value: null, error: '' });
    fetch(target.previewUrl, { credentials: 'omit' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not load the preview.'))))
      .then((value) => { if (!cancelled) setText({ loading: false, value: value.slice(0, 200_000), error: '' }); })
      .catch((e) => { if (!cancelled) setText({ loading: false, value: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [target, kind]);

  return (
    <Modal open={Boolean(target)} onClose={onClose} size="full" title={target?.name}
      footer={target?.canDownload ? <Button as="a" href={target.downloadUrl} variant="secondary" leftIcon={<Download />}>Download</Button> : undefined}>
      <div className="flex min-h-[50vh] items-center justify-center overflow-hidden rounded-xl bg-surface-sunken">
        {kind === 'image' && <img src={target.previewUrl} alt={target.name} className="max-h-[70vh] max-w-full object-contain" />}
        {kind === 'video' && <video src={target.previewUrl} controls className="max-h-[70vh] w-full bg-black" />}
        {kind === 'pdf' && <iframe src={target.previewUrl} title={target.name} className="h-[70vh] w-full border-0" />}
        {kind === 'text' && (text.loading ? <Spinner /> : text.error
          ? <p role="alert" className="p-6 text-sm text-danger">{text.error}</p>
          : <pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs">{text.value}</pre>)}
      </div>
    </Modal>
  );
}

function FileCard({ token, meta, unlockToken, onPreview }) {
  const downloadUrl = publicApi.url(token, 'download', unlockToken);
  const previewUrl = publicApi.url(token, 'preview', unlockToken);
  const item = { kind: 'file', category: meta.category };
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-6 text-center shadow-card">
      <FileIcon item={item} size="lg" className="mx-auto" />
      <h1 className="mt-4 break-words font-display text-xl font-semibold">{meta.name}</h1>
      <p className="mt-1 text-sm text-content-muted">{formatBytes(meta.size)}{meta.sharedBy ? ` · shared by ${meta.sharedBy}` : ''}</p>
      {meta.expiresAt && <p className="mt-1 text-xs text-content-faint">Link expires {formatDate(meta.expiresAt)}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {meta.previewKind && <Button variant="secondary" leftIcon={<Eye />} onClick={() => onPreview({ name: meta.name, previewKind: meta.previewKind, previewUrl, downloadUrl, canDownload: meta.canDownload })}>Preview</Button>}
        {meta.canDownload ? <Button as="a" href={downloadUrl} leftIcon={<Download />}>Download</Button>
          : <p className="w-full text-sm text-content-muted">The owner has turned off downloads for this link.</p>}
      </div>
    </div>
  );
}

function FolderBrowser({ token, meta, unlockToken, onLocked, onPreview }) {
  const [folderId, setFolderId] = useState(null);
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    publicApi.browse(token, { folderId: folderId ?? undefined, unlockToken })
      .then((data) => { if (!cancelled) setState({ loading: false, data, error: null }); })
      .catch((error) => {
        if (cancelled) return;
        if (getErrorCode(error) === 'LINK_LOCKED') { onLocked(); return; }
        setState((s) => ({ ...s, loading: false, error }));
      });
    return () => { cancelled = true; };
  }, [token, folderId, unlockToken, onLocked]);

  const { data, loading, error } = state;
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border p-4">
        <p className="text-xs text-content-muted">Shared folder{meta.sharedBy ? ` · by ${meta.sharedBy}` : ''}{meta.expiresAt ? ` · expires ${formatDate(meta.expiresAt)}` : ''}</p>
        <h1 className="break-words font-display text-xl font-semibold">{meta.name}</h1>
        <nav aria-label="Folder path" className="mt-2 flex flex-wrap items-center gap-1 text-sm">
          {(data?.breadcrumbs ?? []).map((c, i, all) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-content-faint" />}
              {i === 0 && <Home className="h-3.5 w-3.5 text-content-muted" />}
              {i === all.length - 1 ? <span className="px-1 font-semibold">{i === 0 ? 'Top folder' : c.name}</span>
                : <button type="button" className="rounded-md px-1 text-content-muted hover:bg-surface-sunken hover:text-content" onClick={() => setFolderId(i === 0 ? null : c.id)}>{i === 0 ? 'Top folder' : c.name}</button>}
            </span>
          ))}
        </nav>
      </div>
      {loading && !data ? <div className="flex justify-center p-10"><Spinner /></div>
        : error && !data ? <p role="alert" className="p-6 text-sm text-danger">{getErrorMessage(error)}</p>
          : data.folders.length + data.files.length === 0 ? <EmptyState compact icon={<Folder />} title="This folder is empty" />
            : (
              <ul>
                {data.folders.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => setFolderId(f.id)} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface-sunken/60">
                      <FileIcon item="folder" size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.name}</span>
                      <span className="hidden text-xs text-content-muted sm:block">{formatRelative(f.updatedAt)}</span>
                      <ChevronRight className="h-4 w-4 text-content-faint" />
                    </button>
                  </li>
                ))}
                {data.files.map((f) => {
                  const previewUrl = publicApi.url(token, 'preview', unlockToken, f.id);
                  const downloadUrl = publicApi.url(token, 'download', unlockToken, f.id);
                  return (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                      <FileIcon item={f} size="sm" />
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate text-sm font-semibold">{f.name}</p>
                        <p className="text-xs text-content-muted">{formatBytes(f.size)} · {formatRelative(f.updatedAt)}</p>
                      </div>
                      <div className="flex gap-1.5">
                        {f.previewKind && <Button size="sm" variant="secondary" leftIcon={<Eye />} onClick={() => onPreview({ name: f.name, previewKind: f.previewKind, previewUrl, downloadUrl, canDownload: data.canDownload })}>Preview</Button>}
                        {data.canDownload && <Button as="a" href={downloadUrl} size="sm" variant="secondary" leftIcon={<Download />}>Download</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
    </div>
  );
}

/** Public share page (route /s/:token). No session: only api/publicLinks.js is used. */
export default function PublicShare() {
  const { token } = useParams();
  const [unlockToken, setUnlockToken] = useState(null); // memory only
  const [state, setState] = useState({ loading: true, meta: null, status: 0 });
  const [preview, setPreview] = useState(null);
  usePageTitle(state.meta?.name ? `${state.meta.name} · Shared` : 'Shared link');

  const load = useCallback(async (at) => {
    try {
      const meta = await publicApi.metadata(token, at);
      setState({ loading: false, meta, status: 0 });
      return meta;
    } catch (err) {
      setState({ loading: false, meta: null, status: getStatus(err) || 404 });
      return null;
    }
  }, [token]);

  useEffect(() => { setUnlockToken(null); setState({ loading: true, meta: null, status: 0 }); load(undefined); }, [token, load]);

  const unlock = async (password) => {
    const { accessToken } = await publicApi.unlock(token, password); // throws on a wrong password
    setUnlockToken(accessToken);
    await load(accessToken);
  };
  // The unlock token is short-lived: when the server says the link is locked again, ask for the password again.
  const relock = useCallback(() => { setUnlockToken(null); setState((s) => (s.meta ? { ...s, meta: { ...s.meta, unlocked: false } } : s)); }, []);

  const { loading, meta, status } = state;
  return (
    <Shell>
      {loading ? <div className="flex justify-center py-24" role="status" aria-label="Loading"><Spinner /></div>
        : !meta ? <Unavailable status={status} />
          : meta.requiresPassword && !meta.unlocked ? <UnlockForm onUnlock={unlock} />
            : meta.kind === 'folder'
              ? <FolderBrowser token={token} meta={meta} unlockToken={unlockToken} onLocked={relock} onPreview={setPreview} />
              : <FileCard token={token} meta={meta} unlockToken={unlockToken} onPreview={setPreview} />}
      <PreviewModal target={preview} onClose={() => setPreview(null)} />
    </Shell>
  );
}
