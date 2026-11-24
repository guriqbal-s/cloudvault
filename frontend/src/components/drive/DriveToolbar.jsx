import { Download, FolderInput, LayoutGrid, List, Star, Trash2, X } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Select from '../ui/Select.jsx';
import { cn } from '../../utils/cn.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { SORT_OPTIONS, TYPE_OPTIONS, caps, isOwner } from './driveUtils.js';

/** List / grid switch. <ViewToggle value onChange /> */
export function ViewToggle({ value, onChange }) {
  const btn = (id, icon, label) => (
    <button type="button" aria-label={label} aria-pressed={value === id} onClick={() => onChange(id)}
      className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4', value === id ? 'bg-surface text-content shadow-card' : 'text-content-muted hover:text-content')}>{icon}</button>
  );
  return <div role="group" aria-label="Layout" className="inline-flex gap-1 rounded-xl bg-surface-sunken p-1">{btn('list', <List />, 'List view')}{btn('grid', <LayoutGrid />, 'Grid view')}</div>;
}

/** Sort + type filter + view toggle row. Any of sort/type/view may be omitted. */
export function DriveToolbar({ sort, onSortChange, type, onTypeChange, view, onViewChange, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
        {onTypeChange && <div className="min-w-0 flex-1 sm:w-40 sm:flex-none"><Select aria-label="Filter by type" value={type} onChange={(e) => onTypeChange(e.target.value)} options={TYPE_OPTIONS} className="h-9" /></div>}
        {onSortChange && <div className="min-w-0 flex-1 sm:w-48 sm:flex-none"><Select aria-label="Sort by" value={sort} onChange={(e) => onSortChange(e.target.value)} options={SORT_OPTIONS} className="h-9" /></div>}
        {onViewChange && <div className="shrink-0"><ViewToggle value={view} onChange={onViewChange} /></div>}
      </div>
    </div>
  );
}

/** Appears while items are selected. <SelectionBar items act onClear /> */
export function SelectionBar({ items, act, onClear }) {
  const { user } = useAuth();
  if (!items.length) return null;
  const files = items.filter((i) => i.kind === 'file');
  const canDownload = files.length > 0 && files.every((f) => caps(f).download);
  const canMove = items.every((i) => caps(i).update && isOwner(i, user));
  const canDelete = items.every((i) => caps(i).delete);
  const allStarred = items.every((i) => i.starred);
  return (
    // Sits just below the sticky 4rem topbar while scrolling. Labels collapse to icons on phones.
    <div role="toolbar" aria-label="Selection actions" className="sticky top-[4.5rem] z-20 mb-4 flex items-center gap-1.5 rounded-2xl border border-brand/30 bg-surface px-2 py-2 shadow-pop animate-pop-in sm:gap-2 sm:px-3">
      <Button icon variant="ghost" size="sm" aria-label="Clear selection" onClick={onClear}><X className="h-4 w-4" /></Button>
      <span className="mr-auto whitespace-nowrap text-sm font-semibold tabular">{items.length} selected</span>
      {canDownload && <Button size="sm" variant="secondary" leftIcon={<Download />} aria-label="Download" onClick={() => act('download', items)}><span className="hidden sm:inline">Download</span></Button>}
      <Button size="sm" variant="secondary" leftIcon={<Star />} aria-label={allStarred ? 'Unstar' : 'Star'} onClick={() => act('star', items)}><span className="hidden sm:inline">{allStarred ? 'Unstar' : 'Star'}</span></Button>
      {canMove && <Button size="sm" variant="secondary" leftIcon={<FolderInput />} aria-label="Move" onClick={() => act('move', items)}><span className="hidden sm:inline">Move</span></Button>}
      {canDelete && <Button size="sm" variant="danger-ghost" leftIcon={<Trash2 />} aria-label="Move to trash" onClick={() => act('delete', items)}><span className="hidden sm:inline">Trash</span></Button>}
    </div>
  );
}
