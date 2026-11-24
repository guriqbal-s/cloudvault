import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';

/** Topbar search: Enter goes to /search?q=…; "/" focuses it; stays in sync with the URL on /search. */
export default function GlobalSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const urlQ = pathname === '/search' ? params.get('q') ?? '' : '';
  const [value, setValue] = useState(urlQ);
  const input = useRef(null);

  useEffect(() => setValue(urlQ), [urlQ]);
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.target?.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const q = value.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-xl">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" />
      <input ref={input} type="search" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200}
        placeholder="Search your vault" aria-label="Search files and folders" enterKeyHint="search"
        className="h-10 w-full rounded-xl border border-transparent bg-surface-sunken pl-10 pr-10 text-base sm:text-sm placeholder:text-content-faint focus:border-brand focus:bg-surface focus:shadow-ring [&::-webkit-search-cancel-button]:hidden" />
      {value ? (
        <button type="button" onClick={() => { setValue(''); input.current?.focus(); }} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-content-faint hover:text-content"><X className="h-4 w-4" /></button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface px-1.5 text-[11px] text-content-faint sm:block">/</kbd>
      )}
    </form>
  );
}
