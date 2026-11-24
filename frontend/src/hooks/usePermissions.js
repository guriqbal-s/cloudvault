import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * const { has, hasAny, hasAll, isAdmin, roles } = usePermissions();
 * has('file:upload'); hasAny('file:share','folder:share'); hasAll('user:read','user:manage')
 * Permission keys are listed in prisma/seed/permissions.js. UI gating only: the API enforces them.
 */
export function usePermissions() {
  const { user } = useAuth();
  return useMemo(() => {
    const set = new Set(user?.permissions ?? []);
    const roles = user?.roles ?? [];
    return {
      permissions: set,
      roles,
      has: (key) => set.has(key),
      hasAny: (...keys) => keys.flat().some((k) => set.has(k)),
      hasAll: (...keys) => keys.flat().every((k) => set.has(k)),
      isAdmin: set.has('admin:access'),
    };
  }, [user]);
}
