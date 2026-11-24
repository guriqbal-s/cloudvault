import {
  LogIn, LogOut, UserPlus, Upload, Download, Trash2, RotateCcw, Pencil, FolderInput, Copy, FolderPlus, Share2, Link2, Link2Off,
  History, UserCog, KeyRound, Star, ShieldCheck, Activity as ActivityIcon, Eye, HardDrive,
} from 'lucide-react';

// Mirror of backend/src/constants/activityActions.js. Unknown actions fall back to a neutral icon.
const T = {
  brand: 'text-brand bg-brand-soft', info: 'text-info bg-info-soft', success: 'text-success bg-success-soft',
  warning: 'text-warning bg-warning-soft', danger: 'text-danger bg-danger-soft', muted: 'text-content-muted bg-surface-sunken',
};

const META = {
  LOGIN: [LogIn, T.muted, 'Signed in'], LOGOUT: [LogOut, T.muted, 'Signed out'], REGISTER: [UserPlus, T.success, 'Registered'],
  FILE_UPLOAD: [Upload, T.success, 'File uploaded'], FILE_DOWNLOAD: [Download, T.info, 'File downloaded'],
  FILE_DELETE: [Trash2, T.danger, 'File deleted'], FILE_RESTORE: [RotateCcw, T.success, 'File restored'],
  FILE_PERMANENT_DELETE: [Trash2, T.danger, 'File deleted forever'], FILE_RENAME: [Pencil, T.info, 'File renamed'],
  FILE_MOVE: [FolderInput, T.info, 'File moved'], FILE_COPY: [Copy, T.info, 'File copied'],
  FOLDER_CREATE: [FolderPlus, T.success, 'Folder created'], FOLDER_RENAME: [Pencil, T.info, 'Folder renamed'],
  FOLDER_MOVE: [FolderInput, T.info, 'Folder moved'], FOLDER_COPY: [Copy, T.info, 'Folder copied'],
  FOLDER_DELETE: [Trash2, T.danger, 'Folder deleted'], FOLDER_RESTORE: [RotateCcw, T.success, 'Folder restored'],
  FOLDER_PERMANENT_DELETE: [Trash2, T.danger, 'Folder deleted forever'],
  SHARE_CREATE: [Share2, T.brand, 'Shared'], SHARE_UPDATE: [ShieldCheck, T.warning, 'Share changed'], SHARE_REVOKE: [Share2, T.danger, 'Share revoked'],
  LINK_CREATE: [Link2, T.brand, 'Link created'], LINK_REVOKE: [Link2Off, T.danger, 'Link revoked'], LINK_ACCESS: [Eye, T.info, 'Link opened'],
  VERSION_CREATE: [History, T.success, 'New version'], VERSION_RESTORE: [History, T.info, 'Version restored'], VERSION_DELETE: [History, T.danger, 'Version deleted'],
  PROFILE_UPDATE: [UserCog, T.info, 'Profile updated'], PASSWORD_CHANGE: [KeyRound, T.warning, 'Password changed'],
  STAR: [Star, T.warning, 'Starred'], UNSTAR: [Star, T.muted, 'Unstarred'],
  ADMIN_ROLE_CHANGE: [UserCog, T.warning, 'Role changed'], ADMIN_USER_STATUS_CHANGE: [UserCog, T.warning, 'Account status changed'],
  ADMIN_QUOTA_CHANGE: [HardDrive, T.warning, 'Quota changed'],
};

export const ACTIVITY_ACTIONS = Object.keys(META);

export function getActivityMeta(action) {
  const [Icon, tone, label] = META[action] ?? [ActivityIcon, T.muted, String(action ?? 'Activity').replace(/_/g, ' ').toLowerCase()];
  return { Icon, tone, label };
}
