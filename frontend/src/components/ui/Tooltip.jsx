import { cn } from '../../utils/cn.js';

/** CSS-only tooltip (hover and keyboard focus): <Tooltip content="Download" side="top|bottom"><Button icon/></Tooltip> */
export default function Tooltip({ content, side = 'top', children, className }) {
  if (!content) return children;
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span role="tooltip" className={cn(
        'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-content px-2 py-1 text-xs font-medium text-surface opacity-0 shadow-pop transition-opacity delay-300 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
        side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5')}>
        {content}
      </span>
    </span>
  );
}
