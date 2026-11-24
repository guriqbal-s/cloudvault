import api, { unwrapPage, clean } from './client.js';

/** params: action, from, to, page, limit. @returns {{data: Activity[], meta}} */
export const list = (params, opts) =>
  unwrapPage(api.get('/activity', { params: clean(params), ...opts })).then(({ data, meta }) => ({ data: data.activity, meta }));
