import { TriangleAlert } from 'lucide-react';
import EmptyState from '../ui/EmptyState.jsx';
import Button from '../ui/Button.jsx';
import { getErrorMessage } from '../../utils/errors.js';

/** <ErrorState error={err} onRetry={refetch} /> for failed page loads. */
export default function ErrorState({ error, onRetry, title = 'Could not load this page' }) {
  return (
    <EmptyState icon={<TriangleAlert />} title={title} description={getErrorMessage(error)}
      action={onRetry && <Button variant="secondary" onClick={() => onRetry()}>Try again</Button>} />
  );
}
