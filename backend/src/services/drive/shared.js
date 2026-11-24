// Helpers shared by the drive logic modules: error shapes, access constants, DTO decoration.

import ApiError from '../../utils/ApiError.js';
import { toFileDTO, toFolderDTO } from '../dto.js';

export const OWNER_ACCESS = Object.freeze({ level: 'OWNER', canDownload: true, source: 'owner' });
export const MAX_FOLDER_DEPTH = 20;

export const nameTaken = (name) => new ApiError(409, 'NAME_TAKEN', `An item named "${name}" already exists here`);
export const crossOwner = () =>
  new ApiError(400, 'CROSS_OWNER_MOVE', 'Items can only be moved within the same owner\'s drive');
export const invalidMove = (message = 'A folder cannot be moved into itself or one of its subfolders') =>
  new ApiError(400, 'INVALID_MOVE', message);

/** True when `name` collides (case-insensitively) with one of `names`. */
export const hasName = (names, name) => names.some((n) => n.toLowerCase() === name.toLowerCase());

/** Remove one occurrence of `name` (case-insensitive) - used so an item does not conflict with itself. */
export function withoutName(names, name) {
  const lower = name.toLowerCase();
  const i = names.findIndex((n) => n.toLowerCase() === lower);
  return i < 0 ? names : [...names.slice(0, i), ...names.slice(i + 1)];
}

/**
 * Turns repository rows into API DTOs, adding the per-viewer extras (starred, shared,
 * itemCount). "shared" is only computed for the owner's own items so it never leaks to sharees.
 * @param {{ repo: object }} deps
 */
export function createDecorator({ repo }) {
  async function extras(actor, files, folders) {
    const [starred, shared, counts] = await Promise.all([
      repo.starredIds(actor.id, { fileIds: files.map((f) => f.id), folderIds: folders.map((f) => f.id) }),
      repo.sharedFlags(actor.id, {
        fileIds: files.filter((f) => f.ownerId === actor.id).map((f) => f.id),
        folderIds: folders.filter((f) => f.ownerId === actor.id).map((f) => f.id),
      }),
      folders.length ? repo.countChildren(folders.map((f) => f.id)) : new Map(),
    ]);
    return { starred, shared, counts };
  }

  /** @param accessFor access object, or (row) => access */
  async function decorate(actor, { files = [], folders = [] }, accessFor, { sharedBy } = {}) {
    const pick = (row) => (typeof accessFor === 'function' ? accessFor(row) : accessFor);
    const { starred, shared, counts } = await extras(actor, files, folders);
    return {
      files: files.map((row) => toFileDTO(row, {
        actor, access: pick(row), starred: starred.files.has(row.id), shared: shared.files.has(row.id),
        versionCount: row.versionCount, currentVersion: row.currentVersion, sharedBy: sharedBy?.(row),
      })),
      folders: folders.map((row) => toFolderDTO(row, {
        actor, access: pick(row), starred: starred.folders.has(row.id), shared: shared.folders.has(row.id),
        itemCount: counts.get(row.id) ?? 0, sharedBy: sharedBy?.(row),
      })),
    };
  }

  const file = async (actor, row, access) => (await decorate(actor, { files: [row] }, access)).files[0];
  const folder = async (actor, row, access) => (await decorate(actor, { folders: [row] }, access)).folders[0];
  return { decorate, file, folder };
}

export const toNumber = (v) => Number(v ?? 0);
