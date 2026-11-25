-- =====================================================================================
-- CloudVault - create the Super Admin and Admin accounts (MySQL 8.4 / AWS RDS)
-- =====================================================================================
-- Run this once after "npm run db:setup" (which creates the tables, roles and permissions).
-- Use MySQL Workbench, DBeaver or the mysql CLI, connected to the cloudvault database:
--   mysql -h <host> -P <port> -u <user> -p cloudvault < database/create-admins.sql
--   (local Docker MySQL: host 127.0.0.1, port 3307, user root, password cloudvault-local-root)
--
-- Before running:
--   1. Pick a password for each account (10+ characters, at least one letter and one number).
--   2. Make a bcrypt hash for each one:   npm run hash-password -- "YourPassword#2026"
--   3. Paste the hashes into @superadmin_hash and @admin_hash below, and change the emails
--      and names if you like.
--
-- Safe to re-run: an account that already exists is not duplicated and its password is not
-- changed; it is only given the role again. To change a password later, see section D of
-- database/login.sql.
-- =====================================================================================

USE cloudvault;
-- The tables use utf8mb4_0900_as_ci; @variables must match or MySQL reports
-- "Illegal mix of collations".
SET NAMES utf8mb4 COLLATE utf8mb4_0900_as_ci;

-- ---- Edit these ----------------------------------------------------------------------
SET @superadmin_email = LOWER(TRIM('superadmin@cloudvault.dev'));
SET @superadmin_name  = 'Super Admin';
SET @superadmin_hash  = 'PASTE_BCRYPT_HASH_HERE';

SET @admin_email      = LOWER(TRIM('admin@cloudvault.dev'));
SET @admin_name       = 'Admin';
SET @admin_hash       = 'PASTE_BCRYPT_HASH_HERE';

SET @quota_bytes      = 21474836480;   -- 20 GB storage quota for each admin account
-- --------------------------------------------------------------------------------------

START TRANSACTION;

-- Super Admin: full access, including the roles and permissions matrix.
-- The "LIKE '$2%'" guard skips the insert while the hash is still the placeholder.
INSERT INTO users (id, email, name, passwordHash, status, emailVerifiedAt, storageQuotaBytes, updatedAt)
SELECT UUID(), @superadmin_email, @superadmin_name, @superadmin_hash, 'ACTIVE', NOW(3), @quota_bytes, NOW(3)
FROM DUAL
WHERE @superadmin_hash LIKE '$2%'
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = @superadmin_email);

INSERT IGNORE INTO user_roles (userId, roleId)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'Super Admin'
WHERE u.email = @superadmin_email;

-- Admin: manages users, quotas and activity, but cannot manage other admins or edit roles.
INSERT INTO users (id, email, name, passwordHash, status, emailVerifiedAt, storageQuotaBytes, updatedAt)
SELECT UUID(), @admin_email, @admin_name, @admin_hash, 'ACTIVE', NOW(3), @quota_bytes, NOW(3)
FROM DUAL
WHERE @admin_hash LIKE '$2%'
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = @admin_email);

INSERT IGNORE INTO user_roles (userId, roleId)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = 'Admin'
WHERE u.email = @admin_email;

COMMIT;

-- ---- Check the result ----------------------------------------------------------------
-- Expect two rows, both ACTIVE. No rows = the hashes were not pasted in.
-- A NULL role = the roles are missing: run "npm run db:seed" and then run this file again.
SELECT u.email, u.name, u.status,
       GROUP_CONCAT(r.name ORDER BY r.`rank` DESC) AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.userId = u.id
LEFT JOIN roles r       ON r.id = ur.roleId
WHERE u.email IN (@superadmin_email, @admin_email)
GROUP BY u.id;
