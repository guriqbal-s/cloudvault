// Bridge between services and Socket.IO. Services call emitToUser() without importing the
// socket server; sockets/index.js registers the live server with setIo() at startup.
// With no server registered (unit tests, scripts) emitting is a harmless no-op.

let io = null;

export function setIo(instance) {
  io = instance;
}

export function getIo() {
  return io;
}

/** @returns {boolean} whether a socket server was available to receive the event */
export function emitToUser(userId, event, payload) {
  if (!io) return false;
  io.to(`user:${userId}`).emit(event, payload);
  return true;
}
