// Minimal in-memory stand-in for the Prisma client, covering exactly what the auth code uses:
// findUnique / findFirst / findMany / create / update / updateMany / count, a `where` language
// with equality, null, Date, { in, not, gt, gte, lt, lte }, orderBy, take, and $transaction.
//
// Returns COPIES of rows (like Prisma), so code that mutates a returned record cannot silently
// change stored state. $transaction has no rollback (the code under test never relies on it).
// Unsupported query operators throw, so a test can never pass because of an ignored filter.

import crypto from 'node:crypto';

const TABLES = ['user', 'role', 'userSession', 'refreshToken', 'passwordResetToken', 'emailVerificationToken', 'activityLog'];

const DEFAULTS = {
  user: () => ({ emailVerifiedAt: null, lastLoginAt: null, avatarKey: null }),
  userSession: (now) => ({ lastActiveAt: now(), revokedAt: null, ip: null, userAgent: null }),
  refreshToken: () => ({ revokedAt: null, replacedById: null }),
  passwordResetToken: () => ({ usedAt: null }),
  emailVerificationToken: () => ({ usedAt: null }),
};

const UNIQUE = { user: ['email'], refreshToken: ['tokenHash'], passwordResetToken: ['tokenHash'], emailVerificationToken: ['tokenHash'] };

const copy = (row) => (row ? { ...row } : null);

function test(value, cond) {
  if (cond === null) return (value ?? null) === null;
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  if (typeof cond === 'object') {
    return Object.entries(cond).every(([op, operand]) => {
      if (op === 'in') return operand.includes(value);
      if (op === 'not') return !test(value, operand);
      if (value == null) return false;
      switch (op) {
        case 'gt': return value > operand;
        case 'gte': return value >= operand;
        case 'lt': return value < operand;
        case 'lte': return value <= operand;
        default: throw new Error(`fakeDb: unsupported operator "${op}"`);
      }
    });
  }
  return value === cond;
}

const matches = (row, where = {}) => Object.entries(where).every(([key, cond]) => test(row[key], cond));

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
  return [...rows].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
}

export function createFakeDb({ now = () => new Date() } = {}) {
  const tables = Object.fromEntries(TABLES.map((name) => [name, []]));
  const db = { tables };

  for (const name of TABLES) {
    const rows = tables[name];
    const find = (where) => rows.find((r) => matches(r, where));

    db[name] = {
      findUnique: async ({ where }) => copy(find(where)),
      findFirst: async ({ where, orderBy } = {}) => copy(sortRows(rows.filter((r) => matches(r, where)), orderBy)[0]),
      findMany: async ({ where, orderBy, take } = {}) => {
        const out = sortRows(rows.filter((r) => matches(r, where)), orderBy).map(copy);
        return take ? out.slice(0, take) : out;
      },
      count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
      create: async ({ data }) => {
        const { roles, ...rest } = data;
        const row = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...(DEFAULTS[name]?.(now) ?? {}), ...rest };
        for (const field of UNIQUE[name] ?? []) {
          if (rows.some((r) => r[field] === row[field])) {
            throw Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002', meta: { target: [field] } });
          }
        }
        if (roles?.create) row.roleLinks = roles.create.map((r) => ({ roleId: r.roleId }));
        rows.push(row);
        return copy(row);
      },
      update: async ({ where, data }) => {
        const row = find(where);
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        Object.assign(row, data, { updatedAt: now() });
        return copy(row);
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const row of hit) Object.assign(row, data, { updatedAt: now() });
        return { count: hit.length };
      },
    };
  }

  db.$transaction = async (fn) => fn(db);
  return db;
}
