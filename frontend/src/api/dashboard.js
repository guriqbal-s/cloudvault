import api, { unwrap } from './client.js';

export const get = (opts) => unwrap(api.get('/dashboard', opts));
