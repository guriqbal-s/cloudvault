import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FolderOpen, FolderPlus, UploadCloud } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ItemBrowser from '../../components/drive/ItemBrowser.jsx';
import { DriveToolbar, SelectionBar } from '../../components/drive/DriveToolbar.jsx';
import NewFolderModal from '../../components/drive/NewFolderModal.jsx';
import UploadModal from '../../components/drive/UploadModal.jsx';
import useDriveActions from '../../components/drive/useDriveActions.jsx';
import { keyOf, readPref, writePref } from '../../components/drive/driveUtils.js';
import * as foldersApi from '../../api/folders.js';
import { useQuery } from '../../hooks/useQuery.js';
import { on, STORAGE_CHANGED } from '../../utils/events.js';

const PAGE_SIZE = 48;

export default function Files() {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const [view, setViewState] = useState(() => (readPref('cv:view', 'list') === 'grid' ? 'grid' : 'list'));
  const [sortValue, setSortValue] = useState('name:asc');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);

  const [sort, order] = sortValue.split(':');
  const setView = (v) => { setViewState(v); writePref('cv:view', v); };

  const { data, loading, error, refetch } = useQuery(
    ({ signal }) => foldersApi.open(folderId ?? 'root', { sort, order, type, page, limit: PAGE_SIZE }, { signal }),
    [folderId, sort, order, type, page],
  );

  // New folder / sort / filter => back to page 1 with nothing selected.
  useEffect(() => { setPage(1); setSelected(new Set()); }, [folderId, sortValue, type]);
  useEffect(() => { setSelected(new Set()); }, [page]);
  // Uploads elsewhere (or deleting a version) change what is listed here too.
  useEffect(() => on(STORAGE_CHANGED, () => refetch({ silent: true })), [refetch]);

  const onChanged = useCallback(() => { setSelected(new Set()); refetch({ silent: true }); }, [refetch]);
  const openFolder = useCallback((f) => navigate(`/files/${f.id}`), [navigate]);
  const { act, overlays } = useDriveActions({ onChanged, onOpenFolder: openFolder });

  const listing = data?.data;
  const folder = listing?.folder ?? null;
  const folders = listing?.folders ?? [];
  const files = listing?.files ?? [];
  const meta = data?.meta;
  const canCreate = folderId ? Boolean(folder?.access?.capabilities?.createChild) : true;

  const items = useMemo(() => [...folders, ...files], [folders, files]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(keyOf(i))), [items, selected]);

  const crumbs = useMemo(() => {
    const out = [{ label: 'My Files', to: '/files' }];
    for (const c of listing?.breadcrumbs ?? []) out.push({ label: c.name, to: `/files/${c.id}` });
    if (folderId && out.length === 1) out.push({ label: folder?.name ?? '…' });
    return out;
  }, [listing, folderId, folder]);

  // Drag & drop anywhere on the page opens the upload dialog with the dropped files.
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dragProps = canCreate ? {
    onDragEnter: (e) => { if (hasFiles(e)) { e.preventDefault(); setDragDepth((d) => d + 1); } },
    onDragOver: (e) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: (e) => { if (hasFiles(e)) setDragDepth((d) => Math.max(0, d - 1)); },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragDepth(0);
      if (e.dataTransfer.files?.length) { setDroppedFiles(Array.from(e.dataTransfer.files)); setUploadOpen(true); }
    },
  } : {};

  const empty = !loading && !error && items.length === 0;
  const filtered = Boolean(type);

  return (
    <div {...dragProps} className="relative min-h-[60vh]">
      <PageHeader title={folder?.name ?? 'My Files'} icon={<FolderOpen />} breadcrumbs={folderId ? crumbs : undefined}
        description={folderId ? undefined : 'Browse, upload and organise your files.'}
        actions={canCreate && (
          <>
            <Button variant="secondary" leftIcon={<FolderPlus />} onClick={() => setFolderOpen(true)}>New folder</Button>
            <Button leftIcon={<UploadCloud />} onClick={() => { setDroppedFiles(null); setUploadOpen(true); }}>Upload</Button>
          </>
        )} />

      <DriveToolbar sort={sortValue} onSortChange={setSortValue} type={type} onTypeChange={setType} view={view} onViewChange={setView} />
      <SelectionBar items={selectedItems} act={act} onClear={() => setSelected(new Set())} />

      {loading && !data ? <SkeletonRows rows={6} />
        : error && !data ? <ErrorState error={error} onRetry={refetch} title={folderId ? 'Could not open this folder' : undefined} />
          : empty ? (
            <EmptyState icon={<FolderOpen />} title={filtered ? 'No files of this type here' : folderId ? 'This folder is empty' : 'Your drive is empty'}
              description={filtered ? 'Try another file type.' : canCreate ? 'Drop files anywhere on this page, or use the Upload button.' : 'Nothing has been added to this folder yet.'}
              action={canCreate && !filtered && <Button leftIcon={<UploadCloud />} onClick={() => { setDroppedFiles(null); setUploadOpen(true); }}>Upload files</Button>} />
          ) : (
            <>
              <ItemBrowser folders={folders} files={files} view={view} selected={selected} onSelectedChange={setSelected} act={act} onOpenFolder={openFolder} />
              <div className="mt-5"><Pagination meta={meta} onPageChange={setPage} /></div>
            </>
          )}

      {dragDepth > 0 && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-brand/10 backdrop-blur-[1px]" aria-hidden="true">
          <div className="rounded-3xl border-2 border-dashed border-brand bg-surface px-10 py-8 text-center shadow-pop">
            <UploadCloud className="mx-auto mb-2 h-10 w-10 text-brand" />
            <p className="font-display text-lg font-semibold">Drop files to upload{folder ? ` to “${folder.name}”` : ''}</p>
          </div>
        </div>
      )}

      <UploadModal open={uploadOpen} onClose={() => { setUploadOpen(false); setDroppedFiles(null); }} folderId={folderId} initialFiles={droppedFiles} onUploaded={onChanged} />
      <NewFolderModal open={folderOpen} onClose={() => setFolderOpen(false)} parentId={folderId} onCreated={onChanged} />
      {overlays}
    </div>
  );
}
