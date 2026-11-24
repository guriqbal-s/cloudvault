// In-memory Prisma stand-in for the social/admin modules. Supports: where (equality, null, Date,
// in/notIn/not/gt/gte/lt/lte/contains/startsWith + mode, OR/AND/NOT, one-level relation filters
// declared in RELATIONS), orderBy, skip/take, select (trims fields like Prisma does), count,
// create/createMany/update (incl. increment/decrement)/updateMany/delete/deleteMany, groupBy,
// aggregate, compound unique keys (a_b) and $transaction. Unsupported operators throw so a test
// can never pass because a filter was silently ignored.

import crypto from 'node:crypto';

const TABLES = [
  'user', 'role', 'permission', 'rolePermission', 'userRole', 'userSession', 'refreshToken',
  'passwordResetToken', 'emailVerificationToken', 'folder', 'file', 'fileVersion', 'fileShare',
  'folderShare', 'shareLink', 'starredResource', 'notification', 'activityLog', 'storageUsage',
];
// table.relationName -> [targetTable, fkColumn]
const RELATIONS = { fileVersion: { file: ['file', 'fileId'] }, shareLink: { file: ['file', 'fileId'], folder: ['folder', 'folderId'] } };
// Selectable / includable relations: table -> relation -> [targetTable, fkColumn]
const JOINS = {
  shareLink: { file: ['file', 'fileId'], folder: ['folder', 'folderId'], createdBy: ['user', 'createdById'] },
  file: { folder: ['folder', 'folderId'] },
};
const CASCADES = {
  user: [['userRole', 'userId'], ['userSession', 'userId'], ['refreshToken', 'userId'], ['fileShare', 'sharedWithId'], ['fileShare', 'sharedById'],
    ['folderShare', 'sharedWithId'], ['folderShare', 'sharedById'], ['shareLink', 'createdById'], ['notification', 'userId'], ['starredResource', 'userId'], ['storageUsage', 'userId']],
  file: [['fileVersion', 'fileId'], ['fileShare', 'fileId'], ['shareLink', 'fileId'], ['starredResource', 'fileId']],
  folder: [['folder', 'parentId'], ['file', 'folderId'], ['folderShare', 'folderId'], ['shareLink', 'folderId']],
};
const SETNULL = { user: [['activityLog', 'userId']] };
const UNIQUE = { user: [['email']], shareLink: [['token']], role: [['name']], fileShare: [['fileId', 'sharedWithId']], folderShare: [['folderId', 'sharedWithId']] };
const DEFAULTS = {
  user: () => ({ status: 'ACTIVE', avatarKey: null, notificationPrefs: {}, storageUsedBytes: 0n, storageQuotaBytes: 1000n, themePref: 'system', lastLoginAt: null }),
  file: () => ({ deletedAt: null, folderId: null }),
  folder: () => ({ deletedAt: null, parentId: null }),
  shareLink: () => ({ revokedAt: null, expiresAt: null, accessCount: 0, lastAccessedAt: null, passwordHash: null, allowDownload: true, role: 'VIEWER' }),
  notification: () => ({ readAt: null }),
  userSession: () => ({ revokedAt: null }),
  refreshToken: () => ({ revokedAt: null }),
  fileShare: () => ({ canDownload: true }),
  folderShare: () => ({ canDownload: true }),
};

const copy = (r) => (r ? { ...r } : null);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function createSocialDb({ now = () => new Date() } = {}) {
  const tables = Object.fromEntries(TABLES.map((t) => [t, []]));
  const db = { tables };

  function cond(value, c) {
    if (c === null) return (value ?? null) === null;
    if (c instanceof Date) return value instanceof Date && value.getTime() === c.getTime();
    if (typeof c === 'object') {
      return Object.entries(c).every(([op, x]) => {
        switch (op) {
          case 'in': return x.includes(value);
          case 'notIn': return !x.includes(value);
          case 'not': return !cond(value, x);
          case 'mode': return true;
          case 'contains': return value != null && (c.mode === 'insensitive' ? String(value).toLowerCase().includes(String(x).toLowerCase()) : String(value).includes(x));
          case 'startsWith': return value != null && String(value).startsWith(x);
          case 'gt': return value != null && value > x;
          case 'gte': return value != null && value >= x;
          case 'lt': return value != null && value < x;
          case 'lte': return value != null && value <= x;
          default: throw new Error(`socialDb: unsupported operator "${op}"`);
        }
      });
    }
    return value === c;
  }

  function matches(table, row, where = {}) {
    return Object.entries(where).every(([key, c]) => {
      if (key === 'OR') return c.some((w) => matches(table, row, w));
      if (key === 'AND') return [].concat(c).every((w) => matches(table, row, w));
      if (key === 'NOT') return ![].concat(c).some((w) => matches(table, row, w));
      const rel = RELATIONS[table]?.[key];
      if (rel) {
        const [target, fk] = rel;
        const t = tables[target].find((r) => r.id === row[fk]);
        return t ? matches(target, t, c) : false;
      }
      if (key.includes('_') && !(key in row) && c && typeof c === 'object' && !(c instanceof Date)) return matches(table, row, c);
      return cond(row[key], c);
    });
  }

  const sortRows = (rows, orderBy) => {
    const list = [].concat(orderBy ?? []);
    if (!list.length) return rows;
    return [...rows].sort((a, b) => {
      for (const o of list) {
        const [[f, d]] = Object.entries(o);
        const r = cmp(a[f] ?? null, b[f] ?? null) * (d === 'desc' ? -1 : 1);
        if (r) return r;
      }
      return 0;
    });
  };
  const pick = (row, select, table, include) => {
    if (!row) return null;
    const out = select ? {} : { ...row };
    for (const [k, v] of Object.entries(select ?? {})) if (v === true) out[k] = row[k];
    for (const [k, v] of Object.entries({ ...(select ?? {}), ...(include ?? {}) })) {
      const join = JOINS[table]?.[k];
      if (!join || v === true || v === false) continue;
      const t = tables[join[0]].find((r) => r.id === row[join[1]]);
      out[k] = t ? pick(t, v.select, join[0]) : null;
    }
    return out;
  };

  for (const name of TABLES) {
    const rows = tables[name];
    const find = (where) => rows.find((r) => matches(name, r, where));
    const del = (where) => {
      const hit = rows.filter((r) => matches(name, r, where));
      for (const r of hit) {
        rows.splice(rows.indexOf(r), 1);
        for (const [child, fk] of CASCADES[name] ?? []) db[child].deleteMany({ where: { [fk]: r.id } });
        for (const [child, fk] of SETNULL[name] ?? []) tables[child].filter((c) => c[fk] === r.id).forEach((c) => { c[fk] = null; });
      }
      return hit.length;
    };
    const insert = (data) => {
      const row = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...(DEFAULTS[name]?.() ?? {}), ...data };
      for (const fields of UNIQUE[name] ?? []) {
        if (rows.some((r) => fields.every((f) => r[f] === row[f]))) {
          throw Object.assign(new Error(`Unique constraint failed on ${fields}`), { code: 'P2002', meta: { target: fields } });
        }
      }
      rows.push(row);
      return row;
    };
    const apply = (row, data) => {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && !(v instanceof Date) && ('increment' in v || 'decrement' in v)) {
          row[k] = 'increment' in v ? row[k] + v.increment : row[k] - v.decrement;
        } else if (v !== undefined) row[k] = v;
      }
      row.updatedAt = now();
    };

    db[name] = {
      findUnique: async ({ where, select, include }) => pick(find(where), select, name, include),
      findFirst: async ({ where, orderBy, select, include } = {}) => pick(sortRows(rows.filter((r) => matches(name, r, where)), orderBy)[0], select, name, include),
      findMany: async ({ where, orderBy, skip = 0, take, select, include } = {}) => {
        const out = sortRows(rows.filter((r) => matches(name, r, where)), orderBy).slice(skip, take == null ? undefined : skip + take);
        return out.map((r) => pick(r, select, name, include));
      },
      count: async ({ where } = {}) => rows.filter((r) => matches(name, r, where)).length,
      create: async ({ data, select }) => pick(insert(data), select),
      createMany: async ({ data }) => { data.forEach(insert); return { count: data.length }; },
      update: async ({ where, data, select }) => {
        const row = find(where);
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        apply(row, data);
        return pick(row, select);
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((r) => matches(name, r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      },
      delete: async ({ where }) => {
        const row = find(where);
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        del({ id: row.id });
        return copy(row);
      },
      deleteMany: async ({ where } = {}) => ({ count: del(where) }),
      aggregate: async ({ where, _sum }) => {
        const hit = rows.filter((r) => matches(name, r, where));
        const out = { _sum: {} };
        for (const f of Object.keys(_sum ?? {})) out._sum[f] = hit.length ? hit.reduce((a, r) => a + (r[f] ?? 0), typeof hit[0][f] === 'bigint' ? 0n : 0) : null;
        return out;
      },
      groupBy: async ({ by, where, _sum, _count }) => {
        const groups = new Map();
        for (const r of rows.filter((x) => matches(name, x, where))) {
          const k = JSON.stringify(by.map((f) => r[f]));
          (groups.get(k) ?? groups.set(k, []).get(k)).push(r);
        }
        return [...groups.values()].map((g) => {
          const out = Object.fromEntries(by.map((f) => [f, g[0][f]]));
          if (_count) out._count = { _all: g.length };
          if (_sum) out._sum = Object.fromEntries(Object.keys(_sum).map((f) => [f, g.reduce((a, r) => a + (r[f] ?? 0), typeof g[0][f] === 'bigint' ? 0n : 0)]));
          return out;
        });
      },
    };
  }
  db.$transaction = async (fn) => fn(db);

  // seeding helpers -------------------------------------------------------
  db.seed = (table, data) => insertRaw(table, data);
  function insertRaw(table, data) {
    return tables[table].push({ id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...(DEFAULTS[table]?.() ?? {}), ...data }) && tables[table].at(-1);
  }
  return db;
}

/** Wide-open actor for tests: { id, permissions: Set, rank } */
export const actor = (id, permissions = [], rank = 40, name = id) => ({ id, permissions: new Set(permissions), rank, user: { id, name } });
