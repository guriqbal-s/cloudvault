// Socket.IO handshake authentication. The client sends its access token as `auth.token`;
// it is verified exactly like an HTTP request (signature, session not revoked, account usable),
// so a suspended user or a revoked session cannot open a socket. Dependency free for testing.

import ApiError from '../utils/ApiError.js';

/** @param {{ tokens: { verifyAccess }, principals: { authenticate } }} deps */
export function createSocketAuth({ tokens, principals }) {
  return async function socketAuth(socket, next) {
    try {
      const token = socket.handshake?.auth?.token;
      if (typeof token !== 'string' || !token) throw ApiError.unauthorized('Authentication required');
      const { userId, sessionId } = tokens.verifyAccess(token);
      const principal = await principals.authenticate({ userId, sessionId });
      socket.data.userId = principal.user.id;
      socket.data.sessionId = sessionId;
      next();
    } catch (err) {
      // Surface the stable error code so the client knows whether to refresh its token.
      const out = new Error(err?.message ?? 'Authentication failed');
      out.data = { code: err?.code ?? 'UNAUTHORIZED' };
      next(out);
    }
  };
}

/** Room every socket of a user joins; services emit into it through services/realtime.js. */
export const userRoom = (userId) => `user:${userId}`;

export function onConnection(socket) {
  socket.join(userRoom(socket.data.userId));
  socket.emit('ready', { userId: socket.data.userId });
}
