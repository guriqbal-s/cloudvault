// Consistent success envelope: { success: true, data, message?, meta? }
// Errors use { success: false, error: { code, message, details? } } (see errorHandler).

export function ok(res, data = null, { message, meta, status = 200 } = {}) {
  return res.status(status).json({ success: true, data, message, meta });
}

export function created(res, data = null, { message, meta } = {}) {
  return ok(res, data, { message, meta, status: 201 });
}

export function noContent(res) {
  return res.status(204).end();
}

/** Paged list: `meta` carries page, limit, total, totalPages and hasNext. */
export function paginated(res, items, meta, { message } = {}) {
  return ok(res, items, { message, meta });
}
