import { useEffect, useState } from 'react';
import { ChevronRight, Folder, Home } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import Spinner from '../ui/Spinner.jsx';
import * as filesApi from '../../api/files.js';
import * as foldersApi from '../../api/folders.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorMessage } from '../../utils/errors.js';

/**
 * Folder picker. <MoveModal items={[...]} onClose onMoved() />  (open when `items` is non-empty).
 * Moves every item into the chosen folder (null = My Files root). Folders cannot be moved into themselves.
 */
export default function MoveModal({ items, onClose, onMoved }) {
  const toast = useToast();
  const open = Boolean(items?.length);
  const [location, setLocation] = useState({ id: 'root', name: 'My Files' });
  const [crumbs, setCrumbs] = useState([]);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => { if (open) { setLocation({ id: 'root', name: 'My Files' }); setError(''); } }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const ctl = new AbortController();
    setLoading(true);
    foldersApi.open(location.id, { limit: 1 }, { signal: ctl.signal })
      .then(({ data }) => { setChildren(data.folders ?? []); setCrumbs(data.breadcrumbs ?? []); setLoading(false); })
      .catch((err) => { if (!ctl.signal.aborted) { setError(getErrorMessage(err)); setLoading(false); } });
    return () => ctl.abort();
  }, [open, location.id]);

  if (!open) return null;
  const movingIds = new Set(items.filter((i) => i.kind === 'folder').map((i) => i.id));
  const targetId = location.id === 'root' ? null : location.id;
  const insideMoved = crumbs.some((c) => movingIds.has(c.id)) || movingIds.has(location.id);
  const sameParent = items.every((i) => (i.kind === 'folder' ? i.parentId : i.folderId) === targetId);

  const move = async () => {
    setPending(true);
    setError('');
    let moved = 0;
    const failures = [];
    for (const item of items) {
      try {
        if (item.kind === 'folder') await foldersApi.update(item.id, { parentId: targetId });
        else await filesApi.update(item.id, { folderId: targetId });
        moved += 1;
      } catch (err) { failures.push(`${item.name}: ${getErrorMessage(err)}`); }
    }
    setPending(false);
    if (moved) { toast.success(moved === 1 ? 'Moved' : `Moved ${moved} items`); onMoved?.(); }
    if (failures.length) { setError(failures.join(' · ')); if (!moved) return; }
    if (!failures.length) onClose();
  };

  return (
    <Modal open onClose={() => !pending && onClose()} title={items.length === 1 ? `Move "${items[0].name}"` : `Move ${items.length} items`} size="md"
      footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button onClick={move} loading={pending} disabled={insideMoved || sameParent}>Move here</Button></>}>
      <nav aria-label="Destination" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-semibold hover:bg-surface-sunken" onClick={() => setLocation({ id: 'root', name: 'My Files' })}><Home className="h-4 w-4" />My Files</button>
        {crumbs.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-content-faint" />
            <button type="button" className="rounded-md px-1.5 py-1 font-semibold hover:bg-surface-sunken" onClick={() => setLocation({ id: c.id, name: c.name })}>{c.name}</button>
          </span>
        ))}
      </nav>
      <div className="h-64 overflow-y-auto rounded-xl border border-border bg-surface-muted p-1.5">
        {loading ? <div className="flex h-full items-center justify-center"><Spinner /></div>
          : children.length === 0 ? <p className="flex h-full items-center justify-center text-sm text-content-muted">No folders here</p>
            : children.map((f) => {
              const disabled = movingIds.has(f.id);
              return (
                <button key={f.id} type="button" disabled={disabled} onClick={() => setLocation({ id: f.id, name: f.name })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40">
                  <Folder className="h-4 w-4 text-brand" /><span className="min-w-0 flex-1 truncate">{f.name}</span><ChevronRight className="h-4 w-4 text-content-faint" />
                </button>
              );
            })}
      </div>
      <p className="mt-2 text-xs text-content-muted">Destination: <strong className="text-content">{location.name}</strong>{insideMoved && ' (a folder cannot be moved into itself)'}</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
