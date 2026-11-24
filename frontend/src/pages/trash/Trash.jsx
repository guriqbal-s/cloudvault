import { useMemo, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { FileIcon } from '../../utils/fileIcons.jsx';
import { segmentOf, keyOf } from '../../components/drive/driveUtils.js';
import * as trashApi from '../../api/trash.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorCode, getErrorMessage } from '../../utils/errors.js';
import { notifyStorageChanged } from '../../utils/events.js';
import { formatBytes, formatRelative } from '../../utils/format.js';

export default function Trash() {
  const toast = useToast();
  const { data, loading, error, refetch } = useQuery(({ signal }) => trashApi.list({ signal }), []);
  const [busy, setBusy] = useState(null); // item key currently being restored
  const [purgeItem, setPurgeItem] = useState(null);
  const [emptyOpen, setEmptyOpen] = useState(false);

  const items = useMemo(() => [...(data?.folders ?? []), ...(data?.files ?? [])]
    .sort((a, b) => new Date(b.deletedAt ?? 0) - new Date(a.deletedAt ?? 0)), [data]);

  const reload = () => { notifyStorageChanged(); refetch({ silent: true }); };

  const restore = async (item) => {
    setBusy(keyOf(item));
    try {
      await trashApi.restore(segmentOf(item), item.id);
      toast.success(`Restored "${item.name}"`);
      reload();
    } catch (err) {
      toast.error(getErrorCode(err) === 'RESTORE_PARENT_FIRST'
        ? 'This item was deleted together with its folder. Restore the folder first.' : getErrorMessage(err));
    } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Trash" icon={<Trash2 />} description="Deleted items stay here until you remove them for good. They still count toward your storage."
        actions={items.length > 0 && <Button variant="danger-ghost" leftIcon={<Trash2 />} onClick={() => setEmptyOpen(true)}>Empty trash</Button>} />

      {loading && !data ? <SkeletonRows rows={4} />
        : error && !data ? <ErrorState error={error} onRetry={refetch} />
          : items.length === 0 ? <EmptyState icon={<Trash2 />} title="Trash is empty" description="Items you delete show up here, so you can restore them if you change your mind." />
            : (
              <ul className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
                {items.map((item) => (
                  <li key={keyOf(item)} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                    <FileIcon item={item} size="sm" />
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="truncate text-xs text-content-muted">
                        {item.kind === 'folder' ? 'Folder' : formatBytes(item.size)} · deleted {formatRelative(item.deletedAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" leftIcon={<RotateCcw />} loading={busy === keyOf(item)} onClick={() => restore(item)}>Restore</Button>
                      <Button size="sm" variant="danger-ghost" leftIcon={<Trash2 />} onClick={() => setPurgeItem(item)}>Delete forever</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

      <ConfirmDialog open={Boolean(purgeItem)} onClose={() => setPurgeItem(null)} tone="danger" confirmLabel="Delete forever"
        title={`Delete "${purgeItem?.name}" forever?`}
        description={purgeItem?.kind === 'folder' ? 'The folder and everything in it will be permanently deleted. This cannot be undone.' : 'The file and all of its versions will be permanently deleted. This cannot be undone.'}
        onConfirm={async () => { await trashApi.purge(segmentOf(purgeItem), purgeItem.id); toast.success('Deleted permanently'); reload(); }} />
      <ConfirmDialog open={emptyOpen} onClose={() => setEmptyOpen(false)} tone="danger" confirmLabel="Empty trash"
        title="Empty the trash?" description={`All ${items.length} items in the trash will be permanently deleted and their storage freed. This cannot be undone.`}
        onConfirm={async () => { await trashApi.empty(); toast.success('Trash emptied'); reload(); }} />
    </>
  );
}
