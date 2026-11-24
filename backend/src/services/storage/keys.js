// Storage key conventions. This is the only place that knows the layout, so changing it (or
// moving to S3 key prefixes) is a one-file edit. The seed script uses the same layout.

const ID = /^[A-Za-z0-9-]+$/;

function assertId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new TypeError(`Invalid ${label} for storage key: ${String(value)}`);
  }
}

/** Key of one version of a file: versions/users/<ownerId>/<fileId>/v<n> */
export function versionKey(ownerId, fileId, versionNumber) {
  assertId(ownerId, 'ownerId');
  assertId(fileId, 'fileId');
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new TypeError(`Invalid version number: ${versionNumber}`);
  }
  return `versions/users/${ownerId}/${fileId}/v${versionNumber}`;
}

/** Prefix covering every version of one file (for purge). Trailing slash is intentional. */
export function filePrefix(ownerId, fileId) {
  assertId(ownerId, 'ownerId');
  assertId(fileId, 'fileId');
  return `versions/users/${ownerId}/${fileId}/`;
}

/** Key of a user's profile picture. */
export function avatarKey(userId) {
  assertId(userId, 'userId');
  return `uploads/avatars/${userId}`;
}
