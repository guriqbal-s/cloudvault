// Permission catalogue and default role matrix.
// The backend authorisation middleware (Phase 4) reads these from the database, so this
// file is only the source of truth for seeding. Resource-level access (owner / shared
// viewer / shared editor) is a separate layer handled by the access service.

export const PERMISSIONS = [
  // Users
  { key: 'user:read', group: 'Users', description: 'View the user directory' },
  { key: 'user:manage', group: 'Users', description: 'Edit user accounts' },
  { key: 'user:assign-role', group: 'Users', description: 'Assign roles to users ranked below you' },
  { key: 'user:suspend', group: 'Users', description: 'Suspend and reactivate users' },
  { key: 'user:quota', group: 'Users', description: 'Change user storage quotas' },

  // Files
  { key: 'file:read', group: 'Files', description: 'View files and file details' },
  { key: 'file:upload', group: 'Files', description: 'Upload files' },
  { key: 'file:download', group: 'Files', description: 'Download files' },
  { key: 'file:update', group: 'Files', description: 'Rename, move and copy files' },
  { key: 'file:delete', group: 'Files', description: 'Delete and restore files' },
  { key: 'file:share', group: 'Files', description: 'Share files with users or via links' },

  // Folders
  { key: 'folder:read', group: 'Folders', description: 'View folders' },
  { key: 'folder:create', group: 'Folders', description: 'Create folders' },
  { key: 'folder:update', group: 'Folders', description: 'Rename, move and copy folders' },
  { key: 'folder:delete', group: 'Folders', description: 'Delete and restore folders' },
  { key: 'folder:share', group: 'Folders', description: 'Share folders with users or via links' },

  // Versions
  { key: 'version:read', group: 'Versions', description: 'View and download version history' },
  { key: 'version:create', group: 'Versions', description: 'Upload new versions of a file' },
  { key: 'version:restore', group: 'Versions', description: 'Restore older versions' },
  { key: 'version:delete', group: 'Versions', description: 'Delete versions' },

  // Activity
  { key: 'activity:read-own', group: 'Activity', description: 'View your own activity' },
  { key: 'activity:read-team', group: 'Activity', description: 'View activity on resources you manage or that are shared with you' },
  { key: 'activity:read-all', group: 'Activity', description: 'View all activity logs' },

  // Administration
  { key: 'admin:access', group: 'Administration', description: 'Open the admin panel' },
  { key: 'admin:analytics', group: 'Administration', description: 'View application analytics' },
  { key: 'admin:monitor-sharing', group: 'Administration', description: 'Monitor sharing across all users' },
  { key: 'admin:manage-admins', group: 'Administration', description: 'Create, change or suspend Admin and Super Admin accounts' },
];

const ALL = PERMISSIONS.map((p) => p.key);

const STANDARD_USER = [
  'file:read', 'file:upload', 'file:download', 'file:update', 'file:delete', 'file:share',
  'folder:read', 'folder:create', 'folder:update', 'folder:delete', 'folder:share',
  'version:read', 'version:create', 'version:restore', 'version:delete',
  'activity:read-own',
];

export const ROLES = [
  {
    name: 'Super Admin',
    rank: 100,
    description: 'Full platform control, including management of other administrators.',
    permissions: ALL,
  },
  {
    name: 'Admin',
    rank: 80,
    description: 'Manages users, quotas and monitoring. Cannot manage other administrators.',
    permissions: ALL.filter((k) => k !== 'admin:manage-admins'),
  },
  {
    name: 'Manager',
    rank: 60,
    description: 'Full file and folder management plus visibility into team activity.',
    permissions: [...STANDARD_USER, 'user:read', 'activity:read-team'],
  },
  {
    name: 'Standard User',
    rank: 40,
    description: 'Manages their own files and folders and can share them.',
    permissions: STANDARD_USER,
  },
  {
    name: 'Viewer',
    rank: 20,
    description: 'Read-only: can view and download, cannot upload, create or share.',
    permissions: ['file:read', 'file:download', 'folder:read', 'version:read', 'activity:read-own'],
  },
];
