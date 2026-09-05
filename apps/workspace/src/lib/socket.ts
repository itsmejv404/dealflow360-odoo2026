import { io, Socket } from 'socket.io-client';
import { authStore } from './auth';

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io('/', {
      path: '/socket.io',
      autoConnect: false,
      auth: (cb: (data: { token: string | null }) => void) => {
        cb({ token: authStore.state.token });
      },
    });

    socketInstance.on('connect_error', (err: Error) => {
      console.warn('Socket connection error:', err.message);
    });
  }

  // If token changed or disconnected, connect
  if (!socketInstance.connected && authStore.state.token) {
    socketInstance.connect();
  }

  return socketInstance;
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
