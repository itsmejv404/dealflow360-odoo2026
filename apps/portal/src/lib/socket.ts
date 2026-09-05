import { io, Socket } from 'socket.io-client';
import { customerAuth } from './auth';

let socketInstance: Socket | null = null;

export function getPortalSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io('/', {
      path: '/socket.io',
      autoConnect: false,
      auth: (cb: (data: { token: string | null }) => void) => {
        cb({ token: customerAuth.state.token });
      },
    });

    socketInstance.on('connect_error', (err: Error) => {
      console.warn('Portal socket connection error:', err.message);
    });
  }

  // If token changed or disconnected, connect
  if (!socketInstance.connected && customerAuth.state.token) {
    socketInstance.connect();
  }

  return socketInstance;
}

export function disconnectPortalSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
