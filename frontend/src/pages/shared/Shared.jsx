import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Users } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ItemBrowser from '../../components/drive/ItemBrowser.jsx';
import { DriveToolbar, SelectionBar } from '../../components/drive/DriveToolbar.jsx';
import useDriveActions from '../../components/drive/useDriveActions.jsx';
import { keyOf, readPref, writePref } from '../../components/drive/driveUtils.js';
import * as sharesApi from '../../api/shares.js';
import { useQuery } from '../../hooks/useQuery.js';

const TABS = [{ id: 'with-me', label: 'Shared with me', icon: <Users /> }, { id: 'by-me', label: 'Shared by me', icon: <Share2 /> }];

export default function Shared() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('with-me');
  const [view, setViewState] = useState(() => (readPref('cv:view', 'list') === 'grid' ? 'grid' : 'list'));
  const [selected, setSelected] = useState(() => new Set());
  const setView = (v) => { setViewState(v); writePref('cv:view', v); };

  const { data, loading, error, refetch } = useQuery(
    ({ signal }) => (tab === 'with-me' ? sharesApi.withMe({ signal }) : sharesApi.byMe({ signal })),
    [tab], { keepPrevious: false },
  );
  useEffect(() => setSelected(new Set()), [tab]);

  const onChanged = useCallback(() => { setSelected(new Set()); refetch({ silent: true }); }, [refetch]);
  const openFolder = useCallback((f) => navigate(`/files/${f.id}`), [navigate]);
  const { act, overlays } = useDriveActions({ onChanged, onOpenFolder: openFolder });

  const folders = data?.folders ?? [];
  const files = data?.files ?? [];
  const items = useMemo(() => [...folders, ...files], [folders, files]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(keyOf(i))), [items, selected]);

  return (
    <>
      <PageHeader title="Shared" icon={<Share2 />} description="Files and folders shared with you, and the ones you have shared with others." />
      <Tabs value={tab} onChange={setTab} items={TABS} className="mb-5" ariaLabel="Shared items" />
      <DriveToolbar view={view} onViewChange={setView} />
      <SelectionBar items={selectedItems} act={act} onClear={() => setSelected(new Set())} />
      {loading && !data ? <SkeletonRows rows={5} />
        : error && !data ? <ErrorState error={error} onRetry={refetch} />
          : items.length === 0 ? (
            <EmptyState icon={<Share2 />} title={tab === 'with-me' ? 'Nothing has been shared with you yet' : 'You have not shared anything yet'}
              description={tab === 'with-me' ? 'When someone shares a file or folder with you, it appears here.' : 'Use Share on any file or folder to invite people or create a public link.'} />
          ) : <ItemBrowser folders={folders} files={files} view={view} selected={selected} onSelectedChange={setSelected} act={act}
            onOpenFolder={openFolder} showSharedBy={tab === 'with-me'} />}
      {overlays}
    </>
  );
}
