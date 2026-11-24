import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ItemBrowser from '../../components/drive/ItemBrowser.jsx';
import { DriveToolbar, SelectionBar } from '../../components/drive/DriveToolbar.jsx';
import useDriveActions from '../../components/drive/useDriveActions.jsx';
import { keyOf, readPref, writePref } from '../../components/drive/driveUtils.js';
import * as recentApi from '../../api/recent.js';
import { useQuery } from '../../hooks/useQuery.js';

export default function Recent() {
  const navigate = useNavigate();
  const [view, setViewState] = useState(() => (readPref('cv:view', 'list') === 'grid' ? 'grid' : 'list'));
  const [selected, setSelected] = useState(() => new Set());
  const setView = (v) => { setViewState(v); writePref('cv:view', v); };

  const { data, loading, error, refetch } = useQuery(({ signal }) => recentApi.list({ limit: 40 }, { signal }), []);
  const onChanged = useCallback(() => { setSelected(new Set()); refetch({ silent: true }); }, [refetch]);
  const openFolder = useCallback((f) => navigate(`/files/${f.id}`), [navigate]);
  const { act, overlays } = useDriveActions({ onChanged, onOpenFolder: openFolder });

  // The endpoint returns files; tolerate an { files } envelope too.
  const files = useMemo(() => (Array.isArray(data) ? data : data?.files ?? []), [data]);
  const selectedItems = useMemo(() => files.filter((i) => selected.has(keyOf(i))), [files, selected]);
  useEffect(() => setSelected(new Set()), [data]);

  return (
    <>
      <PageHeader title="Recent" icon={<Clock />} description="Files you opened or changed lately." />
      <DriveToolbar view={view} onViewChange={setView} />
      <SelectionBar items={selectedItems} act={act} onClear={() => setSelected(new Set())} />
      {loading && !data ? <SkeletonRows rows={5} />
        : error && !data ? <ErrorState error={error} onRetry={refetch} />
          : files.length === 0 ? <EmptyState icon={<Clock />} title="Nothing recent yet" description="Files you open, upload or edit will appear here." />
            : <ItemBrowser files={files} view={view} selected={selected} onSelectedChange={setSelected} act={act} onOpenFolder={openFolder} />}
      {overlays}
    </>
  );
}
