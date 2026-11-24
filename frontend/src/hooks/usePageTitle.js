import { useEffect } from 'react';

/** Sets document.title to "<title> · CloudVault" while the page is mounted. */
export function usePageTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · CloudVault` : 'CloudVault';
    return () => { document.title = previous; };
  }, [title]);
}
