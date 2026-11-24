// File and folder name rules shared by upload, create, rename and restore.

import ApiError from './ApiError.js';
import { extensionOf } from './fileTypes.js';

const MAX_NAME = 255;
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f/\\]/;

/**
 * Trim and validate a name. Slashes, backslashes and control characters are rejected so a name
 * can never act like a path; "." and ".." are reserved.
 * @throws ApiError 422
 */
export function cleanName(raw, label = 'Name') {
  const name = String(raw ?? '').normalize('NFC').trim();
  if (!name) throw ApiError.validation(`${label} is required`, [{ in: 'body', path: 'name', message: `${label} is required` }]);
  let problem = null;
  if (name.length > MAX_NAME) problem = `${label} must be at most ${MAX_NAME} characters`;
  else if (FORBIDDEN.test(name)) problem = `${label} cannot contain slashes or control characters`;
  else if (name === '.' || name === '..') problem = `${label} is not allowed`;
  if (problem) throw ApiError.validation(problem, [{ in: 'body', path: 'name', message: problem }]);
  return name;
}

/** "report.final.pdf" -> { base: "report.final", ext: ".pdf" }; no extension -> ext "". */
export function splitName(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * First free name: "a.pdf" -> "a (1).pdf" -> "a (2).pdf". Comparison is case-insensitive,
 * matching the database's unique index on lower(name).
 * @param {string} name
 * @param {Iterable<string>} taken existing sibling names
 */
export function nextAvailableName(name, taken) {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const { base, ext } = splitName(name);
  for (let i = 1; i < 10_000; i += 1) {
    const suffix = ` (${i})${ext}`;
    // keep the result within the length limit by trimming the base
    const candidate = `${base.slice(0, Math.max(1, MAX_NAME - suffix.length))}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  throw ApiError.conflict('Could not find a free name');
}

/** Keep a file's extension when it is renamed: "notes" -> "notes.pdf" for a PDF. */
export function withExtension(newName, extension) {
  if (!extension) return newName;
  return extensionOf(newName) === extension.toLowerCase() ? newName : `${newName}.${extension}`;
}

/**
 * Multer/busboy may hand over UTF-8 filenames decoded as latin1 ("Ã©" instead of "é").
 * Re-decode only when the result is clean UTF-8, so already-correct names are untouched.
 */
export function fixFilenameEncoding(name) {
  const s = String(name ?? '');
  if ([...s].some((c) => c.charCodeAt(0) > 0xff)) return s;
  const redecoded = Buffer.from(s, 'latin1').toString('utf8');
  return redecoded.includes('�') ? s : redecoded;
}

/** Escape LIKE wildcards for raw SQL patterns (Prisma's contains handles its own). */
export const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);
