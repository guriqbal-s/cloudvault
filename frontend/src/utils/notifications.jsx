import { Share2, FolderInput, RefreshCw, ShieldCheck, ShieldOff, CheckCircle2, TriangleAlert, HardDrive, Info } from 'lucide-react';

const META = {
  FILE_SHARED: { Icon: Share2, tone: 'text-brand bg-brand-soft', to: '/shared' },
  FOLDER_SHARED: { Icon: FolderInput, tone: 'text-brand bg-brand-soft', to: '/shared' },
  SHARED_FILE_UPDATED: { Icon: RefreshCw, tone: 'text-info bg-info-soft', to: '/shared' },
  PERMISSION_CHANGED: { Icon: ShieldCheck, tone: 'text-warning bg-warning-soft', to: '/shared' },
  ACCESS_REVOKED: { Icon: ShieldOff, tone: 'text-danger bg-danger-soft', to: '/shared' },
  UPLOAD_COMPLETED: { Icon: CheckCircle2, tone: 'text-success bg-success-soft', to: '/files' },
  UPLOAD_FAILED: { Icon: TriangleAlert, tone: 'text-danger bg-danger-soft', to: '/files' },
  STORAGE_WARNING: { Icon: HardDrive, tone: 'text-warning bg-warning-soft', to: '/settings' },
  SYSTEM: { Icon: Info, tone: 'text-content-muted bg-surface-sunken', to: '/notifications' },
};

export const getNotificationMeta = (type) => META[type] ?? META.SYSTEM;

/** Where clicking a notification should go. Prefers an explicit data.href when present. */
export function notificationLink(n) {
  if (typeof n?.data?.href === 'string' && n.data.href.startsWith('/')) return n.data.href;
  return getNotificationMeta(n?.type).to;
}
