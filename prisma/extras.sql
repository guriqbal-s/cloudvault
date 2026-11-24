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
