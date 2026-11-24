import api, { unwrapPage, clean } from './client.js';

/** params: q, type, ownerId, from, to, minSize, maxSize, page, limit. @returns {{data:{folders,files}, meta}} */
export const search = (params, opts) => unwrapPage(api.get('/search', { params: clean(params), ...opts }));
