-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `avatarKey` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    `emailVerifiedAt` DATETIME(3) NULL,
    `storageQuotaBytes` BIGINT NOT NULL DEFAULT 5368709120,
    `storageUsedBytes` BIGINT NOT NULL DEFAULT 0,
    `themePref` VARCHAR(191) NOT NULL DEFAULT 'system',
    `notificationPrefs` JSON NOT NULL DEFAULT (JSON_OBJECT()),
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_status_idx`(`status`),
    INDEX `users_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `rank` INTEGER NOT NULL DEFAULT 0,
    `isSystem` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `group` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` CHAR(36) NOT NULL,
    `permissionId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `userId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_roleId_idx`(`roleId`),
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `user_sessions` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `userAgent` TEXT NULL,
    `ip` VARCHAR(191) NULL,
    `lastActiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `user_sessions_userId_revokedAt_idx`(`userId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `familyId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    INDEX `refresh_tokens_sessionId_idx`(`sessionId`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `email_verification_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_verification_tokens_tokenHash_key`(`tokenHash`),
    INDEX `email_verification_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `folders` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `parentId` CHAR(36) NULL,
    `path` LONGTEXT NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` CHAR(36) NULL,
    `trashBatchId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `folders_ownerId_path_idx`(`ownerId`, `path`(191)),
    INDEX `folders_ownerId_parentId_idx`(`ownerId`, `parentId`),
    INDEX `folders_ownerId_deletedAt_idx`(`ownerId`, `deletedAt`),
    INDEX `folders_trashBatchId_idx`(`trashBatchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `ownerId` CHAR(36) NOT NULL,
    `folderId` CHAR(36) NULL,
    `mimeType` VARCHAR(255) NOT NULL,
    `extension` VARCHAR(191) NOT NULL,
    `size` BIGINT NOT NULL,
    `currentVersionId` CHAR(36) NULL,
    `lastAccessedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `deletedById` CHAR(36) NULL,
    `trashBatchId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `files_currentVersionId_key`(`currentVersionId`),
    INDEX `files_ownerId_deletedAt_folderId_idx`(`ownerId`, `deletedAt`, `folderId`),
    INDEX `files_folderId_idx`(`folderId`),
    INDEX `files_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `files_ownerId_lastAccessedAt_idx`(`ownerId`, `lastAccessedAt`),
    INDEX `files_extension_idx`(`extension`),
    INDEX `files_trashBatchId_idx`(`trashBatchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `file_versions` (
    `id` CHAR(36) NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `size` BIGINT NOT NULL,
    `mimeType` VARCHAR(255) NOT NULL,
    `checksum` VARCHAR(191) NOT NULL,
    `uploadedById` CHAR(36) NOT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `file_versions_storageKey_key`(`storageKey`),
    INDEX `file_versions_uploadedById_idx`(`uploadedById`),
    INDEX `file_versions_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `file_versions_fileId_versionNumber_key`(`fileId`, `versionNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `file_shares` (
    `id` CHAR(36) NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `sharedWithId` CHAR(36) NOT NULL,
    `sharedById` CHAR(36) NOT NULL,
    `role` ENUM('VIEWER', 'EDITOR') NOT NULL DEFAULT 'VIEWER',
    `canDownload` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `file_shares_sharedWithId_idx`(`sharedWithId`),
    INDEX `file_shares_sharedById_idx`(`sharedById`),
    UNIQUE INDEX `file_shares_fileId_sharedWithId_key`(`fileId`, `sharedWithId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `folder_shares` (
    `id` CHAR(36) NOT NULL,
    `folderId` CHAR(36) NOT NULL,
    `sharedWithId` CHAR(36) NOT NULL,
    `sharedById` CHAR(36) NOT NULL,
    `role` ENUM('VIEWER', 'EDITOR') NOT NULL DEFAULT 'VIEWER',
    `canDownload` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `folder_shares_sharedWithId_idx`(`sharedWithId`),
    INDEX `folder_shares_sharedById_idx`(`sharedById`),
    UNIQUE INDEX `folder_shares_folderId_sharedWithId_key`(`folderId`, `sharedWithId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `share_links` (
    `id` CHAR(36) NOT NULL,
    `token` VARCHAR(191) COLLATE utf8mb4_0900_bin NOT NULL,
    `resourceType` ENUM('FILE', 'FOLDER') NOT NULL,
    `fileId` CHAR(36) NULL,
    `folderId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `role` ENUM('VIEWER', 'EDITOR') NOT NULL DEFAULT 'VIEWER',
    `allowDownload` BOOLEAN NOT NULL DEFAULT true,
    `passwordHash` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `accessCount` INTEGER NOT NULL DEFAULT 0,
    `lastAccessedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `share_links_token_key`(`token`),
    INDEX `share_links_createdById_idx`(`createdById`),
    INDEX `share_links_fileId_idx`(`fileId`),
    INDEX `share_links_folderId_idx`(`folderId`),
    INDEX `share_links_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `starred_resources` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `resourceType` ENUM('FILE', 'FOLDER') NOT NULL,
    `fileId` CHAR(36) NULL,
    `folderId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `starred_resources_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `starred_resources_userId_fileId_key`(`userId`, `fileId`),
    UNIQUE INDEX `starred_resources_userId_folderId_key`(`userId`, `folderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `type` ENUM('FILE_SHARED', 'FOLDER_SHARED', 'SHARED_FILE_UPDATED', 'PERMISSION_CHANGED', 'ACCESS_REVOKED', 'UPLOAD_COMPLETED', 'UPLOAD_FAILED', 'STORAGE_WARNING', 'SYSTEM') NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `body` TEXT NOT NULL,
    `data` JSON NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    INDEX `notifications_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `activity_logs` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `action` ENUM('LOGIN', 'LOGOUT', 'REGISTER', 'FILE_UPLOAD', 'FILE_DOWNLOAD', 'FILE_DELETE', 'FILE_RESTORE', 'FILE_PERMANENT_DELETE', 'FILE_RENAME', 'FILE_MOVE', 'FILE_COPY', 'FOLDER_CREATE', 'FOLDER_RENAME', 'FOLDER_MOVE', 'FOLDER_COPY', 'FOLDER_DELETE', 'FOLDER_RESTORE', 'FOLDER_PERMANENT_DELETE', 'SHARE_CREATE', 'SHARE_UPDATE', 'SHARE_REVOKE', 'LINK_CREATE', 'LINK_REVOKE', 'LINK_ACCESS', 'VERSION_CREATE', 'VERSION_RESTORE', 'VERSION_DELETE', 'PROFILE_UPDATE', 'PASSWORD_CHANGE', 'STAR', 'UNSTAR', 'ADMIN_ROLE_CHANGE', 'ADMIN_USER_STATUS_CHANGE', 'ADMIN_QUOTA_CHANGE') NOT NULL,
    `resourceType` ENUM('FILE', 'FOLDER') NULL,
    `resourceId` CHAR(36) NULL,
    `resourceName` VARCHAR(255) NULL,
    `description` TEXT NOT NULL,
    `metadata` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `activity_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `activity_logs_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `activity_logs_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    INDEX `activity_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- CreateTable
CREATE TABLE `storage_usage` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `bytesUsed` BIGINT NOT NULL,
    `fileCount` INTEGER NOT NULL,
    `folderCount` INTEGER NOT NULL,
    `bytesUploaded` BIGINT NOT NULL DEFAULT 0,
    `filesUploaded` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `storage_usage_date_idx`(`date`),
    UNIQUE INDEX `storage_usage_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `user_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_verification_tokens` ADD CONSTRAINT `email_verification_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_deletedById_fkey` FOREIGN KEY (`deletedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folders` ADD CONSTRAINT `folders_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_deletedById_fkey` FOREIGN KEY (`deletedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_currentVersionId_fkey` FOREIGN KEY (`currentVersionId`) REFERENCES `file_versions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_versions` ADD CONSTRAINT `file_versions_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_versions` ADD CONSTRAINT `file_versions_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_shares` ADD CONSTRAINT `file_shares_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_shares` ADD CONSTRAINT `file_shares_sharedWithId_fkey` FOREIGN KEY (`sharedWithId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_shares` ADD CONSTRAINT `file_shares_sharedById_fkey` FOREIGN KEY (`sharedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folder_shares` ADD CONSTRAINT `folder_shares_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folder_shares` ADD CONSTRAINT `folder_shares_sharedWithId_fkey` FOREIGN KEY (`sharedWithId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `folder_shares` ADD CONSTRAINT `folder_shares_sharedById_fkey` FOREIGN KEY (`sharedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `share_links` ADD CONSTRAINT `share_links_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `starred_resources` ADD CONSTRAINT `starred_resources_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `starred_resources` ADD CONSTRAINT `starred_resources_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `starred_resources` ADD CONSTRAINT `starred_resources_folderId_fkey` FOREIGN KEY (`folderId`) REFERENCES `folders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_logs` ADD CONSTRAINT `activity_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_usage` ADD CONSTRAINT `storage_usage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve live sibling uniqueness for root and nested items while allowing trashed duplicates.
CREATE UNIQUE INDEX `folders_unique_live_name_idx` ON `folders` (
    `ownerId`, (COALESCE(`parentId`, '')), (IF(`deletedAt` IS NULL, `name`, NULL))
);
CREATE UNIQUE INDEX `files_unique_live_name_idx` ON `files` (
    `ownerId`, (COALESCE(`folderId`, '')), (IF(`deletedAt` IS NULL, `name`, NULL))
);

-- MySQL disallows direct CHECK references to columns that have cascading foreign keys.
-- Virtual columns let CHECK constraints enforce the same invariants.
ALTER TABLE `share_links`
    ADD COLUMN `valid_target` BOOLEAN GENERATED ALWAYS AS (
        (`resourceType` = 'FILE' AND `fileId` IS NOT NULL AND `folderId` IS NULL) OR
        (`resourceType` = 'FOLDER' AND `folderId` IS NOT NULL AND `fileId` IS NULL)
    ) VIRTUAL INVISIBLE,
    ADD CONSTRAINT `share_links_exactly_one_target` CHECK (`valid_target` = TRUE),
    ADD CONSTRAINT `share_links_access_count` CHECK (`accessCount` >= 0);

ALTER TABLE `starred_resources`
    ADD COLUMN `valid_target` BOOLEAN GENERATED ALWAYS AS (
        (`resourceType` = 'FILE' AND `fileId` IS NOT NULL AND `folderId` IS NULL) OR
        (`resourceType` = 'FOLDER' AND `folderId` IS NOT NULL AND `fileId` IS NULL)
    ) VIRTUAL INVISIBLE,
    ADD CONSTRAINT `starred_resources_exactly_one_target` CHECK (`valid_target` = TRUE);

ALTER TABLE `file_shares`
    ADD COLUMN `is_self_share` BOOLEAN GENERATED ALWAYS AS (`sharedWithId` = `sharedById`) VIRTUAL INVISIBLE,
    ADD CONSTRAINT `file_shares_no_self_share` CHECK (`is_self_share` = FALSE);

ALTER TABLE `folder_shares`
    ADD COLUMN `is_self_share` BOOLEAN GENERATED ALWAYS AS (`sharedWithId` = `sharedById`) VIRTUAL INVISIBLE,
    ADD CONSTRAINT `folder_shares_no_self_share` CHECK (`is_self_share` = FALSE);

ALTER TABLE `users`
    ADD CONSTRAINT `users_storage_non_negative` CHECK (`storageUsedBytes` >= 0 AND `storageQuotaBytes` >= 0);
ALTER TABLE `files`
    ADD CONSTRAINT `files_size_non_negative` CHECK (`size` >= 0);
ALTER TABLE `file_versions`
    ADD CONSTRAINT `file_versions_valid` CHECK (`size` >= 0 AND `versionNumber` > 0);
