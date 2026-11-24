import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as authApi from '../api/auth.js';
import { clearAccessToken, refreshSession, setAccessToken, setSessionEndedHandler, setTokenRefreshedHandler } from '../api/client.js';
import { on, STORAGE_CHANGED } from '../utils/events.js';
import { getErrorCode } from '../utils/errors.js';
import { useTheme } from './ThemeContext.jsx';

const AuthContext = createContext(null);

/**
 * status: 'loading' (restoring the session on page load) | 'authenticated' | 'guest'
 * user: the /auth/me shape (id, email, name, roles[], permissions[], storageUsedBytes, storageQuotaBytes, themePref, ...)
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, notice: null });
  const { setPreference } = useTheme();
  const themeRef = useRef(setPreference);
  themeRef.current = setPreference;

  const adopt = useCallback((user) => {
    setState({ status: 'authenticated', user, notice: null });
    if (user?.themePref) themeRef.current(user.themePref); // the account's saved theme wins on every device
  }, []);

  const clear = useCallback((notice = null) => {
    clearAccessToken();
    setState({ status: 'guest', user: null, notice });
  }, []);

  // Wire the HTTP client: session ended elsewhere (revoked, refresh failed) -> guest; silent refresh -> fresh user.
  useEffect(() => {
    setSessionEndedHandler(() => clear('Your session has ended. Please sign in again.'));
    setTokenRefreshedHandler((session) => {
      setState((s) => (s.status === 'authenticated' && session?.user ? { ...s, user: session.user } : s));
    });
    return () => { setSessionEndedHandler(null); setTokenRefreshedHandler(null); };
  }, [clear]);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => { if (!cancelled) adopt(session.user); })
      .catch((err) => {
        if (cancelled) return;
        // No cookie / expired cookie is the normal "not signed in" path: no notice, just show the login page.
        if (getErrorCode(err) === 'NETWORK_ERROR') setState({ status: 'guest', user: null, notice: 'Cannot reach the server.' });
        else clear();
      });
    return () => { cancelled = true; };
  }, [adopt, clear]);

  const login = useCallback(async (email, password) => {
    const { user, accessToken } = await authApi.login({ email, password });
    setAccessToken(accessToken);
    adopt(user);
    return user;
  }, [adopt]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* the cookie may already be gone; signing out locally is what matters */ }
    clear();
  }, [clear]);

  const reloadUser = useCallback(async () => {
    try {
      const user = await authApi.me();
      setState((s) => (s.status === 'authenticated' ? { ...s, user } : s));
      return user;
    } catch { return null; }
  }, []);

  const updateUser = useCallback((patch) => {
    setState((s) => (s.user ? { ...s, user: { ...s.user, ...patch } } : s));
  }, []);

  // Keep the sidebar storage meter fresh after uploads/deletes (debounced).
  useEffect(() => {
    let t;
    const off = on(STORAGE_CHANGED, () => { clearTimeout(t); t = setTimeout(reloadUser, 600); });
    return () => { off(); clearTimeout(t); };
  }, [reloadUser]);

  const value = useMemo(() => ({
    ...state,
    isAuthenticated: state.status === 'authenticated',
    login, logout, reloadUser, updateUser, clearNotice: () => setState((s) => ({ ...s, notice: null })),
  }), [state, login, logout, reloadUser, updateUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
