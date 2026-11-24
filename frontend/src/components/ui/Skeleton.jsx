import { cn } from '../../utils/cn.js';

/** Shimmering placeholder: <Skeleton className="h-4 w-40" />. Use SkeletonRows for lists. */
export default function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 6, className }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-1/2" /><Skeleton className="h-3 w-1/4" /></div>
        </div>
      ))}
    </div>
  );
}
