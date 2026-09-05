import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface SocketUserPayload {
  userId?: string;
  orgId: string;
  /** Present for internal users only; customer tokens never carry a role. */
  role?: string;
  /** Token audience: 'internal' | 'customer'. Legacy tokens without `typ` are inferred. */
  typ?: 'internal' | 'customer';
  /** Customer tokens are scoped to an explicit allow-list of quotation ids. */
  quotationIds?: string[];
}

let io: SocketIOServer | null = null;

const ALLOWED_SOCKET_ORIGINS = (env.SOCKET_CORS_ORIGINS ?? 'http://localhost,http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: ALLOWED_SOCKET_ORIGINS,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  // JWT Authentication & audience verification
  io.use((socket: Socket, next: (err?: Error) => void) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.authorization?.startsWith('Bearer ')
          ? socket.handshake.headers.authorization.slice(7)
          : null);

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, env.JWT_SECRET) as any;
      if (!decoded || !decoded.org_id) {
        return next(new Error('Invalid token or missing organization context'));
      }

      // Super Admin tokens are platform-scoped: they have no tenant context
      // and must not join any org room.
      if (decoded.typ === 'super_admin' || decoded.role === 'super_admin') {
        return next(new Error('Super Admin tokens cannot open realtime connections'));
      }

      const typ: 'internal' | 'customer' =
        decoded.typ === 'customer' ? 'customer' : decoded.role ? 'internal' : 'customer';

      if (typ === 'customer' && decoded.role) {
        return next(new Error('Malformed customer token: internal role claims are not permitted'));
      }

      socket.data.user = {
        userId: decoded.sub || decoded.userId,
        orgId: decoded.org_id,
        typ,
        ...(typ === 'internal' ? { role: decoded.role } : {}),
        ...(typ === 'customer' ? { quotationIds: Array.isArray(decoded.quotation_ids) ? decoded.quotation_ids : [] } : {}),
      } as SocketUserPayload;

      next();
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Socket.IO authentication failed');
      next(new Error('Unauthorized socket connection'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as SocketUserPayload;

    if (user.typ === 'internal') {
      // Internal users join the full tenant room and may subscribe to any
      // quotation room within their org.
      const orgRoom = `org:${user.orgId}`;
      socket.join(orgRoom);
      logger.info({ socketId: socket.id, orgId: user.orgId, role: user.role }, 'Internal socket joined org room');

      socket.on('quote:join', (quotationId: string) => {
        if (typeof quotationId === 'string' && quotationId.trim()) {
          const quoteRoom = `org:${user.orgId}:quote:${quotationId}`;
          socket.join(quoteRoom);
          logger.debug({ socketId: socket.id, room: quoteRoom }, 'Socket joined quote room');
        }
      });

      socket.on('quote:leave', (quotationId: string) => {
        if (typeof quotationId === 'string' && quotationId.trim()) {
          const quoteRoom = `org:${user.orgId}:quote:${quotationId}`;
          socket.leave(quoteRoom);
          logger.debug({ socketId: socket.id, room: quoteRoom }, 'Socket left quote room');
        }
      });
    } else {
      // Customer tokens never receive the org-wide event stream. They are
      // pinned to the quote rooms listed in their JWT allow-list only.
      const allowed = new Set(user.quotationIds ?? []);
      for (const quotationId of allowed) {
        socket.join(`org:${user.orgId}:quote:${quotationId}`);
      }
      logger.info(
        { socketId: socket.id, orgId: user.orgId, scopedQuotes: allowed.size },
        'Customer socket joined scoped quote rooms only'
      );

      socket.on('quote:join', (quotationId: string) => {
        if (typeof quotationId === 'string' && allowed.has(quotationId)) {
          socket.join(`org:${user.orgId}:quote:${quotationId}`);
        } else {
          logger.warn({ socketId: socket.id, quotationId }, 'Customer attempted to join unauthorized quote room');
        }
      });

      socket.on('quote:leave', (quotationId: string) => {
        if (typeof quotationId === 'string' && allowed.has(quotationId)) {
          socket.leave(`org:${user.orgId}:quote:${quotationId}`);
        }
      });
    }

    socket.on('disconnect', (reason: string) => {
      logger.debug({ socketId: socket.id, orgId: user.orgId, reason }, 'Socket disconnected');
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO has not been initialized. Call initSocketIO(httpServer) first.');
  }
  return io;
}

export function emitToOrg(orgId: string, event: string, data: any): void {
  if (!io) return;
  io.to(`org:${orgId}`).emit(event, data);
}

export function emitToQuote(orgId: string, quotationId: string, event: string, data: any): void {
  if (!io) return;
  io.to(`org:${orgId}:quote:${quotationId}`).emit(event, data);
}
