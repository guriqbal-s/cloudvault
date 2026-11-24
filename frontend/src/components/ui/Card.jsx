import { cn } from '../../utils/cn.js';

/** <Card padding="none|sm|md|lg" as="section" className>..</Card> */
export default function Card({ as: As = 'div', padding = 'md', className, children, ...rest }) {
  const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-7' }[padding];
  return <As className={cn('rounded-2xl border border-border bg-surface shadow-card', pad, className)} {...rest}>{children}</As>;
}

/** <CardHeader title description action={<Button/>} /> */
export function CardHeader({ title, description, action, className }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
