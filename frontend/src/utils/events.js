// Tiny pub/sub so far-apart components can react to the same thing without prop drilling.
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`[events] listener for "${event}" failed`, err); }
  });
}

export const STORAGE_CHANGED = 'storage:changed';

/** Call after anything that changes the user's storage use (upload, delete, purge, restore). */
export const notifyStorageChanged = () => emit(STORAGE_CHANGED);
