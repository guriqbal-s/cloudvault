import { cn } from '../../utils/cn.js';

export function LogoMark({ className }) {
  return (
    <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-contrast', className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round">
        <path d="M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.5a3.8 3.8 0 0 1 .5 7.5H7z" />
        <rect x="10" y="11.5" width="5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export default function Logo({ className, textClassName }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('font-display text-lg font-bold tracking-tight', textClassName)}>CloudVault</span>
    </span>
  );
}
