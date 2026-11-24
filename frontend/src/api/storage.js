import api, { unwrap } from './client.js';

/** @returns {{used, quota, percent, breakdown:[{category,label,bytes,count}], trashBytes}} */
export const get = (opts) => unwrap(api.get('/storage', opts));
