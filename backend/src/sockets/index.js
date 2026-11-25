// Attaches Socket.IO to the HTTP server and registers it with services/realtime.js so any
// service can push events (notification:new) to a user without importing the socket server.

import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { env } from '../config/env.js';
import { createRedisClient } from '../config/redis.js';
import { tokenService, principalLoader } from '../services/auth/auth.service.js';
import { setIo } from '../services/realtime.js';
import { createSocketAuth, onConnection } from './auth.js';

/** @param {import('node:http').Server} httpServer @returns {Server} */
export function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.clientUrl, credentials: true },
    serveClient: false,
  });
  // With Redis, an emit on any instance reaches sockets connected to every other instance.
  const pub = createRedisClient('socket-pub');
  if (pub) io.adapter(createAdapter(pub, createRedisClient('socket-sub')));
  io.use(createSocketAuth({ tokens: tokenService, principals: principalLoader }));
  io.on('connection', onConnection);
  setIo(io);
  return io;
}

export default attachSocketServer;
