import { Component } from 'react';
import { TriangleAlert } from 'lucide-react';
import EmptyState from '../ui/EmptyState.jsx';
import Button from '../ui/Button.jsx';

/** Catches render errors (and failed lazy chunk loads) so one broken page does not blank the app. Resets when `resetKey` changes. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info?.componentStack); }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunk = /Loading chunk|dynamically imported module|Failed to fetch dynamically/i.test(String(this.state.error?.message));
    return (
      <EmptyState icon={<TriangleAlert />} title={chunk ? 'A new version is available' : 'Something went wrong'}
        description={chunk ? 'Reload the page to get the latest version.' : 'This page hit an unexpected error. Reloading usually fixes it.'}
        action={<Button onClick={() => window.location.reload()}>Reload</Button>} />
    );
  }
}
