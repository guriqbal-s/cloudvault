import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Input from '../../components/ui/Input.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import Select from '../../components/ui/Select.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ItemBrowser from '../../components/drive/ItemBrowser.jsx';
import { SelectionBar, ViewToggle } from '../../components/drive/DriveToolbar.jsx';
import useDriveActions from '../../components/drive/useDriveActions.jsx';
import { TYPE_OPTIONS, keyOf, readPref, writePref } from '../../components/drive/driveUtils.js';
import * as searchApi from '../../api/search.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { pluralize } from '../../utils/format.js';

const MB = 1024 * 1024;
const PAGE_SIZE = 30;
const toBytes = (mb) => (mb === '' || Number.isNaN(Number(mb)) ? undefined : Math.round(Number(mb) * MB));
const startOfDay = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOfDay = (d) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [text, setText] = useState(urlQ);
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minMb, setMinMb] = useState('');
  const [maxMb, setMaxMb] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setViewState] = useState(() => (readPref('cv:view', 'list') === 'grid' ? 'grid' : 'list'));
  const [selected, setSelected] = useState(() => new Set());
  const setView = (v) => { setViewState(v); writePref('cv:view', v); };

  // The URL (?q=) is the source of truth so the top bar search and this page stay in sync.
  useEffect(() => { setText(urlQ); }, [urlQ]);
  const debounced = useDebounce(text.trim(), 350);
  useEffect(() => {
    if (debounced !== urlQ.trim()) setParams(debounced ? { q: debounced } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const q = urlQ.trim();
  const filters = useMemo(() => ({
    q: q || undefined, type: type || undefined, from: startOfDay(from), to: endOfDay(to), minSize: toBytes(minMb), maxSize: toBytes(maxMb),
  }), [q, type, from, to, minMb, maxMb]);
  const hasFilters = Boolean(type || from || to || minMb || maxMb);
  const active = Boolean(q) || hasFilters;
  const sizeError = minMb !== '' && maxMb !== '' && Number(minMb) > Number(maxMb) ? 'Minimum is larger than maximum' : '';
  const dateError = from && to && from > to ? 'The start date is after the end date' : '';
  const invalid = Boolean(sizeError || dateError);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [q, type, from, to, minMb, maxMb]);

  const { data, loading, error, refetch } = useQuery(
    ({ signal }) => searchApi.search({ ...filters, page, limit: PAGE_SIZE }, { signal }),
    [filters, page], { enabled: active && !invalid },
  );

  const onChanged = useCallback(() => { setSelected(new Set()); refetch({ silent: true }); }, [refetch]);
  const openFolder = useCallback((f) => navigate(`/files/${f.id}`), [navigate]);
  const { act, overlays } = useDriveActions({ onChanged, onOpenFolder: openFolder });

  const folders = data?.data?.folders ?? [];
  const files = data?.data?.files ?? [];
  const items = useMemo(() => [...folders, ...files], [folders, files]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(keyOf(i))), [items, selected]);
  const total = (data?.meta?.total ?? files.length) + folders.length;

  const reset = () => { setType(''); setFrom(''); setTo(''); setMinMb(''); setMaxMb(''); };

  return (
    <>
      <PageHeader title="Search" icon={<SearchIcon />} description={active && data ? `${pluralize(total, 'result')}${q ? ` for “${q}”` : ''}` : 'Find files and folders by name, type, date or size.'} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Input aria-label="Search files and folders" placeholder="Search files and folders…" leftIcon={<SearchIcon />} value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        </div>
        <Button variant={showFilters || hasFilters ? 'soft' : 'secondary'} leftIcon={<SlidersHorizontal />} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{hasFilters ? ' •' : ''}
        </Button>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {showFilters && (
        <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={TYPE_OPTIONS} />
          <Input label="Modified after" type="date" value={from} onChange={(e) => setFrom(e.target.value)} error={dateError} />
          <Input label="Modified before" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Min size (MB)" type="number" min="0" step="any" inputMode="decimal" value={minMb} onChange={(e) => setMinMb(e.target.value)} error={sizeError} />
            <Input label="Max size (MB)" type="number" min="0" step="any" inputMode="decimal" value={maxMb} onChange={(e) => setMaxMb(e.target.value)} />
          </div>
          {hasFilters && <div className="sm:col-span-2 lg:col-span-4"><Button size="sm" variant="ghost" leftIcon={<X />} onClick={reset}>Clear filters</Button></div>}
        </div>
      )}

      <SelectionBar items={selectedItems} act={act} onClear={() => setSelected(new Set())} />

      {!active ? <EmptyState icon={<SearchIcon />} title="Start typing to search" description="Search covers your own files and everything shared with you." />
        : invalid ? <EmptyState compact icon={<SlidersHorizontal />} title="Check your filters" description={sizeError || dateError} />
          : loading && !data ? <SkeletonRows rows={5} />
            : error && !data ? <ErrorState error={error} onRetry={refetch} title="Search failed" />
              : items.length === 0 ? <EmptyState icon={<SearchIcon />} title="No results" description="Try a different spelling or remove some filters."
                action={hasFilters && <Button variant="secondary" onClick={reset}>Clear filters</Button>} />
                : (
                  <>
                    <ItemBrowser folders={folders} files={files} view={view} selected={selected} onSelectedChange={setSelected} act={act} onOpenFolder={openFolder} />
                    <div className="mt-5"><Pagination meta={data?.meta} onPageChange={setPage} /></div>
                  </>
                )}
      {overlays}
    </>
  );
}
