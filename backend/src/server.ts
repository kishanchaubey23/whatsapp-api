import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import app from './app.js';
import { config } from './config.js';
import { getRedis } from './lib/redis.js';
import type { AuthUser } from './middleware/auth.js';

async function main() {
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;
      if (!token) return next(new Error('Unauthorized'));
      const user = jwt.verify(token, config.jwtSecret) as AuthUser;
      socket.data.userId = user.userId;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    socket.emit('connected', { userId, plan: 'enterprise' });
  });

  // Bridge Redis pub/sub → WebSocket (campaign progress)
  try {
    const redis = await getRedis();
    const sub = redis.duplicate();
    await sub.connect();
    await sub.pSubscribe('user:*', (message, channel) => {
      try {
        const payload = JSON.parse(message);
        io.to(channel).emit('event', payload);
      } catch {
        /* ignore */
      }
    });
    console.log('[ws] Redis → Socket.IO bridge ready');
  } catch (err) {
    console.warn('[ws] Redis bridge skipped (Redis may be down):', err);
  }

  httpServer.listen(config.port, () => {
    console.log(`Loopx API :${config.port}`);
    console.log(`Plan: enterprise ₹${config.plan.priceInr}`);
    console.log(`REST  http://localhost:${config.port}/api/health`);
    console.log(`WS    ws://localhost:${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
