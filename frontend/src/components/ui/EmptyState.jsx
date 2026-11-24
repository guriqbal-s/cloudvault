import { cn } from '../../utils/cn.js';

/** <EmptyState icon={<Inbox/>} title description action={<Button/>} compact /> */
export default function EmptyState({ icon, title, description, action, compact, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-16', className)}>
      {icon && <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand [&>svg]:h-7 [&>svg]:w-7">{icon}</div>}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-content-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
