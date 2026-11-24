import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import MoveModal from './MoveModal.jsx';
import PreviewModal from './PreviewModal.jsx';
import RenameModal from './RenameModal.jsx';
import ShareModal from './ShareModal.jsx';
import VersionsDrawer from './VersionsDrawer.jsx';
import * as filesApi from '../../api/files.js';
import * as foldersApi from '../../api/folders.js';
import * as starredApi from '../../api/starred.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getErrorMessage } from '../../utils/errors.js';
import { notifyStorageChanged } from '../../utils/events.js';
import { segmentOf } from './driveUtils.js';

const asList = (target) => (Array.isArray(target) ? target : [target]);

/**
 * One place for every action on files/folders so all pages behave the same.
 *
 *   const { act, overlays } = useDriveActions({ onChanged: () => refetch({ silent: true }), onOpenFolder });
 *   act('rename' | 'move' | 'delete' | 'share' | 'versions' | 'star' | 'download' | 'open', itemOrItems)
 *   ...render {overlays} once at the end of the page.
 */
export default function useDriveActions({ onChanged, onOpenFolder } = {}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [rename, setRename] = useState(null);
  const [move, setMove] = useState(null);
  const [share, setShare] = useState(null);
  const [versions, setVersions] = useState(null);
  const [preview, setPreview] = useState(null);
  const [trashing, setTrashing] = useState(null);

  const changed = useCallback(() => onChanged?.(), [onChanged]);

  const act = useCallback(async (action, target) => {
    const items = asList(target).filter(Boolean);
    if (!items.length) return;
    const [first] = items;
    switch (action) {
      case 'open':
        if (first.kind === 'folder') onOpenFolder?.(first);
        else setPreview(first);
        break;
      case 'download':
        for (const f of items.filter((i) => i.kind === 'file')) {
          try { await filesApi.download(f.id); } catch (err) { toast.error(getErrorMessage(err)); }
        }
        break;
      case 'rename': setRename(first); break;
      case 'move': setMove(items); break;
      case 'share': setShare(first); break;
      case 'versions': setVersions(first); break;
      case 'delete': setTrashing(items); break;
      case 'star': {
        // Bulk: if everything is starred, unstar all; otherwise star whatever is not yet starred.
        const unstar = items.every((i) => i.starred);
        const todo = unstar ? items : items.filter((i) => !i.starred);
        const results = await Promise.allSettled(todo.map((i) => starredApi.toggle(segmentOf(i), i.id, i.starred)));
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) toast.error(getErrorMessage(failed.reason));
        else toast.success(unstar ? 'Removed from starred' : 'Added to starred');
        changed();
        break;
      }
      default:
    }
  }, [onOpenFolder, toast, changed]);

  const confirmTrash = async () => {
    const results = await Promise.allSettled(trashing.map((i) => (i.kind === 'folder' ? foldersApi.remove(i.id) : filesApi.remove(i.id))));
    const failed = results.filter((r) => r.status === 'rejected');
    const done = results.length - failed.length;
    if (done) {
      toast.success(done === 1 ? 'Moved to trash' : `${done} items moved to trash`, {
        action: { label: 'View trash', onClick: () => { navigate('/trash'); } },
      });
      notifyStorageChanged();
      changed();
    }
    if (failed.length) throw failed[0].reason; // keeps the dialog open with the error message
  };

  const overlays = (
    <>
      <RenameModal item={rename} onClose={() => setRename(null)} onRenamed={changed} />
      <MoveModal items={move} onClose={() => setMove(null)} onMoved={changed} />
      <ShareModal item={share} onClose={() => setShare(null)} onChanged={changed} />
      <VersionsDrawer file={versions} onClose={() => setVersions(null)} onChanged={changed} />
      <PreviewModal file={preview} onClose={() => setPreview(null)} />
      <ConfirmDialog open={Boolean(trashing)} onClose={() => setTrashing(null)} tone="danger" confirmLabel="Move to trash"
        title={trashing?.length === 1 ? `Move "${trashing[0].name}" to trash?` : `Move ${trashing?.length ?? 0} items to trash?`}
        description="You can restore items from the trash until they are deleted permanently. They keep counting toward your storage until then."
        onConfirm={confirmTrash} />
    </>
  );

  return { act, overlays };
}
