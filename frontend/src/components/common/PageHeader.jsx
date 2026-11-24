import { usePageTitle } from '../../hooks/usePageTitle.js';
import Breadcrumbs from './Breadcrumbs.jsx';

/** Page title block. Also sets document.title. <PageHeader title description breadcrumbs actions={<Button/>} /> */
export default function PageHeader({ title, description, breadcrumbs, actions, icon }) {
  usePageTitle(typeof title === 'string' ? title : undefined);
  return (
    <header className="mb-6">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-2" />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand [&>svg]:h-5 [&>svg]:w-5">{icon}</span>}
          <div className="min-w-0">
            <h1 className="truncate font-display text-2xl font-semibold sm:text-[1.75rem]">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-content-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
