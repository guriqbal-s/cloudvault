import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'cv-theme';
const ThemeContext = createContext(null);

const read = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
};
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

function apply(resolved) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/** preference: 'light' | 'dark' | 'system'. resolved: what is actually shown. */
export function ThemeProvider({ children }) {
  const [preference, setPref] = useState(read);
  const [prefersDark, setPrefersDark] = useState(systemDark);
  const resolved = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = (e) => setPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => apply(resolved), [resolved]);

  const setPreference = useCallback((next) => {
    const value = next === 'light' || next === 'dark' ? next : 'system';
    setPref(value);
    try { localStorage.setItem(KEY, value); } catch { /* storage unavailable: preference lasts for this tab */ }
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
