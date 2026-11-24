import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import * as notificationsApi from '../api/notifications.js';
import { getAccessToken, refreshSession } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

const NotificationContext = createContext(null);
const PAGE = 20;

/**
 * Holds the latest notifications + unread count and listens for `notification:new` over Socket.IO.
 * The socket authenticates with the in-memory access token (re-read on every reconnect attempt).
 * If the server rejects an expired token we refresh once and reconnect with backoff.
 */
export function NotificationProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const userId = user?.id;

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const { data, meta } = await notificationsApi.list({ limit: PAGE });
      setItems(data);
      setUnreadCount(meta?.unreadCount ?? data.filter((n) => !n.readAt).length);
    } catch { /* the bell simply stays empty; the notifications page shows errors */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) { setItems([]); setUnreadCount(0); setConnected(false); return undefined; }
    reload();

    let stopped = false;
    let retry = 0;
    let retryTimer;
    const socket = io(import.meta.env.VITE_SOCKET_URL || undefined, {
      path: '/socket.io',
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelayMax: 15_000,
    });

    socket.on('connect', () => { retry = 0; setConnected(true); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => {
      setConnected(false);
      // socket.io only retries by itself for transport errors; an auth rejection needs a manual reconnect.
      if (socket.active || stopped) return;
      const delay = Math.min(1000 * 2 ** retry++, 30_000);
      retryTimer = setTimeout(async () => {
        try { await refreshSession(); } catch { return; } // session over: AuthContext will unmount us
        if (!stopped) socket.connect();
      }, delay);
    });
    socket.on('notification:new', ({ notification, unreadCount: count }) => {
      setItems((list) => [notification, ...list.filter((n) => n.id !== notification.id)].slice(0, PAGE));
      setUnreadCount((c) => (typeof count === 'number' ? count : c + 1));
      toastRef.current.info(notification.body, { title: notification.title });
    });

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [isAuthenticated, userId, reload]);

  const markRead = useCallback(async (id) => {
    let was = false;
    setItems((list) => list.map((n) => (n.id === id && !n.readAt ? ((was = true), { ...n, readAt: new Date().toISOString() }) : n)));
    if (was) setUnreadCount((c) => Math.max(0, c - 1));
    try { await notificationsApi.markRead(id); } catch { reload(); }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    try { await notificationsApi.markAllRead(); } catch { reload(); }
  }, [reload]);

  const remove = useCallback(async (id) => {
    setItems((list) => {
      const target = list.find((n) => n.id === id);
      if (target && !target.readAt) setUnreadCount((c) => Math.max(0, c - 1));
      return list.filter((n) => n.id !== id);
    });
    try { await notificationsApi.remove(id); } catch { reload(); }
  }, [reload]);

  const value = useMemo(
    () => ({ items, unreadCount, loading, connected, reload, markRead, markAllRead, remove }),
    [items, unreadCount, loading, connected, reload, markRead, markAllRead, remove]
  );
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

/** { items, unreadCount, loading, connected, reload, markRead(id), markAllRead(), remove(id) } */
export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
}
