// Query-string helpers for backend pagination and sorting.
// Every list endpoint takes ?page=&limit=&sort=field:dir and returns meta from buildMeta().

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export function parsePagination(query = {}, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = Math.max(1, toInt(query.page, 1));
  const limit = Math.min(maxLimit, Math.max(1, toInt(query.limit, defaultLimit)));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function buildMeta({ page, limit, total }) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNext: page < totalPages };
}

/**
 * Turns "name:asc" into a Prisma orderBy, accepting only whitelisted fields so clients can
 * never sort by (or probe) arbitrary columns.
 *
 * @param {string|undefined} sort       e.g. "size:desc"
 * @param {Record<string, string>} allowed  public field name -> column name, e.g. { size: 'size' }
 * @param {{field: string, dir: 'asc'|'desc'}} fallback
 * @returns {Array<Record<string, 'asc'|'desc'>>}
 */
export function parseSort(sort, allowed, fallback) {
  const [rawField, rawDir] = String(sort ?? '').split(':');
  // hasOwn matters: a plain lookup would let "constructor" or "__proto__" through the whitelist.
  const column = Object.hasOwn(allowed, rawField) ? allowed[rawField] : undefined;
  if (!column) return [{ [allowed[fallback.field]]: fallback.dir }];
  const dir = rawDir === 'desc' ? 'desc' : 'asc';
  return [{ [column]: dir }];
}
