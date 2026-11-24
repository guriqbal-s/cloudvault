import api, { unwrap, clean } from './client.js';

export const list = (params, opts) => unwrap(api.get('/recent', { params: clean(params), ...opts })); // files
