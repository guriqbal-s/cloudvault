import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ItemBrowser from '../../components/drive/ItemBrowser.jsx';
import { DriveToolbar, SelectionBar } from '../../components/drive/DriveToolbar.jsx';
import useDriveActions from '../../components/drive/useDriveActions.jsx';
import { keyOf, readPref, writePref } from '../../components/drive/driveUtils.js';
import * as starredApi from '../../api/starred.js';
import { useQuery } from '../../hooks/useQuery.js';

export default function Starred() {
  const navigate = useNavigate();
  const [view, setViewState] = useState(() => (readPref('cv:view', 'list') === 'grid' ? 'grid' : 'list'));
  const [selected, setSelected] = useState(() => new Set());
  const setView = (v) => { setViewState(v); writePref('cv:view', v); };

  const { data, loading, error, refetch } = useQuery(({ signal }) => starredApi.list({ signal }), []);
  const onChanged = useCallback(() => { setSelected(new Set()); refetch({ silent: true }); }, [refetch]);
  const openFolder = useCallback((f) => navigate(`/files/${f.id}`), [navigate]);
  const { act, overlays } = useDriveActions({ onChanged, onOpenFolder: openFolder });

  const folders = data?.folders ?? [];
  const files = data?.files ?? [];
  const items = useMemo(() => [...folders, ...files], [folders, files]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(keyOf(i))), [items, selected]);
  useEffect(() => setSelected(new Set()), [data]);

  return (
    <>
      <PageHeader title="Starred" icon={<Star />} description="Quick access to the files and folders you care about most." />
      <DriveToolbar view={view} onViewChange={setView} />
      <SelectionBar items={selectedItems} act={act} onClear={() => setSelected(new Set())} />
      {loading && !data ? <SkeletonRows rows={5} />
        : error && !data ? <ErrorState error={error} onRetry={refetch} />
          : items.length === 0 ? <EmptyState icon={<Star />} title="No starred items" description="Star a file or folder from its menu and it will show up here." />
            : <ItemBrowser folders={folders} files={files} view={view} selected={selected} onSelectedChange={setSelected} act={act} onOpenFolder={openFolder} />}
      {overlays}
    </>
  );
}
