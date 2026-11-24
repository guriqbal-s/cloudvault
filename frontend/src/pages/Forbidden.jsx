import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState.jsx';
import Button from '../components/ui/Button.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

export default function Forbidden() {
  usePageTitle('No access');
  return <EmptyState icon={<ShieldAlert />} title="You do not have access to this page"
    description="Your role does not include this area. If you think that is a mistake, ask an administrator."
    action={<Button as={Link} to="/">Back to dashboard</Button>} />;
}
