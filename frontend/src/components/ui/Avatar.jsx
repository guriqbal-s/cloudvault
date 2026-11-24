import { useEffect, useState } from 'react';
import { cn } from '../../utils/cn.js';
import { initials } from '../../utils/format.js';
import { fetchAvatarBlob } from '../../api/users.js';

const SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg', xl: 'h-20 w-20 text-2xl' };
const HUES = ['bg-brand-soft text-brand', 'bg-info-soft text-info', 'bg-accent-soft text-accent', 'bg-success-soft text-success', 'bg-warning-soft text-warning', 'bg-danger-soft text-danger'];

// userId+version -> object URL (or a pending promise). Avatars need the Bearer header, so <img src> cannot be used directly.
const cache = new Map();
export function invalidateAvatar(userId) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${userId}:`)) { const v = cache.get(key); if (typeof v === 'string') URL.revokeObjectURL(v); cache.delete(key); }
}

function useAvatarSrc(userId, enabled, version) {
  const key = `${userId}:${version ?? 0}`;
  const [src, setSrc] = useState(() => (enabled && typeof cache.get(key) === 'string' ? cache.get(key) : null));
  useEffect(() => {
    if (!enabled || !userId) { setSrc(null); return undefined; }
    let alive = true;
    const hit = cache.get(key);
    if (typeof hit === 'string') { setSrc(hit); return undefined; }
    const pending = hit ?? fetchAvatarBlob(userId).then((blob) => { const url = URL.createObjectURL(blob); cache.set(key, url); return url; }).catch(() => { cache.delete(key); return null; });
    cache.set(key, pending);
    pending.then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [key, enabled, userId]);
  return src;
}

/** <Avatar user={{id,name,hasAvatar}} size="xs|sm|md|lg|xl" version={n} />  (version busts the cache after upload) */
export default function Avatar({ user, size = 'md', version, className }) {
  const src = useAvatarSrc(user?.id, Boolean(user?.hasAvatar), version);
  const hue = HUES[[...(user?.id ?? user?.name ?? '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  return (
    <span className={cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold', SIZES[size], !src && hue, className)} title={user?.name}>
      {src ? <img src={src} alt={user?.name ?? ''} className="h-full w-full object-cover" /> : initials(user?.name)}
    </span>
  );
}
