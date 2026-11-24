import { usePageTitle } from '../../hooks/usePageTitle.js';

/** Heading block + body for the auth pages. <AuthCard title subtitle icon footer>form</AuthCard> */
export default function AuthCard({ title, subtitle, icon, footer, children }) {
  usePageTitle(title);
  return (
    <div className="animate-pop-in">
      {icon && <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand [&>svg]:h-6 [&>svg]:w-6">{icon}</div>}
      <h1 className="font-display text-[1.9rem] font-semibold leading-tight">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-content-muted">{subtitle}</p>}
      <div className="mt-7">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-content-muted">{footer}</div>}
    </div>
  );
}

/** Inline alert box for form-level messages. tone: danger | success | warning | info */
export function Alert({ tone = 'danger', children, action }) {
  const tones = { danger: 'bg-danger-soft text-danger', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', info: 'bg-info-soft text-info' };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm font-medium ${tones[tone]}`}>
      <div>{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
