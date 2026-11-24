import { useMemo, useState } from 'react';
import { Star, Users } from 'lucide-react';
import { FloatingMenu, MenuContext } from '../ui/Dropdown.jsx';
import { Checkbox } from '../ui/Switch.jsx';
import { FileIcon } from '../../utils/fileIcons.jsx';
import { cn } from '../../utils/cn.js';
import { formatBytes, formatDate, formatRelative, pluralize } from '../../utils/format.js';
import ItemMenu, { ItemMenuItems } from './ItemMenu.jsx';
import { keyOf } from './driveUtils.js';

const LIST_COLS = 'grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_auto] lg:grid-cols-[auto_minmax(0,1fr)_9rem_7rem_5rem_auto]';

function Flags({ item }) {
  return (
    <span className="ml-1.5 inline-flex shrink-0 items-center gap-1 align-middle text-content-faint">
      {item.starred && <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-label="Starred" />}
      {item.shared && <Users className="h-3.5 w-3.5" aria-label="Shared" />}
    </span>
  );
}

const meta = (item) => (item.kind === 'folder'
  ? (item.itemCount == null ? 'Folder' : pluralize(item.itemCount, 'item'))
  : formatBytes(item.size));

/**
 * Folders + files as a list or a grid with selection, kebab menu and right-click menu.
 *
 * <ItemBrowser folders files view="list|grid" selected={Set<key>} onSelectedChange act onOpenFolder
 *   showSharedBy />
 * Clicking a name opens it (folder -> onOpenFolder, file -> preview through act('open')).
 */
export default function ItemBrowser({ folders = [], files = [], view = 'list', selected, onSelectedChange, act, onOpenFolder, showSharedBy = false, selectable = true }) {
  const [ctx, setCtx] = useState(null); // { item, point }
  const items = useMemo(() => [...folders, ...files], [folders, files]);
  const sel = selected ?? new Set();
  const allSelected = items.length > 0 && items.every((i) => sel.has(keyOf(i)));

  const toggle = (item) => {
    const next = new Set(sel);
    const key = keyOf(item);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelectedChange?.(next);
  };
  const toggleAll = () => onSelectedChange?.(allSelected ? new Set() : new Set(items.map(keyOf)));

  const open = (item) => (item.kind === 'folder' ? onOpenFolder?.(item) : act('open', item));
  const onContextMenu = (e, item) => {
    e.preventDefault();
    setCtx({ item, point: { x: e.clientX, y: e.clientY } });
  };
  const onRowClick = (e, item) => {
    if (selectable && (e.metaKey || e.ctrlKey)) { e.preventDefault(); toggle(item); }
  };

  const contextMenu = (
    <FloatingMenu open={Boolean(ctx)} point={ctx?.point} onClose={() => setCtx(null)}>
      <MenuContext.Provider value={() => setCtx(null)}>
        {ctx && <ItemMenuItems item={ctx.item} act={act} />}
      </MenuContext.Provider>
    </FloatingMenu>
  );

  const ownerOf = (item) => (showSharedBy && item.sharedBy ? item.sharedBy.name : item.owner?.name ?? '—');

  if (view === 'grid') {
    return (
      <>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => {
            const checked = sel.has(keyOf(item));
            return (
              <li key={keyOf(item)} onContextMenu={(e) => onContextMenu(e, item)} onClick={(e) => onRowClick(e, item)}
                className={cn('group relative rounded-2xl border bg-surface p-3 shadow-card transition-colors hover:border-border-strong',
                  checked ? 'border-brand bg-brand-soft/40' : 'border-border')}>
                {selectable && (
                  <div className={cn('absolute left-2.5 top-2.5 z-10 rounded-md bg-surface/90 p-0.5', checked ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100')}>
                    <Checkbox checked={checked} onChange={() => toggle(item)} aria-label={`Select ${item.name}`} />
                  </div>
                )}
                <div className="absolute right-1.5 top-1.5 z-10"><ItemMenu item={item} act={act} /></div>
                <button type="button" onClick={() => open(item)} className="flex w-full flex-col items-center gap-3 pt-6 text-center focus-visible:outline-none">
                  <FileIcon item={item} size="lg" />
                  <span className="w-full min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.name}<Flags item={item} /></span>
                    <span className="mt-0.5 block truncate text-xs text-content-muted">{meta(item)} · {formatRelative(item.updatedAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {contextMenu}
      </>
    );
  }

  return (
    <>
      <div role="table" aria-label="Files and folders" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <div role="row" className={cn('grid items-center gap-3 border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-content-faint', LIST_COLS)}>
          <span className="w-4">{selectable && <Checkbox checked={allSelected} indeterminate={!allSelected && sel.size > 0} onChange={toggleAll} aria-label="Select all" />}</span>
          <span role="columnheader">Name</span>
          <span role="columnheader" className="hidden lg:block">{showSharedBy ? 'Shared by' : 'Owner'}</span>
          <span role="columnheader" className="hidden sm:block">Modified</span>
          <span role="columnheader" className="hidden text-right sm:block">Size</span>
          <span className="w-8" />
        </div>
        <ul>
          {items.map((item) => {
            const checked = sel.has(keyOf(item));
            return (
              <li key={keyOf(item)} role="row" onContextMenu={(e) => onContextMenu(e, item)} onClick={(e) => onRowClick(e, item)}
                className={cn('grid items-center gap-3 border-b border-border px-4 py-2 last:border-b-0 hover:bg-surface-sunken/60', LIST_COLS, checked && 'bg-brand-soft/40')}>
                <span className="w-4">{selectable && <Checkbox checked={checked} onChange={() => toggle(item)} aria-label={`Select ${item.name}`} />}</span>
                <button type="button" onClick={() => open(item)} className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none">
                  <FileIcon item={item} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.name}<Flags item={item} /></span>
                    <span className="block truncate text-xs text-content-muted sm:hidden">{meta(item)} · {formatRelative(item.updatedAt)}</span>
                  </span>
                </button>
                <span className="hidden truncate text-sm text-content-muted lg:block">{ownerOf(item)}</span>
                <span className="hidden truncate text-sm text-content-muted sm:block" title={formatDate(item.updatedAt)}>{formatRelative(item.updatedAt)}</span>
                <span className="hidden truncate text-right text-sm text-content-muted tabular sm:block">{meta(item)}</span>
                <ItemMenu item={item} act={act} />
              </li>
            );
          })}
        </ul>
      </div>
      {contextMenu}
    </>
  );
}
