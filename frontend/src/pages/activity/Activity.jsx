import { useState } from 'react';
import { Activity as ActivityIcon, X } from 'lucide-react';
import PageHeader from '../../components/common/PageHeader.jsx';
import ActivityFeed from '../../components/account/ActivityFeed.jsx';
import Select from '../../components/ui/Select.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { ACTIVITY_ACTIONS, getActivityMeta } from '../../utils/activityMeta.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import * as activityApi from '../../api/activity.js';

const OPTIONS = ACTIVITY_ACTIONS.map((a) => ({ value: a, label: getActivityMeta(a).label }));
// `to` is inclusive: send the end of that day so activity from the chosen day is not cut off.
const endOfDay = (d) => (d ? `${d}T23:59:59.999` : undefined);
const startOfDay = (d) => (d ? `${d}T00:00:00` : undefined);
const toIso = (s) => (s ? new Date(s).toISOString() : undefined);

export default function Activity() {
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const active = Object.values(filters).some(Boolean);
  const query = useQuery(({ signal }) => activityApi.list({
    action: filters.action || undefined, from: toIso(startOfDay(filters.from)), to: toIso(endOfDay(filters.to)), page, limit: 20,
  }, { signal }), [filters.action, filters.from, filters.to, page], { keepPrevious: true });

  return (
    <>
      <PageHeader title="Activity" icon={<ActivityIcon />} description="Everything that happened in your account." />
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <Select label="Action" value={filters.action} onChange={set('action')} placeholder="All actions" options={OPTIONS} />
        <Input label="From" type="date" value={filters.from} max={filters.to || undefined} onChange={set('from')} />
        <Input label="To" type="date" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
        <Button variant="ghost" leftIcon={<X />} disabled={!active} onClick={() => { setFilters({ action: '', from: '', to: '' }); setPage(1); }}>Clear</Button>
      </div>
      <ActivityFeed query={query} onPage={setPage} emptyHint={active ? 'Nothing matches these filters.' : 'Your actions will appear here.'} />
    </>
  );
}
