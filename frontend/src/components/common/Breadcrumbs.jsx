import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn.js';

/** <Breadcrumbs items={[{label:'Files', to:'/files'}, {label:'Reports'}]} />  last item is the current page. */
export default function Breadcrumbs({ items, className }) {
  if (!items?.length) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${it.to ?? it.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-content-faint" />}
              {it.to && !last
                ? <Link to={it.to} onClick={it.onClick} className="truncate rounded-md px-1 py-0.5 text-content-muted hover:bg-surface-sunken hover:text-content">{it.label}</Link>
                : <span aria-current={last ? 'page' : undefined} className={cn('truncate px-1 py-0.5', last ? 'font-semibold' : 'text-content-muted')}>{it.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
