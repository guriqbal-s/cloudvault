import { HardDrive, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import Card, { CardHeader } from '../ui/Card.jsx';
import ProgressBar from '../ui/ProgressBar.jsx';
import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import ErrorState from '../common/ErrorState.jsx';
import { CategoryDonut } from '../dashboard/charts.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { formatBytes, formatPercent } from '../../utils/format.js';
import * as storageApi from '../../api/storage.js';

export default function StorageTab() {
  const { data, loading, error, refetch } = useQuery(({ signal }) => storageApi.get({ signal }), []);
  if (error && !data) return <ErrorState error={error} onRetry={refetch} />;
  if (loading && !data) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Usage" description="Includes older versions and items in the trash until they are deleted forever." />
        <p className="font-display text-3xl font-semibold tabular">{formatBytes(data.used)} <span className="text-base font-medium text-content-muted">of {formatBytes(data.quota)}</span></p>
        <ProgressBar className="mt-3" value={data.used} max={data.quota} tone="auto" label="Storage used" />
        <p className="mt-2 text-sm text-content-muted">{formatPercent(data.percent)} used · {formatBytes(Math.max(0, data.quota - data.used))} free</p>
        {data.trashBytes > 0 && (
          <div className="mt-5 flex items-center gap-3 rounded-xl bg-surface-sunken p-3 text-sm">
            <Trash2 className="h-4 w-4 shrink-0 text-content-muted" />
            <span className="min-w-0 flex-1">{formatBytes(data.trashBytes)} is in your trash.</span>
            <Button as={Link} to="/trash" size="sm" variant="secondary">Open trash</Button>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="By file type" />
        {data.breakdown?.length ? <CategoryDonut data={data.breakdown} /> : <EmptyState compact icon={<HardDrive />} title="Nothing stored yet" />}
      </Card>
    </div>
  );
}
