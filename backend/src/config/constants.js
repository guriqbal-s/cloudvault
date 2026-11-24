// Values shared by several modules that must not depend on env.js (so they stay unit-testable).

export const API_PREFIX = '/api/v1';

// The refresh-token cookie is only ever sent to the auth endpoints.
export const AUTH_COOKIE_PATH = `${API_PREFIX}/auth`;
export const REFRESH_COOKIE_NAME = 'cv_rt';
