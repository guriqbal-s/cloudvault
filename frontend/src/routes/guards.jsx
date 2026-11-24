import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { usePermissions } from '../hooks/usePermissions.js';
import Spinner from '../components/ui/Spinner.jsx';
import Forbidden from '../pages/Forbidden.jsx';

export function FullScreenSpinner() {
  return <div className="flex min-h-screen items-center justify-center bg-surface-muted"><Spinner className="h-8 w-8" /></div>;
}

/** Signed-in users only. Guests go to /login and come back to where they were headed. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Guests only (login, register, ...). Signed-in users are sent on to the app. */
export function GuestRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'authenticated') {
    const from = location.state?.from;
    return <Navigate to={from ? `${from.pathname}${from.search ?? ''}` : '/'} replace />;
  }
  return <Outlet />;
}

/**
 * Permission gate (UI only; the API enforces the real rule).
 * <Route element={<RequirePermission permission="admin:access" />}> ...  or any={[..]} / all={[..]}
 * Renders the 403 page when missing; wrap children instead of <Outlet/> by passing `children`.
 */
export function RequirePermission({ permission, any, all, children }) {
  const { has, hasAny, hasAll } = usePermissions();
  const ok = (permission ? has(permission) : true) && (any ? hasAny(...any) : true) && (all ? hasAll(...all) : true);
  if (!ok) return <Forbidden />;
  return children ?? <Outlet />;
}
