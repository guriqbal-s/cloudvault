import { useRef, useState } from 'react';
import { Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import Drawer from '../ui/Drawer.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import ErrorState from '../common/ErrorState.jsx';
import ProgressBar from '../ui/ProgressBar.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import * as filesApi from '../../api/files.js';
import { caps } from './driveUtils.js';
import { formatBytes, formatDateTime } from '../../utils/format.js';
import { getErrorMessage } from '../../utils/errors.js';
import { notifyStorageChanged } from '../../utils/events.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/** <VersionsDrawer file onClose onChanged() />  (open when `file` is set). */
export default function VersionsDrawer({ file, onClose, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const { data, loading, error, refetch } = useQuery(({ signal }) => filesApi.listVersions(file.id, { signal }), [file?.id], { enabled: Boolean(file) });

  const c = file ? caps(file) : {};
  const versions = Array.isArray(data) ? data : data?.versions ?? [];
  const isOwner = file && user && file.ownerId === user.id;
  const changed = () => { refetch({ silent: true }); notifyStorageChanged(); onChanged?.(); };

  const upload = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setProgress(0);
    try {
      await filesApi.uploadVersion(file.id, picked, { onProgress: setProgress });
      toast.success('New version uploaded');
      changed();
    } catch (err) { toast.error(getErrorMessage(err)); } finally { setProgress(null); }
  };
  const restore = async (v) => {
    try { await filesApi.restoreVersion(file.id, v.number); toast.success(`Version ${v.number} restored as a new version`); changed(); }
    catch (err) { toast.error(getErrorMessage(err)); }
  };
  const download = async (v) => {
    try { await filesApi.downloadVersion(file.id, v.number, file.name); } catch (err) { toast.error(getErrorMessage(err)); }
  };

  return (
    <>
      <Drawer open={Boolean(file)} onClose={onClose} title="Version history" description={file?.name} width="md"
        footer={c.version ? (
          <div className="w-full">
            {progress != null && <ProgressBar value={progress} max={1} size="sm" className="mb-2" />}
            <Button className="w-full" leftIcon={<Upload />} onClick={() => inputRef.current?.click()} disabled={progress != null}>Upload new version</Button>
            <input ref={inputRef} type="file" hidden onChange={upload} accept={file?.extension ? `.${file.extension}` : undefined} />
          </div>
        ) : undefined}>
        {loading && !data ? <SkeletonRows rows={4} /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
          <ol className="space-y-3">
            {versions.map((v) => (
              <li key={v.id ?? v.number} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">Version {v.number}</p>
                  {v.isCurrent && <Badge tone="brand">Current</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-content-muted">{formatDateTime(v.createdAt)} · {formatBytes(v.size)} · {v.uploadedBy?.name ?? 'Unknown'}</p>
                {v.comment && <p className="mt-1.5 text-sm">{v.comment}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.download !== false && <Button size="sm" variant="secondary" leftIcon={<Download />} onClick={() => download(v)}>Download</Button>}
                  {c.version && !v.isCurrent && <Button size="sm" variant="secondary" leftIcon={<RotateCcw />} onClick={() => restore(v)}>Restore</Button>}
                  {isOwner && !v.isCurrent && <Button size="sm" variant="danger-ghost" leftIcon={<Trash2 />} onClick={() => setToDelete(v)}>Delete</Button>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Drawer>
      <ConfirmDialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} tone="danger" confirmLabel="Delete version"
        title={`Delete version ${toDelete?.number}?`} description="This permanently removes this version and frees its storage."
        onConfirm={async () => { await filesApi.deleteVersion(file.id, toDelete.number); toast.success('Version deleted'); changed(); }} />
    </>
  );
}
