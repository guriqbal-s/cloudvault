-- =====================================================================================
-- CloudVault - SQL for the login page (MySQL 8.4 / AWS RDS)
-- =====================================================================================
-- Run these in MySQL Workbench, DBeaver or the mysql CLI, connected to the RDS database:
--   host database-1.cryam8ioiwyg.eu-north-1.rds.amazonaws.com, port 3306, database cloudvault
--
-- The tables themselves are created by the Prisma migration ("npm run db:setup"). Do not
-- create or alter them by hand. This file only reads and changes rows.
--
-- How the login page works:
--   1. The page sends { email, password } to POST /api/v1/auth/login.
--   2. The API lower-cases the email and loads the row from `users` (query A below).
--   3. It compares the password with `users.passwordHash` using bcrypt. SQL cannot make or
--      check bcrypt hashes: generate them with   npm run hash-password -- "the password"
--   4. It checks `users.status`:
--        ACTIVE               -> sign-in allowed
--        PENDING_VERIFICATION -> "Please verify your email" (when REQUIRE_EMAIL_VERIFICATION=true)
--        SUSPENDED            -> sign-in refused
--   5. It opens a row in `user_sessions` + `refresh_tokens`, sets `users.lastLoginAt` and writes
--      a LOGIN row to `activity_logs`.
--   What a user can do after signing in comes from their role (user_roles -> roles -> role_permissions).
--
-- Change the values in the SET lines at the top of each section, then run that section.
-- =====================================================================================

USE cloudvault;
-- Run this once per connection, before any section: the tables use utf8mb4_0900_as_ci, and
-- @variables take the connection's collation. Without it MySQL reports "Illegal mix of collations".
SET NAMES utf8mb4 COLLATE utf8mb4_0900_as_ci;


-- -------------------------------------------------------------------------------------
-- A. The lookup the login page triggers (read only)
-- -------------------------------------------------------------------------------------
SET @email = LOWER(TRIM('user@example.com'));

SELECT u.id, u.email, u.name, u.status, u.emailVerifiedAt, u.lastLoginAt,
       GROUP_CONCAT(r.name ORDER BY r.`rank` DESC) AS roles
FROM users u
LEFT JOIN user_roles ur ON ur.userId = u.id
LEFT JOIN roles r       ON r.id = ur.roleId
WHERE u.email = @email
GROUP BY u.id;


-- -------------------------------------------------------------------------------------
-- B. Create a user who can sign in on the login page
-- -------------------------------------------------------------------------------------
-- 1. Make the password hash:   npm run hash-password -- "YourPassword#2026"
-- 2. Paste it into @password_hash (the insert is skipped while it is still the placeholder)
-- 3. Role is one of: Super Admin, Admin, Manager, Standard User, Viewer
SET @email         = LOWER(TRIM('newuser@example.com'));
SET @name          = 'New User';
SET @password_hash = 'PASTE_BCRYPT_HASH_HERE';
SET @role          = 'Standard User';
SET @user_id       = UUID();

START TRANSACTION;
INSERT INTO users (id, email, name, passwordHash, status, emailVerifiedAt, storageQuotaBytes, updatedAt)
SELECT @user_id, @email, @name, @password_hash, 'ACTIVE', NOW(3), 5368709120, NOW(3)
FROM DUAL WHERE @password_hash LIKE '$2%';

INSERT INTO user_roles (userId, roleId)
SELECT @user_id, id FROM roles WHERE name = @role;
-- Expect "1 row affected" for both inserts. 0 rows on the second one = misspelled role: ROLLBACK;
COMMIT;


-- -------------------------------------------------------------------------------------
-- C. "Please verify your email" on login -> mark the email as verified
-- -------------------------------------------------------------------------------------
SET @email = LOWER(TRIM('user@example.com'));

UPDATE users
SET status = 'ACTIVE', emailVerifiedAt = COALESCE(emailVerifiedAt, NOW(3)), updatedAt = NOW(3)
WHERE email = @email AND status = 'PENDING_VERIFICATION';


-- -------------------------------------------------------------------------------------
-- D. Forgotten password -> set a new one
-- -------------------------------------------------------------------------------------
-- Make the hash with:  npm run hash-password -- "NewPassword#2026"
-- Existing sessions are signed out, just like a reset through the app.
SET @email         = LOWER(TRIM('user@example.com'));
SET @password_hash = 'PASTE_BCRYPT_HASH_HERE';

START TRANSACTION;
UPDATE users SET passwordHash = @password_hash, updatedAt = NOW(3)
WHERE email = @email AND @password_hash LIKE '$2%';   -- guard: refuses anything that is not a bcrypt hash
UPDATE user_sessions s JOIN users u ON u.id = s.userId
SET s.revokedAt = NOW(3), s.updatedAt = NOW(3)
WHERE u.email = @email AND s.revokedAt IS NULL;
UPDATE refresh_tokens t JOIN users u ON u.id = t.userId
SET t.revokedAt = NOW(3), t.updatedAt = NOW(3)
WHERE u.email = @email AND t.revokedAt IS NULL;
COMMIT;


-- -------------------------------------------------------------------------------------
-- E. Block or unblock sign-in (suspend / reactivate)
-- -------------------------------------------------------------------------------------
SET @email = LOWER(TRIM('user@example.com'));

-- Suspend: login is refused and every open session is ended
-- START TRANSACTION;
-- UPDATE users SET status = 'SUSPENDED', updatedAt = NOW(3) WHERE email = @email;
-- UPDATE user_sessions s JOIN users u ON u.id = s.userId
--   SET s.revokedAt = NOW(3), s.updatedAt = NOW(3) WHERE u.email = @email AND s.revokedAt IS NULL;
-- UPDATE refresh_tokens t JOIN users u ON u.id = t.userId
--   SET t.revokedAt = NOW(3), t.updatedAt = NOW(3) WHERE u.email = @email AND t.revokedAt IS NULL;
-- COMMIT;

-- Reactivate
UPDATE users SET status = 'ACTIVE', updatedAt = NOW(3) WHERE email = @email AND status = 'SUSPENDED';


-- -------------------------------------------------------------------------------------
-- F. Change a user's role (what they can do after signing in)
-- -------------------------------------------------------------------------------------
SET @email = LOWER(TRIM('newuser@example.com'));
SET @role  = 'Manager';

START TRANSACTION;
DELETE ur FROM user_roles ur JOIN users u ON u.id = ur.userId WHERE u.email = @email;
INSERT INTO user_roles (userId, roleId)
SELECT u.id, r.id FROM users u JOIN roles r ON r.name = @role WHERE u.email = @email;
COMMIT;
-- Takes effect on the user's next request; no need to sign in again.


-- -------------------------------------------------------------------------------------
-- G. Sign a user out everywhere
-- -------------------------------------------------------------------------------------
SET @email = LOWER(TRIM('user@example.com'));

UPDATE user_sessions s JOIN users u ON u.id = s.userId
SET s.revokedAt = NOW(3), s.updatedAt = NOW(3)
WHERE u.email = @email AND s.revokedAt IS NULL;
UPDATE refresh_tokens t JOIN users u ON u.id = t.userId
SET t.revokedAt = NOW(3), t.updatedAt = NOW(3)
WHERE u.email = @email AND t.revokedAt IS NULL;


-- -------------------------------------------------------------------------------------
-- H. Reports
-- -------------------------------------------------------------------------------------
-- Every account, its role and whether it can sign in
SELECT u.email, u.name, u.status,
       GROUP_CONCAT(r.name ORDER BY r.`rank` DESC) AS roles,
       CASE u.status WHEN 'ACTIVE' THEN 'yes'
                     WHEN 'PENDING_VERIFICATION' THEN 'after verifying email'
                     ELSE 'no (suspended)' END AS can_sign_in,
       u.lastLoginAt, u.createdAt
FROM users u
LEFT JOIN user_roles ur ON ur.userId = u.id
LEFT JOIN roles r       ON r.id = ur.roleId
GROUP BY u.id
ORDER BY u.createdAt;

-- Recent sign-ins (newest first)
SELECT a.createdAt, u.email, a.ip, LEFT(a.userAgent, 80) AS device
FROM activity_logs a JOIN users u ON u.id = a.userId
WHERE a.action = 'LOGIN'
ORDER BY a.createdAt DESC
LIMIT 50;

-- Currently signed-in sessions
SELECT u.email, s.ip, s.lastActiveAt, s.createdAt AS signed_in_at
FROM user_sessions s JOIN users u ON u.id = s.userId
WHERE s.revokedAt IS NULL
  AND EXISTS (SELECT 1 FROM refresh_tokens t
              WHERE t.sessionId = s.id AND t.revokedAt IS NULL AND t.expiresAt > NOW(3))
ORDER BY s.lastActiveAt DESC;

-- Roles and how many permissions each has
SELECT r.name, r.`rank`, COUNT(rp.permissionId) AS permissions
FROM roles r LEFT JOIN role_permissions rp ON rp.roleId = r.id
GROUP BY r.id ORDER BY r.`rank` DESC;


-- -------------------------------------------------------------------------------------
-- I. Delete a user (permanent)
-- -------------------------------------------------------------------------------------
-- Prefer suspending (section E). Deleting cascades to the user's sessions, roles, shares,
-- stars and notifications; their activity-log rows are kept with userId = NULL.
-- MySQL REFUSES the delete (foreign key error 1451) while the user still owns files or
-- folders, or uploaded a version of someone's file. That protects the Cloudinary contents:
-- delete such users from the Admin page, which removes their files from Cloudinary too.
-- Safe for accounts that never uploaded anything (e.g. one made with section B):
-- SET @email = LOWER(TRIM('newuser@example.com'));
-- DELETE FROM users WHERE email = @email;
