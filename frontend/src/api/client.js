// Single axios instance for the whole app.
//  - Access token lives in module memory only (never localStorage): XSS cannot read it from storage.
//  - TOKEN_EXPIRED  -> one shared refresh (single-flight), then the original request is retried once.
//  - REFRESH_RACE   -> another tab rotated the cookie first: retry the refresh once.
//  - Session-ending 401 codes -> clear the token and tell the app (AuthContext) to sign out.
import axios from 'axios';
import { SESSION_ENDING_CODES, getErrorCode, getStatus } from '../utils/errors.js';

export const API_BASE = import.meta.env?.VITE_API_URL || '/api/v1';

let accessToken = null;
let onSessionEnded = () => {};
let onTokenRefreshed = () => {};

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => { accessToken = token || null; };
export const clearAccessToken = () => { accessToken = null; };
export const setSessionEndedHandler = (fn) => { onSessionEnded = fn || (() => {}); };
export const setTokenRefreshedHandler = (fn) => { onTokenRefreshed = fn || (() => {}); };

export const api = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 30_000 });
// Bare instance for the refresh call itself: no interceptors, so it can never recurse.
const bare = axios.create({ baseURL: API_BASE, withCredentials: true, timeout: 30_000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let refreshing = null;

/** Rotate the refresh cookie. Concurrent callers share one request. Resolves { user, accessToken }. */
export function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        let res;
        try {
          res = await bare.post('/auth/refresh');
        } catch (err) {
          if (getErrorCode(err) !== 'REFRESH_RACE') throw err;
          await sleep(300 + Math.random() * 300); // the other tab's new cookie is set by now
          res = await bare.post('/auth/refresh');
        }
        const session = res.data.data;
        setAccessToken(session.accessToken);
        onTokenRefreshed(session);
        return session;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

api.interceptors.request.use((config) => {
  if (accessToken && !config.skipAuth) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const config = error.config;
    if (!config || getStatus(error) !== 401 || config.skipAuth) throw error;
    const code = getErrorCode(error);

    if (code === 'TOKEN_EXPIRED' && !config._retried) {
      config._retried = true;
      try {
        const { accessToken: fresh } = await refreshSession();
        config.headers.Authorization = `Bearer ${fresh}`;
        return api(config);
      } catch (refreshErr) {
        if (SESSION_ENDING_CODES.has(getErrorCode(refreshErr)) || getStatus(refreshErr) === 401) endSession();
        throw refreshErr;
      }
    }
    if (SESSION_ENDING_CODES.has(code) || code === 'TOKEN_EXPIRED') endSession();
    throw error;
  }
);

function endSession() {
  clearAccessToken();
  onSessionEnded();
}

/** Resolve to the envelope's `data`. */
export const unwrap = (promise) => promise.then((r) => r.data.data);
/** Resolve to `{ data, meta }` (for paginated or meta-carrying endpoints). */
export const unwrapPage = (promise) => promise.then((r) => ({ data: r.data.data, meta: r.data.meta ?? null }));
/** Resolve to `{ data, message }`. */
export const unwrapMessage = (promise) => promise.then((r) => ({ data: r.data.data, message: r.data.message ?? null }));

/** Drop undefined/null/'' values so they are not sent as empty query params. */
export function clean(params = {}) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

export default api;
