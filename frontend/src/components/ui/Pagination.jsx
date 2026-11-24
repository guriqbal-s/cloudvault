import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn.js';

function windowed(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (page >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => set.add(n));
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  return nums.flatMap((n, i) => (i && n - nums[i - 1] > 1 ? ['…', n] : [n]));
}

/** <Pagination meta={{page,limit,total,totalPages}} onPageChange={(p)=>...} />  (meta straight from the API) */
export default function Pagination({ meta, onPageChange, className }) {
  if (!meta || meta.totalPages <= 1) return null;
  const { page, limit, total, totalPages } = meta;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold transition-colors';
  return (
    <nav aria-label="Pagination" className={cn('flex flex-wrap items-center justify-between gap-3 pt-4', className)}>
      <p className="text-sm text-content-muted tabular">Showing {from}–{to} of {total}</p>
      <div className="flex items-center gap-1">
        <button type="button" className={cn(btn, 'text-content-muted hover:bg-surface-sunken disabled:opacity-40')} disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        {windowed(page, totalPages).map((n, i) => n === '…'
          ? <span key={`gap${i}`} className="px-1 text-content-faint">…</span>
          : <button key={n} type="button" onClick={() => onPageChange(n)} aria-current={n === page ? 'page' : undefined}
              className={cn(btn, n === page ? 'bg-brand text-brand-contrast' : 'text-content-muted hover:bg-surface-sunken')}>{n}</button>)}
        <button type="button" className={cn(btn, 'text-content-muted hover:bg-surface-sunken disabled:opacity-40')} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  );
}
