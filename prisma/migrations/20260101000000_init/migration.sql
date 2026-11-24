-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "ShareRole" AS ENUM ('VIEWER', 'EDITOR');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('FILE', 'FOLDER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FILE_SHARED', 'FOLDER_SHARED', 'SHARED_FILE_UPDATED', 'PERMISSION_CHANGED', 'ACCESS_REVOKED', 'UPLOAD_COMPLETED', 'UPLOAD_FAILED', 'STORAGE_WARNING', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('LOGIN', 'LOGOUT', 'REGISTER', 'FILE_UPLOAD', 'FILE_DOWNLOAD', 'FILE_DELETE', 'FILE_RESTORE', 'FILE_PERMANENT_DELETE', 'FILE_RENAME', 'FILE_MOVE', 'FILE_COPY', 'FOLDER_CREATE', 'FOLDER_RENAME', 'FOLDER_MOVE', 'FOLDER_COPY', 'FOLDER_DELETE', 'FOLDER_RESTORE', 'FOLDER_PERMANENT_DELETE', 'SHARE_CREATE', 'SHARE_UPDATE', 'SHARE_REVOKE', 'LINK_CREATE', 'LINK_REVOKE', 'LINK_ACCESS', 'VERSION_CREATE', 'VERSION_RESTORE', 'VERSION_DELETE', 'PROFILE_UPDATE', 'PASSWORD_CHANGE', 'STAR', 'UNSTAR', 'ADMIN_ROLE_CHANGE', 'ADMIN_USER_STATUS_CHANGE', 'ADMIN_QUOTA_CHANGE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarKey" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMP(3),
    "storageQuotaBytes" BIGINT NOT NULL DEFAULT 5368709120,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "themePref" TEXT NOT NULL DEFAULT 'system',
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "parentId" UUID,
    "path" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "trashBatchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "folderId" UUID,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "currentVersionId" UUID,
    "lastAccessedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "trashBatchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" UUID NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_shares" (
    "id" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "sharedWithId" UUID NOT NULL,
    "sharedById" UUID NOT NULL,
    "role" "ShareRole" NOT NULL DEFAULT 'VIEWER',
    "canDownload" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folder_shares" (
    "id" UUID NOT NULL,
    "folderId" UUID NOT NULL,
    "sharedWithId" UUID NOT NULL,
    "sharedById" UUID NOT NULL,
    "role" "ShareRole" NOT NULL DEFAULT 'VIEWER',
    "canDownload" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folder_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "fileId" UUID,
    "folderId" UUID,
    "createdById" UUID NOT NULL,
    "role" "ShareRole" NOT NULL DEFAULT 'VIEWER',
    "allowDownload" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "starred_resources" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "fileId" UUID,
    "folderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "starred_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" "ActivityAction" NOT NULL,
    "resourceType" "ResourceType",
    "resourceId" UUID,
    "resourceName" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_usage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "bytesUsed" BIGINT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "folderCount" INTEGER NOT NULL,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "filesUploaded" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE INDEX "user_sessions_userId_revokedAt_idx" ON "user_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_idx" ON "refresh_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "folders_ownerId_parentId_idx" ON "folders"("ownerId", "parentId");

-- CreateIndex
CREATE INDEX "folders_ownerId_deletedAt_idx" ON "folders"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "folders_trashBatchId_idx" ON "folders"("trashBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "files_currentVersionId_key" ON "files"("currentVersionId");

-- CreateIndex
CREATE INDEX "files_ownerId_deletedAt_folderId_idx" ON "files"("ownerId", "deletedAt", "folderId");

-- CreateIndex
CREATE INDEX "files_folderId_idx" ON "files"("folderId");

-- CreateIndex
CREATE INDEX "files_ownerId_createdAt_idx" ON "files"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "files_ownerId_lastAccessedAt_idx" ON "files"("ownerId", "lastAccessedAt");

-- CreateIndex
CREATE INDEX "files_extension_idx" ON "files"("extension");

-- CreateIndex
CREATE INDEX "files_trashBatchId_idx" ON "files"("trashBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_storageKey_key" ON "file_versions"("storageKey");

-- CreateIndex
CREATE INDEX "file_versions_uploadedById_idx" ON "file_versions"("uploadedById");

-- CreateIndex
CREATE INDEX "file_versions_createdAt_idx" ON "file_versions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_fileId_versionNumber_key" ON "file_versions"("fileId", "versionNumber");

-- CreateIndex
CREATE INDEX "file_shares_sharedWithId_idx" ON "file_shares"("sharedWithId");

-- CreateIndex
CREATE INDEX "file_shares_sharedById_idx" ON "file_shares"("sharedById");

-- CreateIndex
CREATE UNIQUE INDEX "file_shares_fileId_sharedWithId_key" ON "file_shares"("fileId", "sharedWithId");

-- CreateIndex
CREATE INDEX "folder_shares_sharedWithId_idx" ON "folder_shares"("sharedWithId");

-- CreateIndex
CREATE INDEX "folder_shares_sharedById_idx" ON "folder_shares"("sharedById");

-- CreateIndex
CREATE UNIQUE INDEX "folder_shares_folderId_sharedWithId_key" ON "folder_shares"("folderId", "sharedWithId");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_key" ON "share_links"("token");

-- CreateIndex
CREATE INDEX "share_links_createdById_idx" ON "share_links"("createdById");

-- CreateIndex
CREATE INDEX "share_links_fileId_idx" ON "share_links"("fileId");

-- CreateIndex
CREATE INDEX "share_links_folderId_idx" ON "share_links"("folderId");

-- CreateIndex
CREATE INDEX "share_links_expiresAt_idx" ON "share_links"("expiresAt");

-- CreateIndex
CREATE INDEX "starred_resources_userId_createdAt_idx" ON "starred_resources"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "starred_resources_userId_fileId_key" ON "starred_resources"("userId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "starred_resources_userId_folderId_key" ON "starred_resources"("userId", "folderId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_userId_createdAt_idx" ON "activity_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_action_createdAt_idx" ON "activity_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_resourceType_resourceId_idx" ON "activity_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "storage_usage_date_idx" ON "storage_usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "storage_usage_userId_date_key" ON "storage_usage"("userId", "date");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starred_resources" ADD CONSTRAINT "starred_resources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starred_resources" ADD CONSTRAINT "starred_resources_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starred_resources" ADD CONSTRAINT "starred_resources_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_usage" ADD CONSTRAINT "storage_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CLOUDVAULT_EXTRAS
-- CloudVault: database features Prisma cannot model in schema.prisma.
-- prisma/scripts/db-setup.js appends this file to the initial migration.
-- Identifiers are quoted because Prisma creates camelCase column names.

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Fast name search (ILIKE '%term%') and descendant lookups
-- ---------------------------------------------------------------------
CREATE INDEX "files_name_trgm_idx"   ON "files"   USING gin ("name" gin_trgm_ops);
CREATE INDEX "folders_name_trgm_idx" ON "folders" USING gin ("name" gin_trgm_ops);
CREATE INDEX "folders_path_prefix_idx" ON "folders" ("path" text_pattern_ops);

-- ---------------------------------------------------------------------
-- Unique names among live (non-trashed) siblings, case-insensitive.
-- COALESCE maps the NULL "top level" parent to a constant so top-level
-- siblings are also constrained (NULLs are otherwise distinct in unique indexes).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "folders_unique_live_name_idx"
  ON "folders" ("ownerId", COALESCE("parentId", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"))
  WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "files_unique_live_name_idx"
  ON "files" ("ownerId", COALESCE("folderId", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"))
  WHERE "deletedAt" IS NULL;

-- ---------------------------------------------------------------------
-- Exactly one target on polymorphic tables, and it must match resourceType
-- ---------------------------------------------------------------------
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_exactly_one_target" CHECK (
  ("resourceType" = 'FILE'   AND "fileId" IS NOT NULL AND "folderId" IS NULL) OR
  ("resourceType" = 'FOLDER' AND "folderId" IS NOT NULL AND "fileId" IS NULL)
);

ALTER TABLE "starred_resources" ADD CONSTRAINT "starred_resources_exactly_one_target" CHECK (
  ("resourceType" = 'FILE'   AND "fileId" IS NOT NULL AND "folderId" IS NULL) OR
  ("resourceType" = 'FOLDER' AND "folderId" IS NOT NULL AND "fileId" IS NULL)
);

-- ---------------------------------------------------------------------
-- Sanity constraints
-- ---------------------------------------------------------------------
ALTER TABLE "file_shares"   ADD CONSTRAINT "file_shares_no_self_share"   CHECK ("sharedWithId" <> "sharedById");
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_no_self_share" CHECK ("sharedWithId" <> "sharedById");

ALTER TABLE "users"         ADD CONSTRAINT "users_storage_non_negative"  CHECK ("storageUsedBytes" >= 0 AND "storageQuotaBytes" >= 0);
ALTER TABLE "files"         ADD CONSTRAINT "files_size_non_negative"     CHECK ("size" >= 0);
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_valid"         CHECK ("size" >= 0 AND "versionNumber" > 0);
ALTER TABLE "share_links"   ADD CONSTRAINT "share_links_access_count"    CHECK ("accessCount" >= 0);
