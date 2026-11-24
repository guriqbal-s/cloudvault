import { useState } from 'react';
import { Search, X } from 'lucide-react';
import ActivityFeed from '../../components/account/ActivityFeed.jsx';
import Select from '../../components/ui/Select.jsx';
import Input from '../../components/ui/Input.jsx';
import Button from '../../components/ui/Button.jsx';
import { ACTIVITY_ACTIONS, getActivityMeta } from '../../utils/activityMeta.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useQuery } from '../../hooks/useQuery.js';
import * as adminApi from '../../api/admin.js';

const OPTIONS = ACTIVITY_ACTIONS.map((a) => ({ value: a, label: getActivityMeta(a).label }));
const iso = (d, end) => (d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined);

export default function AdminActivity() {
  const [f, setF] = useState({ q: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounce(f.q.trim(), 300);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setPage(1); };
  const active = Object.values(f).some(Boolean);
  const query = useQuery(({ signal }) => adminApi.listActivity({ q: dq || undefined, action: f.action || undefined, from: iso(f.from), to: iso(f.to, true), page, limit: 25 }, { signal }), [dq, f.action, f.from, f.to, page]);

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_auto_auto_auto] lg:items-end">
        <Input label="Search" leftIcon={<Search />} placeholder="Description or file name" value={f.q} onChange={set('q')} />
        <Select label="Action" value={f.action} onChange={set('action')} placeholder="All actions" options={OPTIONS} />
        <Input label="From" type="date" value={f.from} max={f.to || undefined} onChange={set('from')} />
        <Input label="To" type="date" value={f.to} min={f.from || undefined} onChange={set('to')} />
        <Button variant="ghost" leftIcon={<X />} disabled={!active} onClick={() => { setF({ q: '', action: '', from: '', to: '' }); setPage(1); }}>Clear</Button>
      </div>
      <ActivityFeed query={query} onPage={setPage} showUser emptyHint={active ? 'Nothing matches these filters.' : 'No activity has been recorded yet.'} />
    </>
  );
}
