import { Check, Minus } from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import Card from '../../components/ui/Card.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { formatNumber } from '../../utils/format.js';
import * as adminApi from '../../api/admin.js';

const GROUPS = { file: 'Files', folder: 'Folders', share: 'Sharing', version: 'Versions', trash: 'Trash', user: 'Users', activity: 'Activity', admin: 'Administration', storage: 'Storage', notification: 'Notifications' };
const groupOf = (key) => GROUPS[key.split(':')[0]] ?? key.split(':')[0];

export default function Roles() {
  const { data: roles, loading, error, refetch } = useQuery(({ signal }) => adminApi.listRoles({ signal }), []);
  if (error && !roles) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !roles) return <SkeletonRows rows={8} />;

  const sets = new Map(roles.map((r) => [r.id, new Set(r.permissions)]));
  const keys = [...new Set(roles.flatMap((r) => r.permissions))].sort();
  const grouped = keys.reduce((acc, k) => { (acc[groupOf(k)] ??= []).push(k); return acc; }, {});

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {roles.map((r) => (
          <Card key={r.id} padding="sm">
            <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-semibold">{r.name}</h3><Badge tone="neutral">Rank {r.rank}</Badge></div>
            <p className="mt-1 line-clamp-2 min-h-[2rem] text-xs text-content-muted">{r.description}</p>
            <p className="mt-2 text-xs text-content-faint tabular">{formatNumber(r.userCount)} {r.userCount === 1 ? 'user' : 'users'} · {r.permissions.length} permissions</p>
          </Card>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-card">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Permissions granted to each role</caption>
          <thead className="sticky top-0 border-b border-border bg-surface text-xs">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-semibold uppercase tracking-wide text-content-muted">Permission</th>
              {roles.map((r) => <th key={r.id} scope="col" className="px-3 py-3 text-center font-semibold">{r.name}</th>)}
            </tr>
          </thead>
          {Object.entries(grouped).map(([group, list]) => (
            <tbody key={group} className="divide-y divide-border border-t border-border">
              <tr className="bg-surface-sunken"><th colSpan={roles.length + 1} scope="colgroup" className="sticky left-0 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-content-muted">{group}</th></tr>
              {list.map((k) => (
                <tr key={k}>
                  <th scope="row" className="sticky left-0 bg-surface px-4 py-2 text-left font-mono text-xs font-normal">{k}</th>
                  {roles.map((r) => (
                    <td key={r.id} className="px-3 py-2 text-center">
                      {sets.get(r.id).has(k) ? <Check className="mx-auto h-4 w-4 text-success" aria-label="Granted" /> : <Minus className="mx-auto h-4 w-4 text-content-faint" aria-label="Not granted" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
