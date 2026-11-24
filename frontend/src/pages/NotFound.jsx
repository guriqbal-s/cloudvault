import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState.jsx';
import Button from '../components/ui/Button.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

export default function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState icon={<Compass />} title="Page not found" description="The page you are looking for does not exist or has moved."
        action={<Button as={Link} to="/">Go home</Button>} />
    </div>
  );
}
